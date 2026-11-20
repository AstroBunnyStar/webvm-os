// Raspberry Pi Desktop in a tab: start the machine, use it, tune it.
import { PiVM, PI_IMAGE, ISO_STREAM, RELAY_URL } from "./vm.js";

const SETTINGS_KEY = "pidesk.settings.v1";
const DEFAULTS = { memoryMB: 1024, chunkMB: 8, imageUrl: ISO_STREAM.url, relayUrl: RELAY_URL };

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      memoryMB: Number(raw.memoryMB) || DEFAULTS.memoryMB,
      chunkMB: Number(raw.chunkMB) || DEFAULTS.chunkMB,
      imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl ? raw.imageUrl : DEFAULTS.imageUrl,
      relayUrl: typeof raw.relayUrl === "string" && raw.relayUrl ? raw.relayUrl : DEFAULTS.relayUrl,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

let settings = loadSettings();
const vm = new PiVM({ memoryMB: settings.memoryMB, relayUrl: settings.relayUrl });
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
const startBtn = $("start");
let booting = false;
let sourceMode = "stream";
let selectedFile = null;
let nudges = [];

function fitBox() {
  const full = document.fullscreenElement === screen;
  const el = full ? screen : wrap;
  const pad = full ? 0 : 16;
  return { full, w: Math.max(240, el.clientWidth - pad), h: Math.max(160, el.clientHeight - pad) };
}

function fitCanvas() {
  const canvas = screen.querySelector("canvas");
  if (!canvas || !canvas.width || canvas.width < 320) return;
  const box = fitBox();
  const ratio = Math.min(box.w / canvas.width, box.h / canvas.height);
  const factor = box.full ? ratio : Math.min(1, ratio);
  canvas.style.width = `${Math.round(canvas.width * factor)}px`;
  canvas.style.height = `${Math.round(canvas.height * factor)}px`;
}

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
  const px = Math.max(6, Math.floor(base * Math.min(1, box.w / w, box.h / h)));
  text.style.fontSize = `${px}px`;
  text.style.lineHeight = `${px}px`;
}

const refit = () => { fitCanvas(); fitText(); };
window.addEventListener("resize", refit);
document.addEventListener("fullscreenchange", refit);
setInterval(refit, 2000);

const PHASE_TEXT = { idle: "stopped", booting: "booting", running: "running", paused: "paused", error: "error" };
function render() {
  const phase = vm.phase;
  statusEl.textContent = PHASE_TEXT[phase] || phase;
  statusEl.className = `status ${phase === "running" ? "live" : phase === "booting" ? "busy" : phase === "error" ? "err" : ""}`;
  phaseEl.textContent = phase === "error" ? (vm.errorMessage || "error") : (PHASE_TEXT[phase] || phase);
  startBtn.disabled = booting || phase === "booting" || phase === "running" || phase === "paused";
  restartBtn.disabled = booting || (!vm.emulator && !selectedFile);
  pauseBtn.disabled = phase !== "running" && phase !== "paused";
  pauseBtn.textContent = phase === "paused" ? "▶ Resume" : "⏸ Pause";
  pasteBtn.disabled = phase !== "running";
  fullBtn.disabled = phase !== "running";
}

vm.on((event) => {
  if (event.type === "screen") requestAnimationFrame(refit);
  if (event.type === "phase" && vm.phase === "error") showOverlayError(vm.errorMessage || "The image could not be read.");
  render();
});

function clearNudges() {
  nudges.forEach(clearTimeout);
  nudges = [];
}

function nudgeBootMenu() {
  clearNudges();
  const delays = [20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 100000];
  nudges = delays.map((delay, index) => setTimeout(() => {
    if (vm.phase === "running" || vm.phase === "booting") vm.pressEnter();
    if (index === delays.length - 1) clearNudges();
  }, delay));
}

function showOverlayError(message) {
  bootMsg.textContent = "The machine did not start.";
  note.textContent = message;
  note.classList.add("err");
  fallback.hidden = false;
  overlay.classList.remove("hidden");
}

