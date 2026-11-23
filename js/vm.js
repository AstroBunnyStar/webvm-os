// The machine controller: v86, plus the lazy image plumbing that lets a multi-gigabyte disk boot in a tab.
//
// Nothing is downloaded whole. The image is read in slices straight from the edge proxy (or from a File the
// user picked), which is what makes a 3.9 GB DVD work here.

import { RelayImage } from "./wisp.js";
import { proxied } from "./distros.js";

export const RELAY_URL = "wss://relay.widgetry.org/";
export const MEMORY_MB = 1024;
/** How much of the guest's serial output is kept; a booting desktop can print megabytes through journald. */
const SERIAL_LIMIT = 128 * 1024;

/** Where each kind of image is attached in v86, and which device SeaBIOS should try first. */
const DRIVE = { iso: "cdrom", hdd: "hda", floppy: "fda" };
// v86 reads boot_order from its lowest nibble: 1 = floppy, 2 = hard disk, 3 = CD-ROM.
const BOOT_ORDER = { iso: 0x213, hdd: 0x132, floppy: 0x123 };

// Raspberry Pi Desktop's boot path, as measured on this emulator: El Torito starts isolinux.bin, archdetect
// finds a 32-bit CPU that reports PAE, and the i386 menu's default entry — isolinux/x86run.cfg — loads
// /live/vmlinuz1, Debian's 686-pae kernel. That kernel boots, reaches X, then faults in the block layer and
// stalls RCU, so the entry is also moved to the non-PAE pair (/live/vmlinuz0, /live/initrd0.img) that
// isolinux/nopaerun.cfg uses for CPUs without PAE. Both replacement names are as long as the originals.
//
// The command line is rewritten in both isolinux sectors: plymouth's splash never quits on this emulated VGA,
// so it is dropped and X is forced onto plain VESA. The same line puts a console on COM1 and turns on
// journald's console forwarding, which is what makes kernel messages and each service's own output readable
// through the serial capture even while X, or a greeter that never paints, holds the screen.
//
// Every substitution leaves the sector exactly 2 KiB, which is what lets an in-place edit work at all: the
// ISO9660 directory records still describe the same extents. The command line got longer, so it takes room
// from the sectors' trailing zero padding rather than from the rest of the text.
const CMDLINE = [
  "quiet splash plymouth.ignore-serial-consoles persistence",
  "console=tty1 console=ttyS0 xforcevesa nomodeset systemd.journald.forward_to_console=1",
];
const NON_PAE = [
  ["/live/vmlinuz1", "/live/vmlinuz0"],
  ["/live/initrd1.img", "/live/initrd0.img"],
];

const PATCHES = [
  // isolinux/x86run.cfg — what runs here, so it needs the non-PAE kernel on top of the command line.
  { offset: 110737 * 2048, length: 2048, patches: [CMDLINE, ...NON_PAE] },
  // isolinux/nopaerun.cfg — the menu for CPUs without PAE: the command line only.
  { offset: 110684 * 2048, length: 2048, patches: [CMDLINE] },
];

/**
 * Rewrite one boot-config sector, or return null when none of these patches belongs in it.
 *
 * The sector is held as a string of one character per byte, so indexOf and slice do the searching: every
 * occurrence is replaced, which these menus need because each one lists two entries. A replacement at least
 * as long as the text it replaces takes the extra room from the sector's trailing padding and cuts the text
 * after it short by the same amount, so the sector stays exactly 2 KiB and the ISO9660 directory record and
 * the boot loader keep reading the same extent. (A shorter replacement is nobody's case: the kernel names are
 * the same length and the command line is longer.)
 */
