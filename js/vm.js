// The single machine this site runs: Raspberry Pi Desktop for PC (32-bit x86) under v86.
//
// The ISO is never held in memory. It is read in slices straight from the File the user picked (or, for
// development, from a URL with HTTP range requests), which is what lets a 3.4 GB image boot in a tab.

export const PI_IMAGE = {
  name: "Raspberry Pi Desktop for PC",
  url: "https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso",
  page: "https://www.raspberrypi.com/software/raspberry-pi-desktop/",
  size: 3607101440,
  label: "3.4 GB · i386 live ISO",
};

export const RELAY_URL = "wss://wisp.anjomous.workers.dev/";
export const MEMORY_MB = 1024;

// A 3.4 GB ISO cannot be included in this GitHub Pages site: Pages has a 1 GB published-site limit.
// This URL is a range-enabled CORS proxy, not the ISO itself; see README for hosting constraints.
export const ISO_STREAM = {
  url: "https://pi-desktop-iso-proxy-jdg88r.freebuff.site/iso",
  size: 3607101440,
  chunkSize: 8 * 1024 * 1024,
};

const PATCH_SECTOR = 110737;
const PATCH_OFFSET = PATCH_SECTOR * 2048;
const PATCH_FROM = new TextEncoder().encode("quiet splash plymouth.ignore-serial-consoles persistence");
const PATCH_TO = new TextEncoder().encode("console=tty1 xforcevesa nomodeset");

function patchBytes(bytes) {
  const patched = bytes.slice();
  outer: for (let i = 0; i <= patched.length - PATCH_FROM.length; i++) {
    for (let j = 0; j < PATCH_FROM.length; j++) {
      if (patched[i + j] !== PATCH_FROM[j]) continue outer;
    }
    patched.set(PATCH_TO, i);
    patched.fill(0x20, i + PATCH_TO.length, i + PATCH_FROM.length);
  }
  return patched;
}

/** The 2 KiB boot-config sector, patched, or null when this ISO does not look like the one we know. */
export async function readPatchedBootSector(file) {
  const bytes = new Uint8Array(await file.slice(PATCH_OFFSET, PATCH_OFFSET + 2048).arrayBuffer());
  const patched = patchBytes(bytes);
  return patched.every((byte, index) => byte === bytes[index]) ? null : patched;
}

/**
 * A File that serves the patched sector for reads that touch it and the untouched image everywhere else.
 * v86 only ever asks for slices, so the 3.4 GB original is still read lazily from disk.
 */
export class PatchedISO extends File {
  constructor(original, sectorBytes) {
    super([], original.name, { type: original.type, lastModified: original.lastModified });
    this.original = original;
    this.sectorBytes = sectorBytes;
    this.sectorStart = PATCH_OFFSET;
    this.sectorEnd = PATCH_OFFSET + sectorBytes.length;
  }

  get size() {
    return this.original.size;
  }

  slice(start = 0, end = this.size, type) {
    const normalize = (value) => {
      const n = Number(value);
      if (Number.isNaN(n)) return 0;
      const integer = Math.trunc(n);
      return integer < 0 ? Math.max(this.size + integer, 0) : Math.min(integer, this.size);
    };
    const from = normalize(start);
    const to = Math.max(from, normalize(end));
    if (from >= to) return new Blob([], type ? { type } : undefined);
    if (to <= this.sectorStart || from >= this.sectorEnd) {
      return this.original.slice(from, to, type);
    }

    const parts = [];
    if (from < this.sectorStart) parts.push(this.original.slice(from, this.sectorStart));
    const patchedFrom = Math.max(from, this.sectorStart) - this.sectorStart;
    const patchedTo = Math.min(to, this.sectorEnd) - this.sectorStart;
    if (patchedTo > patchedFrom) parts.push(this.sectorBytes.subarray(patchedFrom, patchedTo));
    if (to > this.sectorEnd) parts.push(this.original.slice(this.sectorEnd, to));
    return new Blob(parts, type ? { type } : undefined);
  }
}

export class PiVM {
  constructor(settings = {}) {
    this.emulator = null;
    this.phase = "idle";
    this.errorMessage = "";
    this.listeners = new Set();
    this.sourceLabel = "";
    this.patchApplied = false;
    this.memoryMB = this.normalizeMemory(settings.memoryMB);
    this.relayUrl = this.normalizeRelay(settings.relayUrl);
  }

  normalizeMemory(value) {
    const memory = Number(value);
    return Number.isFinite(memory) ? Math.min(2048, Math.max(256, memory)) : MEMORY_MB;
  }

