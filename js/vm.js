// Controller around the v86 x86 emulator: boot, input, screenshots, 9p transfers, snapshots.
import { imageName } from "./images.js";
import { readSnapshot, writeSnapshot, deleteSnapshot } from "./state.js";

const STORE_KEY = "webvm.settings.v1";
const MOUNT_TAG = "hostshare";

// A snapshot is the guest's whole RAM, so autosave is deliberately coarse: once a minute,
// plus whenever the tab is hidden or closing. Save in the Machine window for an exact point.
const AUTOSAVE_MS = 60_000;
// Every v86 state blob starts with this magic number; anything else cannot be restored.
const V86_STATE_MAGIC = -2039052682;

/** Guest command that brings eth0 up and points apk at the online Alpine mirrors. */
export const NETWORK_SETUP_CMD =
  "ip link set eth0 up; udhcpc -i eth0 -n; " +
  "grep -q dl-cdn /etc/apk/repositories || echo https://dl-cdn.alpinelinux.org/alpine/v3.21/main >> /etc/apk/repositories; " +
  "grep -q community /etc/apk/repositories || echo https://dl-cdn.alpinelinux.org/alpine/v3.21/community >> /etc/apk/repositories; apk update";


export const DEFAULT_SETTINGS = {
  memoryMB: 512,
  nic: "ne2k",
  backend: "wsproxy",
  relayUrl: "wss://relay.widgetry.org/",
  wispUrl: "wisp://localhost:12345",
  imageUrl: "media/alpine-virt-x86.iso",
  imageName: "Alpine Linux 3.21 (virt, x86)",
  scale: 1,
  wallpaper: "aubergine",
  welcomeSeen: false,
};

export function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    const { imageBuffer, ...persistable } = settings;
    localStorage.setItem(STORE_KEY, JSON.stringify(persistable));
  } catch { /* storage may be unavailable in private mode */ }
}

const NET_LABEL = {
  wsproxy: "relay",
  wisp: "wisp",
  fetch: "http",
  none: "offline",
};
export const netLabel = (backend) => NET_LABEL[backend] || backend;

