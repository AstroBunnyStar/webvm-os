// Raspberry Pi Desktop in a tab: pick the ISO, boot it, use the machine.
import { PiVM, PI_IMAGE, ISO_STREAM } from "./vm.js";

const vm = new PiVM();
const $ = (id) => document.getElementById(id);

const screen = $("screen_container");
const wrap = document.querySelector(".screen-wrap");
const overlay = $("overlay");
const isoInput = $("iso");
const note = $("note");
const bootMsg = $("bootmsg");
const fallback = $("fallback");
const statusEl = $("status");
const phaseEl = $("phase");
const detailEl = $("detail");
const restartBtn = $("restart");
const pauseBtn = $("pause");
const pasteBtn = $("paste");
const fullBtn = $("full");

/* ---------- display fitting ---------- */

function fitBox() {
  const full = document.fullscreenElement === screen;
  const el = full ? screen : wrap;
  const pad = full ? 0 : 16;
  return {
    full,
    w: Math.max(240, el.clientWidth - pad),
    h: Math.max(160, el.clientHeight - pad),
  };
}

/** Size the guest from its own framebuffer, so windowed use stays pixel-exact and fullscreen fills. */
function fitCanvas() {
  const canvas = screen.querySelector("canvas");
  if (!canvas || !canvas.width || canvas.width < 320) return;
  const box = fitBox();
  const ratio = Math.min(box.w / canvas.width, box.h / canvas.height);
  const factor = box.full ? ratio : Math.min(1, ratio);
  canvas.style.width = `${Math.round(canvas.width * factor)}px`;
  canvas.style.height = `${Math.round(canvas.height * factor)}px`;
}

/** v86 renders text mode into a monospaced div; shrink the font until the 80-column console fits. */
function fitText() {
  const text = screen.querySelector(".vm-text");
  if (!text || getComputedStyle(text).display === "none") return;
  const base = 14;
  text.style.fontSize = `${base}px`;
  text.style.lineHeight = `${base}px`;
  const w = text.scrollWidth || text.offsetWidth;
  const h = text.scrollHeight || text.offsetHeight;
  if (!w || !h) return;
  const box = fitBox();
  const k = Math.min(1, box.w / w, box.h / h);
  const px = Math.max(6, Math.floor(base * k));
  text.style.fontSize = `${px}px`;
  text.style.lineHeight = `${px}px`;
}

const refit = () => { fitCanvas(); fitText(); };
window.addEventListener("resize", refit);
document.addEventListener("fullscreenchange", refit);
setInterval(refit, 2000); // the guest can switch video modes at any time

/* ---------- status ---------- */

const PHASE_TEXT = {
  idle: "no image",
  booting: "booting",
  running: "running",
  paused: "paused",
  error: "error",
};

function render() {
  const phase = vm.phase;
  statusEl.textContent = PHASE_TEXT[phase] || phase;
  statusEl.className = `status ${phase === "running" ? "live" : phase === "booting" ? "busy" : phase === "error" ? "err" : ""}`;
  phaseEl.textContent = phase === "error" ? (vm.errorMessage || "error") : (PHASE_TEXT[phase] || phase);
  restartBtn.disabled = !vm.emulator;
  pauseBtn.disabled = phase !== "running" && phase !== "paused";
  pauseBtn.textContent = phase === "paused" ? "▶ Resume" : "⏸ Pause";
  pasteBtn.disabled = phase !== "running";
  fullBtn.disabled = phase !== "running";
}

vm.on((event) => {
  if (event.type === "screen") requestAnimationFrame(refit);
  if (event.type === "phase" && vm.phase === "error") {
    showOverlayError(vm.errorMessage || "The image could not be read.");
  }
  render();
});

/* ---------- booting ---------- */

let nudges = [];

/**
 * The ISO's syslinux menu is configured with `timeout 0`, so it waits for a keypress for ever. Press
 * Enter once the menu is up, and keep pressing: the menu only appears after the kernel and initrd have
 * been read, which takes longer on a slow disk.
 */
function nudgeBootMenu() {
  nudges.forEach(clearTimeout);
  nudges = [20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000].map((delay) =>
    setTimeout(() => {
      if (vm.phase === "running" || vm.phase === "booting") vm.pressEnter();
    }, delay),
  );
}

/** Bring the boot card back with an explanation and the local-file escape hatch. */
function showOverlayError(message) {
  bootMsg.textContent = "The machine did not start.";
  note.textContent = message;
  note.classList.add("err");
  fallback.hidden = false;
  overlay.classList.remove("hidden");
}

/** Boot the image the site carries, streamed from the edge proxy: no download, no file picker. */
async function startStreaming() {
  bootMsg.textContent = "Contacting the image proxy…";
  detailEl.textContent = "streaming · Raspberry Pi Desktop 2022-07-01 i386";
  render();
  try {
    await vm.boot(screen, {
      url: ISO_STREAM.url,
      size: ISO_STREAM.size,
      chunkSize: ISO_STREAM.chunkSize,
    });
    bootMsg.textContent = "The image is streaming; the boot console appears in a moment.";
    overlay.classList.add("hidden");
    nudgeBootMenu();
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    showOverlayError(vm.errorMessage);
    render();
  }
}

async function start(file) {
  if (!file) return;
  if (/amd64|x86[_-]?64/i.test(file.name)) {
    note.textContent = `${file.name} is a 64-bit image; this emulator is 32-bit x86. Use the 2022-07-01 i386 ISO.`;
    note.classList.add("err");
    fallback.hidden = false;
    return;
  }

  note.classList.remove("err");
  detailEl.textContent = `${file.name} · ${Math.round(file.size / 1048576)} MB`;
  overlay.classList.add("hidden");
  render();

  try {
    await vm.boot(screen, { file });
    nudgeBootMenu();
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    showOverlayError(vm.errorMessage);
    render();
  }
}

isoInput.addEventListener("change", () => {
  const file = isoInput.files && isoInput.files[0];
  if (file) start(file);
});

// Dropping the ISO anywhere on the page starts it, so the picker is not the only way in.
["dragenter", "dragover"].forEach((type) =>
  document.addEventListener(type, (event) => {
    event.preventDefault();
    document.body.classList.add("dropping");
  }),
);
["dragleave", "dragend"].forEach((type) =>
  document.addEventListener(type, (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dropping");
  }),
);
document.addEventListener("drop", (event) => {
  event.preventDefault();
  document.body.classList.remove("dropping");
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) start(file);
});

/* ---------- controls ---------- */

restartBtn.addEventListener("click", () => {
  vm.restart();
  nudgeBootMenu();
});

pauseBtn.addEventListener("click", () => {
  if (vm.phase === "paused") vm.resume();
  else vm.pause();
});

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return;
    vm.type(text);
  } catch {
    note.textContent = "The browser blocked clipboard access.";
  }
});

fullBtn.addEventListener("click", () => {
  if (vm.emulator) vm.emulator.screen_go_fullscreen();
});

screen.addEventListener("pointerdown", (event) => {
  screen.focus();
  if (event.button === 0 && !document.pointerLockElement && vm.phase === "running") vm.lockMouse();
});

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement) detailEl.textContent = "mouse captured — Esc releases it";
});

/* ---------- go ---------- */

window.pidesk = { vm, start, startStreaming };

if (ISO_STREAM && ISO_STREAM.url) {
  startStreaming();
} else {
  detailEl.textContent = PI_IMAGE.label;
  bootMsg.textContent = "Choose the ISO to start the machine.";
  fallback.hidden = false;
}
render();