  normalizeRelay(value) {
    if (typeof value !== "string" || !value.trim()) return RELAY_URL;
    try {
      const url = new URL(value.trim());
      return ["ws:", "wss:"].includes(url.protocol) ? url.href : RELAY_URL;
    } catch {
      return RELAY_URL;
    }
  }

  /** Hardware options take effect the next time a machine is booted. */
  setSettings(settings = {}) {
    if (settings.memoryMB !== undefined) this.memoryMB = this.normalizeMemory(settings.memoryMB);
    if (settings.relayUrl !== undefined) this.relayUrl = this.normalizeRelay(settings.relayUrl);
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

  async destroy() {
    const emu = this.emulator;
    this.emulator = null;
    this.phase = "idle";
    if (emu) {
      try { await emu.destroy(); } catch { /* already gone */ }
    }
  }

  async cdromFor(file) {
    if (!file) throw new Error("Choose the Raspberry Pi Desktop ISO first.");
    this.patchApplied = false;
    try {
      const sector = await readPatchedBootSector(file);
      if (sector) {
        this.patchApplied = true;
        return { buffer: new PatchedISO(file, sector) };
      }
    } catch { /* fall through: boot the file untouched */ }
    return { buffer: file };
  }

  netDevice() {
    return { type: "ne2k", relay_url: this.relayUrl };
  }

  /** Start from a picked file or a range-served image. */
  async boot(screenContainer, source) {
    await this.destroy();
    if (!source || (!source.file && !source.url)) throw new Error("No boot image was specified.");
    if (!window.V86) throw new Error("v86 failed to load (vm/libv86.js)");

    this.phase = "booting";
    this.errorMessage = "";
    this.emit({ type: "phase" });
    try {
      const cdrom = source.url
        ? {
            url: source.url,
            size: source.size,
            async: true,
            fixed_chunk_size: source.chunkSize || ISO_STREAM.chunkSize,
          }
        : await this.cdromFor(source.file);

      this.sourceLabel = source.file ? source.file.name : "Raspberry Pi Desktop";
      const emulator = new window.V86({
        wasm_path: "vm/v86.wasm",
        memory_size: this.memoryMB * 1024 * 1024,
        vga_memory_size: 8 * 1024 * 1024,
        bios: { url: "vm/seabios.bin" },
        vga_bios: { url: "vm/vgabios.bin" },
        cdrom,
        boot_order: 0x213,
        autostart: true,
        disable_speaker: true,
        uart1: true,
        screen: { container: screenContainer, scaling: 1 },
        net_device: this.netDevice(),
      });
      this.emulator = emulator;

      emulator.add_listener("emulator-started", () => {
        if (this.emulator !== emulator) return;
        this.phase = "running";
        this.emit({ type: "phase" });
      });
      emulator.add_listener("screen-set-size", (size) => {
        if (this.emulator === emulator) this.emit({ type: "screen", size });
      });
      emulator.add_listener("download-error", (error) => {
        if (this.emulator !== emulator) return;
        this.phase = "error";
        this.errorMessage = `Could not read the image${error && error.file_name ? ` (${error.file_name})` : ""}.`;
        this.emit({ type: "phase" });
      });
      return emulator;
    } catch (error) {
      this.phase = "error";
      this.errorMessage = error?.message || String(error);
      this.emit({ type: "phase" });
      throw error;
    }
  }

  restart() {
    if (!this.emulator) return;
    this.emulator.restart();
    this.phase = "booting";
    this.emit({ type: "phase" });
  }

  pause() {
    if (!this.emulator || this.phase !== "running") return;
    this.emulator.stop();
    this.phase = "paused";
    this.emit({ type: "phase" });
  }

  resume() {
    if (!this.emulator || this.phase !== "paused") return;
    this.emulator.run();
    this.phase = "running";
    this.emit({ type: "phase" });
  }

  type(text) {
    if (!this.emulator) return false;
    this.emulator.keyboard_send_text(text);
    return true;
  }

  pressEnter() {
    if (!this.emulator) return;
    this.emulator.keyboard_send_scancodes([0x1c, 0x9c]);
  }

  lockMouse() {
    if (!this.emulator || this.phase !== "running" || document.pointerLockElement) return false;
    try {
      const request = this.emulator.lock_mouse();
      if (request && typeof request.catch === "function") request.catch(() => {});
      return true;
    } catch {
      return false;
    }
  }
}
