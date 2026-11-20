// The single machine this site runs: Raspberry Pi Desktop for PC (32-bit x86) under v86.
//
// The ISO is never held in memory. It is read in slices straight from the File the user picked (or, for
// development, from a URL with HTTP range requests), which is what lets a 3.4 GB image boot in a tab.

export const PI_IMAGE = {
  name: "Raspberry Pi Desktop for PC",
  url: "https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso",
  page: "https://www.raspberrypi.com/software/raspberry-pi-desktop/",
  size: 3607101440, // bytes; the 2022-07-01 i386 live ISO
  label: "3.4 GB · Debian 11 · 32-bit i386",
};

export const RELAY_URL = "wss://relay.widgetry.org/";
export const MEMORY_MB = 1024;

// The ISO's syslinux config lives in one 2 KiB sector, and the live-boot line in it decides whether the
// machine ever finishes starting: plymouth's splash never quits on this emulated VGA, so the boot hangs
// behind it. Rewriting the parameters in place (same byte length, so the ISO9660 directory stays valid)
// drops the splash, forces X onto the plain VESA driver and keeps the kernel log on the console.
const PATCH_SECTOR = 110737;
const PATCH_OFFSET = PATCH_SECTOR * 2048;
const PATCH_FROM = "quiet splash plymouth.ignore-serial-consoles persistence";
const PATCH_TO = "console=tty1 xforcevesa nomodeset";

/** The 2 KiB boot-config sector, patched, or null when this ISO does not look like the one we know. */
export async function readPatchedBootSector(file) {
  const blob = file.slice(PATCH_OFFSET, PATCH_OFFSET + 2048);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.includes(PATCH_FROM)) return null;
  const patched = text.split(PATCH_FROM).join(PATCH_TO.padEnd(PATCH_FROM.length, " "));
  return new TextEncoder().encode(patched);
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
    if (end <= this.sectorStart || start >= this.sectorEnd) {
      return this.original.slice(start, end, type);
    }
    // Reads that straddle the sector are reassembled from three parts; no byte is ever read eagerly.
    const parts = [];
    if (start < this.sectorStart) parts.push(this.original.slice(start, Math.min(end, this.sectorStart)));
    const from = Math.max(start, this.sectorStart) - this.sectorStart;
    const to = Math.min(end, this.sectorEnd) - this.sectorStart;
    parts.push(this.sectorBytes.subarray(from, Math.max(from, to)));
    if (end > this.sectorEnd) parts.push(this.original.slice(Math.max(start, this.sectorEnd), end));
    return new Blob(parts, type ? { type } : undefined);
  }
}

export class PiVM {
  constructor() {
    this.emulator = null;
    this.phase = "idle"; // idle | booting | running | paused | error
    this.errorMessage = "";
    this.listeners = new Set();
    this.sourceLabel = "";
    this.patchApplied = false;
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

  /** Build v86's CD option for a picked file, applying the boot-sector patch when it is our ISO. */
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
    return { type: "ne2k", relay_url: RELAY_URL };
  }

  /**
   * Start the machine in `screenContainer`. `source` is either { file } (the normal path) or
   * { url, size } for a range-served image; both are read lazily by v86.
   */
  async boot(screenContainer, source) {
    await this.destroy();
    if (!window.V86) throw new Error("v86 failed to load (vm/libv86.js)");

    const cdrom = source.url
      ? { url: source.url, size: source.size, async: true, fixed_chunk_size: 512 * 1024 }
      : await this.cdromFor(source.file);

    this.sourceLabel = source.file ? source.file.name : "Raspberry Pi Desktop";
    this.phase = "booting";
    this.emit({ type: "phase" });

    const emulator = new window.V86({
      wasm_path: "vm/v86.wasm",
      memory_size: MEMORY_MB * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      bios: { url: "vm/seabios.bin" },
      vga_bios: { url: "vm/vgabios.bin" },
      cdrom,
      boot_order: 0x213, // CD first
      autostart: true,
      disable_speaker: true,
      uart1: true,
      screen: { container: screenContainer, scaling: 1 },
      net_device: this.netDevice(),
    });
    this.emulator = emulator;

    emulator.add_listener("emulator-started", () => {
      this.phase = "running";
      this.emit({ type: "phase" });
    });
    emulator.add_listener("screen-set-size", (size) => this.emit({ type: "screen", size }));
    emulator.add_listener("download-error", (e) => {
      this.phase = "error";
      this.errorMessage = `Could not read the image${e && e.file_name ? ` (${e.file_name})` : ""}.`;
      this.emit({ type: "phase" });
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

  /** Type text on the guest's US keyboard (used by Paste). */
  type(text) {
    if (!this.emulator) return false;
    this.emulator.keyboard_send_text(text);
    return true;
  }

  pressEnter() {
    if (!this.emulator) return;
    this.emulator.keyboard_send_scancodes([0x1c, 0x9c]);
  }

  /** Capture the host pointer so the guest cursor keeps moving at the screen's edges. */
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