function patchSector(bytes, patches) {
  const size = bytes.length;
  const original = String.fromCharCode(...bytes);
  let text = original;
  for (const [from, to] of patches) {
    const grow = to.length - from.length;
    for (let at = text.indexOf(from); at !== -1; at = text.indexOf(from, at + to.length)) {
      // Growth larger than the padding left would drop real text off the end, so it is not attempted.
      if (grow > size - text.replace(/[\x00 \n]+$/, "").length) break;
      text = text.slice(0, at) + to + text.slice(at + from.length, size - grow);
    }
  }
  return text === original ? null : Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

/**
 * Every known boot-config sector of this image, patched, or null when the file is not the one we know.
 * Two 2 KiB slices are enough to tell it apart, and nothing else is read up front.
 */
export async function readPatchedSectors(file) {
  const found = [];
  for (const patch of PATCHES) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.slice(patch.offset, patch.offset + patch.length).arrayBuffer());
    } catch {
      continue;
    }
    const patched = patchSector(bytes, patch.patches);
    if (patched) found.push({ start: patch.offset, bytes: patched });
  }
  return found.length ? found.sort((a, b) => a.start - b.start) : null;
}

/**
 * A File that serves the patched sectors for reads that touch them and the untouched image everywhere else.
 * v86 only ever asks for slices, so the original is still read lazily from disk.
 */
export class PatchedISO extends File {
  constructor(original, windows) {
    super([], original.name, { type: original.type, lastModified: original.lastModified });
    this.original = original;
    this.windows = windows.map((window) => ({
      start: window.start,
      end: window.start + window.bytes.length,
      bytes: window.bytes,
    }));
  }

  get size() {
    return this.original.size;
  }

  slice(start = 0, end = this.size, type) {
    const hits = this.windows.filter((window) => window.start < end && window.end > start);
    if (!hits.length) return this.original.slice(start, end, type);
    // Reads that straddle a sector are reassembled from its patched bytes; no byte is ever read eagerly.
    const parts = [];
    let cursor = start;
    for (const window of hits) {
      if (window.start > cursor) parts.push(this.original.slice(cursor, Math.min(window.start, end)));
      const from = Math.max(start, window.start) - window.start;
      const to = Math.min(end, window.end) - window.start;
      if (to > from) parts.push(window.bytes.subarray(from, to));
      cursor = Math.max(cursor, window.end);
    }
    if (cursor < end) parts.push(this.original.slice(cursor, end));
    return new Blob(parts, type ? { type } : undefined);
  }
}

export class PiVM {
  constructor(settings = {}) {
    this.emulator = null;
    this.transport = null;
    this.phase = "idle"; // idle | booting | running | paused | error
    this.errorMessage = "";
    this.listeners = new Set();
    this.sourceLabel = "";
    this.patchApplied = false;
    this.serial = "";
    this.serialTrimmed = false;
    this._serialChunk = [];
    this._serialFlush = 0;
    this.memoryMB = Math.min(2048, Math.max(256, Number(settings.memoryMB) || MEMORY_MB));
    this.relayUrl = settings.relayUrl || RELAY_URL;
  }

  /** Hardware options take effect on the next boot; the guest cannot change RAM while it runs. */
  setSettings(settings = {}) {
    if (settings.memoryMB) this.memoryMB = Math.min(2048, Math.max(256, Number(settings.memoryMB)));
    if (settings.relayUrl) this.relayUrl = settings.relayUrl;
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
    if (this._serialFlush) {
      clearTimeout(this._serialFlush);
      this._serialFlush = 0;
    }
    this._serialChunk = [];
    this.clearSerial();
    if (this.transport) {
      this.transport.uninstall();
      this.transport = null;
    }
    if (emu) {
      try { await emu.destroy(); } catch { /* already gone */ }
    }
  }

  /** Attach a picked file. Only the Raspberry Pi ISO has boot sectors we know how to patch. */
  async diskFor(file, kind) {
    if (!file) throw new Error("Choose a disk image first.");
    if (kind !== "iso") return { buffer: file };
    this.patchApplied = false;
    try {
      const windows = await readPatchedSectors(file);
      if (windows) {
        this.patchApplied = true;
        return { buffer: new PatchedISO(file, windows) };
      }
    } catch { /* fall through: boot the file untouched */ }
    return { buffer: file };
  }

