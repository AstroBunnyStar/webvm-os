// One page, many machines: pick a distro, it boots in the tab.
import { PiVM, RELAY_URL, MEMORY_MB } from "./vm.js";
import { DISTROS, GROUPS, IMAGE_PROXY, DEFAULT_MACHINE, machineById } from "./distros.js";
import { WISP_RELAYS, DEFAULT_RELAY, normalizeRelay, scanRelays } from "./wisp.js";

const SETTINGS_KEY = "pidesk.settings.v2";
const DEFAULTS = {
  memoryMB: MEMORY_MB,
  chunkMB: 8,
  relayUrl: RELAY_URL,
  // "direct" reads the image from the edge proxy. "wisp" routes those reads through a Wisp relay, which
  // is still experimental here: TLS in the tab loads and the preflight succeeds, but image reads can
  // stall, so a machine only uses it when it is chosen explicitly.
  relayMode: "direct",
  wispRelay: DEFAULT_RELAY,
  machineId: DEFAULT_MACHINE.id,
};

/** Nothing boots on page load, so a visit costs the image proxy nothing until a machine is picked. */
function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      memoryMB: Number(raw.memoryMB) || DEFAULTS.memoryMB,
      chunkMB: Number(raw.chunkMB) || DEFAULTS.chunkMB,
      relayUrl: typeof raw.relayUrl === "string" && raw.relayUrl ? raw.relayUrl : DEFAULTS.relayUrl,
      // Only an explicit "wisp" switches modes: a half-working relay must never become the default.
      relayMode: raw.relayMode === "wisp" ? "wisp" : "direct",
      wispRelay: normalizeRelay(raw.wispRelay) || DEFAULTS.wispRelay,
      machineId: machineById(raw.machineId).id,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode: settings just last for this visit */
  }
}

let settings = loadSettings();
let current = machineById(settings.machineId);
const vm = new PiVM({ memoryMB: settings.memoryMB, relayUrl: settings.relayUrl });
const $ = (id) => document.getElementById(id);

const screen = $("screen_container");
const wrap = document.querySelector(".screen-wrap");
const overlay = $("overlay");
const catalogEl = $("catalog");
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
const machinesBtn = $("machines");
const settingsDialog = $("settings");
const brandName = $("brand-name");
const brandSub = $("brand-sub");
const creditEl = $("credit");
const serialDialog = $("serial");
const serialLogEl = $("serial-log");
const serialStateEl = $("serial-state");

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
  idle: "stopped",
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
  startBtn.disabled = phase === "booting" || phase === "running" || phase === "paused" || !!current.byo;
  restartBtn.disabled = !vm.emulator;
  pauseBtn.disabled = phase !== "running" && phase !== "paused";
  pauseBtn.textContent = phase === "paused" ? "▶ Resume" : "⏸ Pause";
  pasteBtn.disabled = phase !== "running";
  fullBtn.disabled = phase !== "running";
}

vm.on((event) => {
  if (event.type === "screen") requestAnimationFrame(refit);
  if (event.type === "serial") scheduleSerial();
  if (event.type === "transport") {
    detailEl.textContent = event.mode === "relay"
      ? `image via ${event.relay.replace(/^wss?:\/\//, "").replace(/\/$/, "")}`
      : `image read directly — ${String(event.error).slice(0, 90)}`;
  }
  if (event.type === "phase" && vm.phase === "error") {
    showOverlayError(vm.errorMessage || "The image could not be read.");
  }
  render();
});

/* ---------- the machine picker ---------- */

const STATUS_LABEL = {
  works: "boots",
  experimental: "experimental",
  installer: "installer",
  byo: "bring your own",
  impossible: "cannot run",
};

function formatSize(bytes) {
  if (!bytes) return "";
  return bytes >= 1073741824
    ? `${(bytes / 1073741824).toFixed(1)} GB`
    : `${Math.round(bytes / 1048576)} MB`;
}