async function runBoot(source) {
  if (booting) return;
  booting = true;
  clearNudges();
  render();
  try {
    await vm.boot(screen, source);
    overlay.classList.add("hidden");
    bootMsg.textContent = "The image is streaming; the boot console appears in a moment.";
    nudgeBootMenu();
  } catch (error) {
    vm.phase = "error";
    vm.errorMessage = error?.message || String(error);
    showOverlayError(vm.errorMessage);
  } finally {
    booting = false;
    render();
  }
}

async function startStreaming() {
  sourceMode = "stream";
  selectedFile = null;
  bootMsg.textContent = "Contacting the image proxy…";
  detailEl.textContent = `${settings.memoryMB} MB · streaming · ${settings.chunkMB} MB reads`;
  await runBoot({ url: settings.imageUrl, size: ISO_STREAM.size, chunkSize: settings.chunkMB * 1024 * 1024 });
}

async function start(file) {
  if (!file) return;
  if (/amd64|x86[_-]?64/i.test(file.name)) {
    note.textContent = `${file.name} is a 64-bit image; this emulator is 32-bit x86. Use the 2022-07-01 i386 ISO.`;
    note.classList.add("err");
    fallback.hidden = false;
    return;
  }
  sourceMode = "file";
  selectedFile = file;
  note.classList.remove("err");
  detailEl.textContent = `${file.name} · ${Math.round(file.size / 1048576)} MB`;
  await runBoot({ file });
}

isoInput.addEventListener("change", () => {
  const file = isoInput.files?.[0];
  if (file) start(file);
});

let dragDepth = 0;
document.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  document.body.classList.add("dropping");
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("dragleave", (event) => {
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("dropping");
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("dropping");
  const file = event.dataTransfer?.files?.[0];
  if (file) start(file);
});

startBtn.addEventListener("click", startStreaming);
$("start-big").addEventListener("click", startStreaming);

$("settings-open").addEventListener("click", () => {
  $("set-memory").value = String(settings.memoryMB);
  $("set-chunk").value = String(settings.chunkMB);
  $("set-image").value = settings.imageUrl;
  $("set-relay").value = settings.relayUrl;
  $("settings-note").textContent = vm.emulator
    ? "Saved settings apply when the machine is started again. Use Restart to apply them now."
    : "Applies the next time the machine starts.";
  $("settings").showModal();
});

$("settings-form").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  settings = {
    memoryMB: Number($("set-memory").value) || DEFAULTS.memoryMB,
    chunkMB: Number($("set-chunk").value) || DEFAULTS.chunkMB,
    imageUrl: $("set-image").value.trim() || DEFAULTS.imageUrl,
    relayUrl: $("set-relay").value.trim() || DEFAULTS.relayUrl,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode: visit-only settings */ }
  vm.setSettings({ memoryMB: settings.memoryMB, relayUrl: settings.relayUrl });
  detailEl.textContent = `${settings.memoryMB} MB · ${settings.chunkMB} MB reads`;
});

restartBtn.addEventListener("click", () => {
  if (sourceMode === "file" && selectedFile) start(selectedFile);
  else startStreaming();
});

pauseBtn.addEventListener("click", () => {
  if (vm.phase === "paused") vm.resume();
  else vm.pause();
});

pasteBtn.addEventListener("click", async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) vm.type(text);
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
  detailEl.textContent = document.pointerLockElement
    ? "mouse captured — Esc releases it"
    : `${PI_IMAGE.label} · ${settings.memoryMB} MB · ${settings.chunkMB} MB reads`;
});

detailEl.textContent = `${PI_IMAGE.label} · ${settings.memoryMB} MB · ${settings.chunkMB} MB reads`;
if (!(ISO_STREAM && ISO_STREAM.url) && !settings.imageUrl) {
  bootMsg.textContent = "No image source configured — choose an ISO to start the machine.";
  fallback.hidden = false;
}
render();