export class LinuxVM {
  constructor(settings) {
    this.settings = settings;
    this.emulator = null;
    this.phase = "idle";
    this.progress = 0;
    this.progressLabel = "";
    this.imageBuffer = null;
    this.listeners = new Set();
    this.mountedPath = null;
    this.saving = false;
    this.lastSaveAt = 0;
    this.lastSaveBytes = 0;
    this.savedSnapshot = null;
    this.restoring = false;
    this.restoredFrom = 0;
    this.autosaveTimer = 0;

    // Closing or reloading the tab hides it first, so try a last snapshot on the way out.
    // The IndexedDB write may not finish during unload — that is what the timer is for.
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.saveOnExit(); });
    window.addEventListener("pagehide", () => this.saveOnExit());
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch (err) { console.error(err); }
    }
  }

  get running() {
    return !!this.emulator && this.phase === "running";
  }

  netDevice() {
    const s = this.settings;
    const device = { type: s.nic || "ne2k" };
    if (s.backend === "none") return device;
    if (s.backend === "fetch") { device.relay_url = "fetch"; return device; }
    if (s.backend === "wisp") { device.relay_url = s.wispUrl || "wisp://localhost:12345"; return device; }
    device.relay_url = s.relayUrl || DEFAULT_SETTINGS.relayUrl;
    return device;
  }

  async destroy() {
    this.stopAutosave();
    if (this.emulator) {
      const emu = this.emulator;
      this.emulator = null;
      this.phase = "idle";
      try { await emu.destroy(); } catch { /* already torn down */ }
    }
  }

  /** True when a stored snapshot came from this exact machine configuration. */
  snapshotMatches(record, memoryMB) {
    const s = this.settings;
    if (!record || !record.blob) return false;
    const buffer = record.blob instanceof ArrayBuffer ? record.blob : record.blob.buffer;
    if (!buffer || buffer.byteLength < 4096) return false;
    try {
      // A truncated or foreign buffer would wedge restore_state, and v86 reports nothing for it.
      if (new Int32Array(buffer, 0, 2)[0] !== V86_STATE_MAGIC) return false;
    } catch { return false; }
    return record.imageUrl === s.imageUrl &&
      record.memoryMB === memoryMB &&
      (record.nic || "ne2k") === (s.nic || "ne2k") &&
      (record.backend || "wsproxy") === (s.backend || "wsproxy");
  }

  /**
   * Start (or restart) the machine. With `resume`, a snapshot of the same guest is restored
   * instead of cold-booting, so a page reload continues where the guest was.
   */
  async boot(screenContainer, { resume = true } = {}) {
    await this.destroy();
    if (!window.V86) throw new Error("v86 runtime failed to load (vm/libv86.js)");

    const s = this.settings;
    const memoryMB = Math.max(256, s.memoryMB || 512);

    let snapshot = null;
    if (resume) {
      snapshot = await readSnapshot().catch(() => null);
      if (snapshot && !this.snapshotMatches(snapshot, memoryMB)) snapshot = null;
    }
    // A snapshot we cannot use, or one the caller skipped, is stale: drop it rather than
    // restore an older machine over this one on the next reload.
    if (!snapshot) await deleteSnapshot().catch(() => undefined);
    this.restoring = !!snapshot;
    this.restoredFrom = snapshot ? snapshot.savedAt : 0;
    this.savedSnapshot = snapshot ? { savedAt: snapshot.savedAt, bytes: snapshot.blob.byteLength } : null;

    this.phase = "loading";
    this.progress = 0;
    this.progressLabel = snapshot ? "Restoring your saved session…" : "Downloading Linux image…";
    this.emit({ type: "phase" });

    const options = {
      wasm_path: "vm/v86.wasm",
      memory_size: memoryMB * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      bios: { url: "vm/seabios.bin" },
      vga_bios: { url: "vm/vgabios.bin" },
      cdrom: this.imageBuffer ? { buffer: this.imageBuffer } : { url: s.imageUrl || DEFAULT_SETTINGS.imageUrl },
      boot_order: 0x213, // CD, then hard disk, then floppy
      autostart: true,
      disable_speaker: true,
      uart1: true,
      screen: { container: screenContainer, scaling: 1 },
      filesystem: {}, // virtio-9p share used to hand host files to the guest
      net_device: this.netDevice(),
      // v86 loads RAM and device state from the snapshot instead of booting the CD.
      // It takes the state as { buffer }, not a bare ArrayBuffer (a bare one is fetched as a URL).
      initial_state: snapshot ? { buffer: snapshot.blob } : undefined,
    };

    const emulator = new window.V86(options);
    this.emulator = emulator;

    emulator.add_listener("download-progress", (e) => {
      if (!e || !e.total) return;
      this.progress = Math.max(1, Math.round((e.loaded / e.total) * 100));
      this.progressLabel = `Downloading ${e.file_name || "Linux image"} — ${this.progress}%`;
      this.emit({ type: "progress" });
    });
    emulator.add_listener("download-error", (e) => {
      this.phase = "error";
      this.emit({ type: "error", message: `Could not load ${e && e.file_name ? e.file_name : "a boot image"}. Check that the file exists and is served from the same origin.` });
    });
    emulator.add_listener("emulator-ready", () => {
      this.progress = 100;
      this.phase = "booting";
      this.progressLabel = "Starting the kernel…";
      this.emit({ type: "phase" });
    });
    emulator.add_listener("emulator-started", () => {
      this.phase = "running";
      this.restoring = false;
      this.emit({ type: "phase" });
      this.startAutosave();
    });
    emulator.add_listener("screen-set-size", (size) => {
      this.emit({ type: "screen", size });
    });

    return emulator;
  }

  restart() {
    if (!this.emulator) return;
    this.emulator.restart();
    this.phase = "booting";
    this.emit({ type: "phase" });
  }

  pause() {
    if (!this.emulator) return;
    this.emulator.stop();
    this.phase = "paused";
    this.emit({ type: "phase" });
  }

  resume() {
    if (!this.emulator) return;
    this.emulator.run();
    this.phase = "running";
    this.emit({ type: "phase" });
    this.startAutosave();
  }

  /* ---------- snapshots ---------- */

  startAutosave() {
    this.stopAutosave();
    this.autosaveTimer = setInterval(() => {
      if (document.hidden || this.phase !== "running" || this.saving) return;
      this.saveState({ silent: true });
    }, AUTOSAVE_MS);
  }

  stopAutosave() {
    if (this.autosaveTimer) clearInterval(this.autosaveTimer);
    this.autosaveTimer = 0;
  }

  /** Best-effort snapshot when the tab is hidden or closing. */
  saveOnExit() {
    if (this.phase !== "running" || this.saving) return;
    if (this.lastSaveAt && Date.now() - this.lastSaveAt < 8000) return;
    this.saveState({ silent: true });
  }

  /**
   * Write the running machine into IndexedDB. Silent saves (timer, page hide) report nothing
   * on success or failure; an explicit save emits progress for the Machine window.
   */
  async saveState({ silent = false } = {}) {
    const emu = this.emulator;
    if (!emu || this.phase !== "running") {
      if (!silent) this.emit({ type: "save", state: "unavailable" });
      return null;
    }
    if (this.saving) return null;
    this.saving = true;
    this.emit({ type: "save", state: "saving", silent });
    const started = performance.now();
    try {
      // v86 serialises RAM synchronously inside this call, so expect a short pause here.
      const blob = await emu.save_state();
      const s = this.settings;
      const record = {
        blob,
        savedAt: Date.now(),
        imageUrl: s.imageUrl,
        imageName: imageName(s.imageUrl),
        memoryMB: Math.max(256, s.memoryMB || 512),
        nic: s.nic || "ne2k",
        backend: s.backend || "wsproxy",
        bytes: blob.byteLength,
      };
      await writeSnapshot(record);
      // Clear the flag before announcing: listeners render the status bar from it.
      this.saving = false;
      this.lastSaveAt = record.savedAt;
      this.lastSaveBytes = record.bytes;
      this.savedSnapshot = { savedAt: record.savedAt, bytes: record.bytes };
      this.emit({
        type: "save", state: "saved", silent, at: record.savedAt, bytes: record.bytes,
        ms: Math.round(performance.now() - started),
      });
      return record;
    } catch (err) {
      const message = (err && err.message) || String(err);
      this.saving = false;
      this.emit({ type: "save", state: "error", silent, message });
      return null;
    } finally {
      this.saving = false;
    }
  }

  /** Throw the saved machine away and cold-boot a fresh guest. */
  async resetMachine(screenContainer) {
    this.stopAutosave();
    this.lastSaveAt = 0;
    this.lastSaveBytes = 0;
    this.savedSnapshot = null;
    await deleteSnapshot().catch(() => undefined);
    this.emit({ type: "save", state: "cleared" });
    return this.boot(screenContainer, { resume: false });
  }

  /** Send text as if typed on the guest's US keyboard. */
  type(text) {
    if (!this.emulator) return false;
    this.emulator.keyboard_send_text(text);
    return true;
  }

  pressEnter() {
    if (!this.emulator) return;
    this.emulator.keyboard_send_scancodes([0x1c, 0x9c]);
  }

  /** Type a shell command and press Enter. */
  command(cmd) {
    if (!this.emulator) return false;
    this.type(cmd);
    setTimeout(() => this.pressEnter(), 60);
    return true;
  }

  ctrlAltDel() {
    if (!this.emulator) return;
    this.emulator.keyboard_send_scancodes([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]);
  }

  setScale(scale) {
    if (!this.emulator) return;
    this.emulator.screen_set_scale(scale, scale);
  }

  focusScreen() {
    const container = document.querySelector(".vm-screen");
    if (container) container.focus();
  }

  screenshot() {
    if (!this.emulator) return null;
    return this.emulator.screen_make_screenshot();
  }

  /** Copy a file into the guest's 9p share so it appears under /mnt/host. */
  async shareFile(filename, bytes) {
    if (!this.emulator) throw new Error("Start the VM first.");
    const safe = String(filename).replace(/[^\w.\- ]+/g, "_").slice(-120) || "file";
    const path = `/${safe}`;
    await this.emulator.create_file(path, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    this.mountedPath = path;
    return { path, guestPath: `/mnt/host/${safe}` };
  }

  mountHint() {
    return `mkdir -p /mnt/host && mount -t 9p -o trans=virtio,version=9p2000.L ${MOUNT_TAG} /mnt/host`;
  }

  /** Bring the guest network up and refresh its package index. */
  networkSetup() {
    return this.command(NETWORK_SETUP_CMD);
  }
}