function machineTile(entry) {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = "machine";
  tile.dataset.id = entry.id;
  if (entry.status === "impossible") tile.disabled = true;
  if (entry.note) tile.title = entry.note;

  const top = document.createElement("span");
  top.className = "m-top";
  const name = document.createElement("span");
  name.className = "m-name";
  name.textContent = entry.name;
  const badge = document.createElement("span");
  badge.className = `badge ${entry.status}`;
  badge.textContent = STATUS_LABEL[entry.status] || entry.status;
  top.append(name, badge);

  const meta = document.createElement("span");
  meta.className = "m-meta";
  meta.textContent = [entry.version, entry.arch, formatSize(entry.size)].filter(Boolean).join(" · ");

  const blurb = document.createElement("span");
  blurb.className = "m-blurb";
  blurb.textContent = entry.blurb;

  tile.append(top, meta, blurb);
  tile.addEventListener("click", () => bootMachine(entry));
  return tile;
}

function renderCatalog() {
  const frag = document.createDocumentFragment();
  for (const group of GROUPS) {
    const entries = DISTROS.filter((entry) => entry.group === group.id);
    if (!entries.length) continue;
    const heading = document.createElement("h2");
    heading.className = "group";
    heading.textContent = group.label;
    const grid = document.createElement("div");
    grid.className = "grid";
    for (const entry of entries) grid.append(machineTile(entry));
    frag.append(heading, grid);
  }
  catalogEl.replaceChildren(frag);
}