  netDevice() {
    return { type: "ne2k", relay_url: this.relayUrl };
  }

  /**
   * Route the image's range reads through a Wisp relay. The first 2 KiB are read before boot, so a relay
   * that cannot reach the proxy costs one failed request instead of a broken machine.
   */
  async attachRelay(url, relay) {
    const transport = new RelayImage({
      url,
      relay,
      onEvent: (event) => this.emit(event),
    });
    transport.install();
    this.transport = transport;
    this.emit({ type: "transport", mode: "relay", relay: transport.relay });
    try {
      await transport.check();
    } catch (error) {
      transport.uninstall();
      this.transport = null;
      this.emit({
        type: "transport",
        mode: "direct",
        error: (error && error.message) || String(error),
      });
    }
  }

  /**
   * Start a machine in `screenContainer`.
   *
   * `source` is one of:
   *   { distro }                     a catalog entry; the image streams from the edge proxy
   *   { file, kind }                 a disk image the user picked (kind: iso | hdd | floppy)
   *   { url, size, kind, chunkSize } an explicit range-served image
   *
   * `relay` moves the image's range reads onto a Wisp relay, TLS and all, before v86 is built.
   */
  async boot(screenContainer, source) {
    await this.destroy();
    if (!window.V86) throw new Error("v86 failed to load (vm/libv86.js)");

    const distro = source.distro || null;
    const kind = (distro && distro.kind) || source.kind || "iso";
    const imageUrl = distro ? proxied(distro.url) : source.url || "";
    const size = distro ? distro.size : source.size;
    const chunkSize = Math.max(1024 * 1024, Number(source.chunkSize) || 8 * 1024 * 1024);

    if (imageUrl && source.relay) await this.attachRelay(imageUrl, source.relay);

    const drive = imageUrl
      ? {
          url: imageUrl,
          size,
          async: true,
          fixed_chunk_size: Math.min(chunkSize, Math.max(1024 * 1024, Number(size) || chunkSize)),
        }
      : await this.diskFor(source.file, kind);

    this.sourceLabel = distro
      ? `${distro.name} ${distro.version}`
      : source.file
        ? source.file.name
        : "image";
    this.phase = "booting";
    this.emit({ type: "phase" });

    const emulator = new window.V86({
      wasm_path: "vm/v86.wasm",
      memory_size: this.memoryMB * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      bios: { url: "vm/seabios.bin" },
      vga_bios: { url: "vm/vgabios.bin" },
      [DRIVE[kind] || "cdrom"]: drive,
      boot_order: BOOT_ORDER[kind] || BOOT_ORDER.iso,
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
    // COM1 is wired up in v86 whether or not the guest configures it; the Pi ISO's command line puts a console
    // there, so this is where the kernel log and journald's forwarded service output arrive.
    emulator.add_listener("serial0-output-byte", (byte) => this.captureSerial(byte));
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

  /** Keep the byte stream the guest writes to COM1, in a buffer the page can read while X holds the screen. */
  captureSerial(byte) {
    this._serialChunk.push(byte & 0xff);
    if (this._serialChunk.length >= 4096) {
      this.flushSerial();
      return;
    }
    // A quiet guest still has to reach the panel, so a partial chunk is flushed shortly after it tails off.
    if (!this._serialFlush) {
      this._serialFlush = setTimeout(() => {
        this._serialFlush = 0;
        this.flushSerial();
      }, 250);
    }
  }

  flushSerial() {
    if (!this._serialChunk.length) return;
    const chunk = new Uint8Array(this._serialChunk);
    this._serialChunk = [];
    this.serial += new TextDecoder().decode(chunk);
    if (this.serial.length > SERIAL_LIMIT) {
      this.serial = this.serial.slice(this.serial.length - SERIAL_LIMIT);
      this.serialTrimmed = true;
    }
    this.emit({ type: "serial" });
  }

  clearSerial() {
    this.serial = "";
    this.serialTrimmed = false;
    this.emit({ type: "serial" });
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