/** Point the page furniture at the machine that was picked. */
function applyMachine(entry) {
  current = entry;
  settings = { ...settings, machineId: entry.id };
  saveSettings();
  brandName.textContent = entry.name;
  brandSub.textContent = `${entry.version} · ${entry.arch} · v86`;
  creditEl.textContent = `${entry.vendor} · v86 emulator (BSD-2-Clause)`;
  document.title = `${entry.name} — in a browser tab`;
  detailEl.textContent = `${entry.name} ${entry.version} · ${formatSize(entry.size) || "local image"}${
    settings.relayMode === "wisp"
      ? ` · via ${settings.wispRelay.replace(/^wss?:\/\//, "").replace(/\/$/, "")}`
      : ""
  }`;
}

/* ---------- booting ---------- */

let nudges = [];

/**
 * Some boot menus wait for a keypress (`timeout 0`). Press Enter a few times once the kernel and initrd
 * have been read, which takes longer on a slow disk; entries that do not need it carry no list.
 */
function nudgeBootMenu(entry) {
  nudges.forEach(clearTimeout);
  nudges = [];
  if (!entry || !entry.enter) return;
  nudges = entry.enter.map((delay) =>
    setTimeout(() => {
      if (vm.phase === "running" || vm.phase === "booting") vm.pressEnter();
    }, delay),
  );
}

/** Bring the boot card back with an explanation. */
function showOverlayError(message) {
  bootMsg.textContent = "The machine did not start.";
  note.textContent = message;
  note.classList.add("err");
  overlay.classList.remove("hidden");
}

/** Ask for a file for a "bring your own" entry. */
function askForImage(entry) {
  current = entry;
  bootMsg.textContent = entry.name;
  note.classList.remove("err");
  note.textContent = entry.prompt || "Choose an image file to boot.";
  isoInput.value = "";
  isoInput.click();
}

async function startMachine(entry) {
  if (!entry || entry.status === "impossible") return;
  applyMachine(entry);
  const viaRelay = settings.relayMode === "wisp" ? normalizeRelay(settings.wispRelay) : "";
  const memoryMB = Math.max(Number(entry.memoryMB) || 512, Math.min(2048, settings.memoryMB));
  vm.setSettings({ memoryMB, relayUrl: settings.relayUrl });
  note.classList.remove("err");
  bootMsg.textContent = viaRelay ? "Contacting the image relay…" : "Contacting the image proxy…";
  render();
  try {
    await vm.boot(screen, {
      distro: entry,
      chunkSize: settings.chunkMB * 1048576,
      relay: viaRelay,
    });
    bootMsg.textContent = "The image is streaming; the boot console appears in a moment.";
    overlay.classList.add("hidden");
    nudgeBootMenu(entry);
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    showOverlayError(vm.errorMessage);
    render();
  }
}

function bootMachine(entry) {
  if (!entry) return;
  if (entry.byo) return askForImage(entry);
  return startMachine(entry);
}

/** A file the user picked: .iso is a CD, a tiny .img is a floppy, anything else is a hard disk. */
async function startFile(file) {
  if (!file) return;
  if (/amd64|x86[_-]?64|x86_64/i.test(file.name)) {
    note.textContent = `${file.name} is a 64-bit image; this emulator is 32-bit x86 only.`;
    note.classList.add("err");
    return;
  }
  const kind = /\.(iso)$/i.test(file.name) ? "iso" : file.size <= 2949120 ? "floppy" : "hdd";
  const memoryMB = Math.min(2048, Math.max(settings.memoryMB, 256));
  vm.setSettings({ memoryMB, relayUrl: settings.relayUrl });
  note.classList.remove("err");
  detailEl.textContent = `${file.name} · ${formatSize(file.size)} · ${kind}`;
  overlay.classList.add("hidden");
  render();
  try {
    await vm.boot(screen, { file, kind, chunkSize: settings.chunkMB * 1048576 });
    nudgeBootMenu(current);
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    showOverlayError(vm.errorMessage);
    render();
  }
}

isoInput.addEventListener("change", () => {
  const file = isoInput.files && isoInput.files[0];
  if (file) startFile(file);
});

// Dropping an image anywhere on the page starts it, so the picker is not the only way in.
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
  if (file) startFile(file);
});

/* ---------- controls ---------- */

startBtn.addEventListener("click", () => bootMachine(current));

machinesBtn.addEventListener("click", async () => {
  nudges.forEach(clearTimeout);
  await vm.destroy();
  note.classList.remove("err");
  note.textContent = "Have your own image? An .iso, .img or .bin boots straight from disk.";
  bootMsg.textContent = "Pick a machine. Nothing streams until you do.";
  overlay.classList.remove("hidden");
  render();
});

$("settings-open").addEventListener("click", () => {
  $("set-memory").value = String(settings.memoryMB);
  $("set-chunk").value = String(settings.chunkMB);
  $("set-relay").value = settings.relayUrl;
  $("settings-note").textContent = vm.emulator
    ? "Saved settings apply the next time a machine starts — press Restart."
    : "Applies the next time a machine starts.";
  settingsDialog.showModal();
});

$("settings-form").addEventListener("submit", (event) => {
  if (event.submitter && event.submitter.value === "cancel") return;
  settings = {
    ...settings,
    memoryMB: Number($("set-memory").value) || DEFAULTS.memoryMB,
    chunkMB: Number($("set-chunk").value) || DEFAULTS.chunkMB,
    relayUrl: $("set-relay").value.trim() || DEFAULTS.relayUrl,
  };
  saveSettings();
  vm.setSettings({ memoryMB: settings.memoryMB, relayUrl: settings.relayUrl });
  detailEl.textContent = `${settings.memoryMB} MB · ${settings.chunkMB} MB reads`;
});

restartBtn.addEventListener("click", () => {
  vm.restart();
  nudgeBootMenu(current);
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

/* ---------- serial console ---------- */

let serialQueued = false;

/** Terminal colour and cursor codes would fill the panel with noise, so only the text is shown. */
const plainSerial = (text) => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\r/g, "");

function paintSerial() {
  serialQueued = false;
  const text = vm.serial;
  const pinned = serialLogEl.scrollTop + serialLogEl.clientHeight >= serialLogEl.scrollHeight - 24;
  serialLogEl.textContent = text ? plainSerial(text) : "";
  if (pinned) serialLogEl.scrollTop = serialLogEl.scrollHeight;
  serialStateEl.textContent = text
    ? `${text.length.toLocaleString()} characters captured${vm.serialTrimmed ? " — older output was dropped" : ""}`
    : "Nothing captured yet. The guest has to print to its serial port for anything to appear here.";
}

/** Serial arrives in bursts; repainting at most a few times a second keeps the page responsive. */
function scheduleSerial() {
  if (serialQueued) return;
  serialQueued = true;
  setTimeout(paintSerial, 250);
}

$("serial-open").addEventListener("click", () => {
  paintSerial();
  serialDialog.showModal();
});

$("serial-clear").addEventListener("click", () => {
  vm.clearSerial();
  paintSerial();
});

$("serial-close").addEventListener("click", () => serialDialog.close());

/* ---------- wisp relays: WispScope's list, scanned from here ---------- */

const relayDialog = $("relays");
const relayListEl = $("relay-list");
const relayStateEl = $("relay-state");
const relayRows = new Map();
const relayScans = new Map();
let relayFilter = "";
let scanning = false;

/** Relays must reach the proxy host: that is the origin every image read goes to. */
function relayHost() {
  try {
    return new URL(IMAGE_PROXY).hostname;
  } catch {
    return "pi-desktop-iso-proxy-jdg88r.freebuff.site";
  }
}

function buildRelayRow(url) {
  const row = document.createElement("li");
  row.className = "relay-row";
  const name = document.createElement("code");
  name.textContent = url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
  name.title = url;
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = "not scanned";
  const use = document.createElement("button");
  use.type = "button";
  use.className = "btn tiny";
  use.textContent = "Use";
  use.addEventListener("click", () => chooseRelay(url));
  row.append(name, pill, use);
  relayRows.set(normalizeRelay(url), { row, pill });
  return row;
}

function paintRelay(result) {
  const entry = relayRows.get(normalizeRelay(result.url));
  if (!entry) return;
  entry.pill.className = `pill ${result.ok ? "ok" : "bad"}`;
  entry.pill.textContent = result.ok ? `${result.ms} ms` : result.note;
  entry.pill.title = result.ok
    ? "reached the image host through this relay"
    : "this relay did not reach the image host from this browser";
}

/** Build a row per relay once, then only re-filter the list, so a scan updates pills in place. */
function renderRelays() {
  const chosen = settings.relayMode === "wisp" ? normalizeRelay(settings.wispRelay) : "";
  for (const url of WISP_RELAYS) {
    const key = normalizeRelay(url);
    if (!relayRows.has(key)) buildRelayRow(url);
    const entry = relayRows.get(key);
    entry.row.classList.toggle("chosen", key === chosen);
    const scan = relayScans.get(key);
    if (scan) paintRelay(scan);
  }
  const rows = WISP_RELAYS.filter((url) => !relayFilter || url.toLowerCase().includes(relayFilter)).map((url) =>
    relayRows.get(normalizeRelay(url)).row,
  );
  relayListEl.replaceChildren(...rows);
}

function chooseRelay(url) {
  settings = { ...settings, relayMode: "wisp", wispRelay: normalizeRelay(url) };
  saveSettings();
  relayStateEl.textContent = `Image reads go through ${normalizeRelay(url)}.`;
  renderRelays();
}

function useDirect() {
  settings = { ...settings, relayMode: "direct" };
  saveSettings();
  relayStateEl.textContent = "Image reads go straight to the proxy, with no relay in between.";
  renderRelays();
}

async function scanAll() {
  if (scanning) return;
  scanning = true;
  $("relay-scan").disabled = true;
  const host = relayHost();
  let done = 0;
  relayStateEl.textContent = `Scanning ${WISP_RELAYS.length} relays for ${host}…`;
  const results = await scanRelays(WISP_RELAYS, { host, port: 443 }, (result) => {
    relayScans.set(result.url, result);
    paintRelay(result);
    done += 1;
    relayStateEl.textContent = `Scanned ${done} of ${WISP_RELAYS.length} relays for ${host}…`;
  });
  const working = results.filter((result) => result.ok).sort((a, b) => a.ms - b.ms);
  relayStateEl.textContent = working.length
    ? `${working.length} of ${results.length} relays reached ${host}. Fastest: ${working[0].url.replace(/^wss?:\/\//, "")} at ${working[0].ms} ms.`
    : `No relay reached ${host} from this browser; the direct connection still works.`;
  scanning = false;
  $("relay-scan").disabled = false;
}

$("relays-open").addEventListener("click", () => {
  relayStateEl.textContent =
    settings.relayMode === "wisp"
      ? `Image reads go through ${settings.wispRelay}.`
      : "Image reads go straight to the proxy, with no relay in between.";
  renderRelays();
  relayDialog.showModal();
});

$("relay-search").addEventListener("input", (event) => {
  relayFilter = event.target.value.trim().toLowerCase();
  renderRelays();
});

$("relay-scan").addEventListener("click", scanAll);
$("relay-direct").addEventListener("click", useDirect);
$("relay-close").addEventListener("click", () => relayDialog.close());

/* ---------- go ---------- */

renderCatalog();
applyMachine(current);
render();
paintSerial();

if (!(window.fetch && window.WebAssembly)) {
  bootMsg.textContent = "This browser lacks WebAssembly or fetch; v86 cannot run here.";
  fallback.hidden = false;
}
