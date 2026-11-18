// WebVM OS bootstrap: shell (top bar, dock, app grid, lock screen), app registry, boot.
import { WindowManager } from "./wm.js";
import { LinuxVM, loadSettings, saveSettings } from "./vm.js";
import { linuxApp } from "./apps/linux.js";
import { filesApp } from "./apps/files.js";
import { editorApp } from "./apps/editor.js";
import { pythonApp } from "./apps/python.js";
import { webApp } from "./apps/web.js";
import { downloadsApp } from "./apps/downloads.js";
import { catalogApp } from "./apps/catalog.js";
import { settingsApp } from "./apps/settings.js";
import { sysmonApp } from "./apps/sysmon.js";
import { desktopApp } from "./apps/desktop.js";
import { calculatorApp } from "./apps/calculator.js";
import { aboutApp } from "./apps/about.js";
import { welcomeApp } from "./apps/welcome.js";
import { piApp } from "./apps/pi.js";
import { imageName } from "./images.js";
import { WALLPAPERS, DEFAULT_WALLPAPER, wallpaperById } from "./wallpapers.js";

const APPS = [
  linuxApp,
  filesApp,
  editorApp,
  pythonApp,
  webApp,
  downloadsApp,
  catalogApp,
  desktopApp,
  piApp,
  sysmonApp,
  calculatorApp,
  settingsApp,
  aboutApp,
  welcomeApp,
];
const appById = new Map(APPS.map((app) => [app.id, app]));

const settings = loadSettings();
const vm = new LinuxVM(settings);

const $ = (sel) => document.querySelector(sel);
const windowsLayer = $("#windows");
const dock = $("#dock");
const appGrid = $("#app-grid");
const gridApps = $("#grid-apps");
const gridSearch = $("#grid-search");
const systemMenu = $("#system-menu");
const lockScreen = $("#lock-screen");
const toasts = $("#toasts");
const splash = $("#boot-splash");
const splashFill = $("#splash-fill");
const splashStatus = $("#splash-status");
const topbarTitle = $("#topbar-title");
const trayClock = $("#tray-clock");
const trayNet = $("#tray-net");
const activitiesBtn = $("#activities");
const systemBtn = $("#system-btn");
const desktopIcons = $("#desktop-icons");
const splashFoot = $("#splash-foot");
const smOs = $("#sm-os");
const switcher = $("#switcher");
const desktopMenu = $("#desktop-menu");
const shortcutsEl = $("#shortcuts");

const NET_LABELS = { wsproxy: "relay", wisp: "wisp", fetch: "http", none: "offline" };
const netLabel = () => NET_LABELS[settings.backend] || settings.backend;
const vmNetLabel = () => (vm.phase === "running" ? netLabel() : "idle");

/* ---------- dock ---------- */
const launchers = new Map();
for (const app of APPS) {
  if (app.launcher === false) continue;
  const btn = document.createElement("button");
  btn.className = "dock-item";
  btn.type = "button";
  btn.title = app.title;
  btn.innerHTML = `<span>${app.icon}</span><span class="dock-dot"></span>`;
  btn.addEventListener("click", () => toggleApp(app.id));
  dock.appendChild(btn);
  launchers.set(app.id, btn);
}

const gridBtn = document.createElement("button");
gridBtn.className = "dock-item";
gridBtn.type = "button";
gridBtn.title = "Show applications";
gridBtn.innerHTML = "<span>⊞</span>";
gridBtn.addEventListener("click", () => toggleGrid());
const sep = document.createElement("div");
sep.className = "dock-sep";
dock.appendChild(sep);
dock.appendChild(gridBtn);

const wm = new WindowManager({ layer: windowsLayer, dock, launchers });
wm.onStateChange = (wins) => {
  const focused = [...wins.values()].find((w) => w.focused && !w.minimised);
  topbarTitle.textContent = focused ? focused.spec.title : "WebVM OS";
};

/* ---------- notifications ---------- */
function notify(message, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  toasts.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* ---------- wallpaper & desktop icons ---------- */
function applyWallpaper(id = settings.wallpaper) {
  const el = $("#wallpaper");
  if (!el) return;
  const wallpaper = wallpaperById(id) || DEFAULT_WALLPAPER;
  el.style.background = wallpaper.css;
}

const DESKTOP_ICONS = [
  { id: "linux", label: "Machine" },
  { id: "files", label: "Files" },
  { id: "catalog", label: "Software" },
  { id: "desktop", label: "Desktop (X11)" },
  { id: "rpi", label: "Raspberry Pi" },
  { id: "settings", label: "Settings" },
  { id: "about", label: "About" },
];

function renderDesktopIcons() {
  if (!desktopIcons) return;
  desktopIcons.innerHTML = "";
  for (const entry of DESKTOP_ICONS) {
    const app = appById.get(entry.id);
    if (!app) continue;
    const btn = document.createElement("button");
    btn.className = "desk-icon";
    btn.type = "button";
    btn.title = app.title;
    btn.innerHTML = `<span class="di-glyph">${app.icon}</span><span class="di-label"></span>`;
    btn.querySelector(".di-label").textContent = entry.label;
    btn.addEventListener("click", () => open(entry.id));
    desktopIcons.appendChild(btn);
  }
}

/* ---------- app launching ---------- */
function open(id) {
  const spec = appById.get(id);
  if (!spec) return;
  hideGrid();
  hideSystemMenu();
  return wm.open(spec, { vm, settings, saveSettings, open, notify, reboot, resetMachine, bootImage, vmNetLabel, applyWallpaper });
}

function toggleApp(id) {
  const win = wm.wins.get(id);
  if (!win) { open(id); return; }
  if (win.minimised) { win.unminimise(); win.focus(); return; }
  if (win.focused) win.minimise();
  else win.focus();
}

/* ---------- boot ---------- */
async function bootVM(opts = {}) {
  const screen = document.querySelector(".vm-screen");
  if (!screen) return;
  try {
    // `reset` also forgets the saved machine, so the status bar drops back to "fresh".
    if (opts.reset) await vm.resetMachine(screen);
    else await vm.boot(screen, opts);
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    vm.emit({ type: "phase" });
    notify(vm.errorMessage, "err");
    dismissSplash();
  }
}
/** Cold boot: the saved machine is discarded, so Restart always gives a clean guest. */
const resetMachine = () => bootVM({ reset: true });
const reboot = () => resetMachine();

async function bootImage(url) {
  vm.imageBuffer = null;
  vm.pendingImageName = null;
  settings.imageUrl = url;
  saveSettings(settings);
  open("linux");
  await bootVM();
}

let bootAnnounced = false;
let splashDismissed = false;
function dismissSplash() {
  if (splashDismissed) return;
  splashDismissed = true;
  splash.classList.add("done");
  setTimeout(() => splash.remove(), 800);
}

vm.on((event) => {
  if (event.type === "progress") {
    splashFill.style.width = `${Math.max(4, vm.progress)}%`;
    splashStatus.textContent = vm.progressLabel || "Downloading the Linux image…";
  }
  if (event.type === "phase") {
    if (vm.phase === "loading") {
      bootAnnounced = false;
      splashStatus.textContent = vm.progressLabel || "Downloading the Linux image…";
    } else if (vm.phase === "booting") {
      splashFill.style.width = "100%";
      splashStatus.textContent = "Starting the machine…";
      setTimeout(dismissSplash, 500);
    } else if (vm.phase === "running") {
      dismissSplash();
      if (vm.restoredFrom) {
        const at = new Date(vm.restoredFrom).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        vm.restoredFrom = 0;
        bootAnnounced = true;
        notify(`Resumed the machine you saved at ${at}`);
      } else if (!bootAnnounced) {
        bootAnnounced = true;
        notify(`${imageName(settings.imageUrl)} is ready — click the Machine screen to use it`);
      }
    }
    updateSystemInfo();
  }
  if (event.type === "error") {
    vm.errorMessage = event.message;
    dismissSplash();
    notify(event.message, "err");
    updateSystemInfo();
  }
  // Autosave failures stay quiet: they would repeat every minute.
  if (event.type === "save" && event.state === "error" && !event.silent) {
    notify(`Could not save the machine: ${event.message}`, "err");
  }
});

/* ---------- app grid ---------- */
function renderGrid() {
  gridApps.innerHTML = "";
  const term = gridSearch.value.trim().toLowerCase();
  for (const app of APPS) {
    if (app.launcher === false) continue;
    if (term && !app.title.toLowerCase().includes(term)) continue;
    const btn = document.createElement("button");
    btn.className = "grid-app";
    btn.type = "button";
    btn.innerHTML = `<span class="ga-icon">${app.icon}</span><span></span>`;
    btn.lastElementChild.textContent = app.title;
    btn.addEventListener("click", () => open(app.id));
    gridApps.appendChild(btn);
  }
}
function showGrid() {
  renderGrid();
  appGrid.hidden = false;
  activitiesBtn.classList.add("active");
  hideSystemMenu();
  setTimeout(() => gridSearch.focus(), 30);
}
function hideGrid() {
  appGrid.hidden = true;
  activitiesBtn.classList.remove("active");
  gridSearch.value = "";
}
function toggleGrid() {
  if (appGrid.hidden) showGrid();
  else hideGrid();
}
activitiesBtn.addEventListener("click", toggleGrid);
gridSearch.addEventListener("input", renderGrid);
gridSearch.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideGrid();
  if (e.key === "Enter") {
    const first = gridApps.querySelector(".grid-app");
    if (first) first.click();
  }
});
appGrid.addEventListener("pointerdown", (e) => {
  if (e.target === appGrid) hideGrid();
});

/* ---------- system menu ---------- */
function updateSystemInfo() {
  $("#sm-net").textContent = netLabel();
  $("#sm-mem").textContent = `${settings.memoryMB} MB`;
  $("#sm-state").textContent = vm.phase;
  if (smOs) smOs.textContent = `${imageName(settings.imageUrl)} · x86`;
  trayNet.textContent = `net: ${netLabel()}`;
}
function showSystemMenu() {
  updateSystemInfo();
  systemMenu.hidden = false;
  systemBtn.classList.add("active");
  hideGrid();
}
function hideSystemMenu() {
  systemMenu.hidden = true;
  systemBtn.classList.remove("active");
}
systemBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (systemMenu.hidden) showSystemMenu();
  else hideSystemMenu();
});
systemMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-act]");
  if (!item) return;
  const act = item.dataset.act;
  if (act === "settings") open("settings");
  if (act === "about") open("about");
  if (act === "restart") { reboot(); notify("Fresh machine — the saved session was discarded"); }
  if (act === "lock") lockScreen.hidden = false;
  hideSystemMenu();
});
document.addEventListener("pointerdown", (e) => {
  if (systemMenu.hidden) return;
  if (e.target instanceof Element && (e.target.closest("#system-menu") || e.target.closest("#system-btn"))) return;
  hideSystemMenu();
});

/* ---------- lock screen ---------- */
lockScreen.addEventListener("click", () => { lockScreen.hidden = true; });

/* ---------- desktop context menu ---------- */
function hideDesktopMenu() {
  if (desktopMenu) desktopMenu.hidden = true;
}

function showDesktopMenu(x, y) {
  if (!desktopMenu) return;
  hideGrid();
  hideSystemMenu();
  desktopMenu.hidden = false;
  const rect = desktopMenu.getBoundingClientRect();
  desktopMenu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  desktopMenu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;
}

$("#desktop").addEventListener("contextmenu", (e) => {
  if (e.target.closest(".win, #dock, #topbar, #system-menu, #app-grid, #desktop-icons")) return;
  e.preventDefault();
  showDesktopMenu(e.clientX, e.clientY);
});
desktopMenu.addEventListener("click", (e) => {
  const item = e.target.closest("[data-act]");
  if (!item) return;
  const act = item.dataset.act;
  if (act === "apps") toggleGrid();
  if (act === "machine") open("linux");
  if (act === "settings") open("settings");
  if (act === "about") open("about");
  if (act === "keys") toggleShortcuts();
  if (act === "restart") { reboot(); notify("Fresh machine — the saved session was discarded"); }
  if (act === "lock") lockScreen.hidden = false;
  hideDesktopMenu();
});
document.addEventListener("pointerdown", (e) => {
  if (desktopMenu.hidden) return;
  // e.target is not always an Element (synthetic or document-level events).
  if (e.target instanceof Element && e.target.closest("#desktop-menu")) return;
  hideDesktopMenu();
});

/* ---------- shortcuts sheet ---------- */
function toggleShortcuts(force) {
  if (!shortcutsEl) return;
  const show = typeof force === "boolean" ? force : shortcutsEl.hidden;
  shortcutsEl.hidden = !show;
  if (show) {
    hideGrid();
    hideSystemMenu();
    hideDesktopMenu();
  }
}

shortcutsEl.addEventListener("click", (e) => {
  if (e.target === shortcutsEl) toggleShortcuts(false);
  else if (e.target instanceof Element && e.target.closest('[data-act="close"]')) toggleShortcuts(false);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "F1" || (e.shiftKey && e.key === "?")) {
    e.preventDefault();
    toggleShortcuts();
  }
});

/* ---------- window switcher (Alt+Tab) ---------- */
let switching = false;
let switchIndex = 0;

// Most recently focused window first.
function switchCandidates() {
  return [...wm.wins.values()].sort(
    (a, b) => (Number(b.el.style.zIndex) || 0) - (Number(a.el.style.zIndex) || 0),
  );
}

function renderSwitcher(list) {
  switcher.innerHTML = "";
  const box = document.createElement("div");
  box.className = "sw-box";
  list.forEach((win, i) => {
    const row = document.createElement("div");
    row.className = `sw-row${i === switchIndex ? " active" : ""}`;
    row.innerHTML = '<span class="sw-icon"></span><span class="sw-title"></span>';
    row.querySelector(".sw-icon").textContent = win.spec.icon || "▣";
    row.querySelector(".sw-title").textContent = win.spec.title;
    box.appendChild(row);
  });
  switcher.appendChild(box);
  switcher.hidden = false;
}

function cycleWindows() {
  const list = switchCandidates();
  if (list.length < 2) return;
  if (!switching) {
    switching = true;
    switchIndex = 1;
  } else {
    switchIndex = (switchIndex + 1) % list.length;
  }
  renderSwitcher(list);
}

function endSwitching(commit) {
  if (!switching) return;
  const list = switchCandidates();
  const win = list[switchIndex];
  switching = false;
  switcher.hidden = true;
  if (commit && win) {
    win.unminimise();
    win.focus();
  }
}

// Alt+` is the portable binding: Windows and most desktops keep Alt+Tab for themselves,
// so the page never receives it. Alt+Tab still works wherever it does reach us.
document.addEventListener("keydown", (e) => {
  if (e.altKey && (e.key === "`" || e.key === "Tab")) {
    e.preventDefault();
    e.stopPropagation();
    cycleWindows();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.key === "Alt") endSwitching(true);
});

/* ---------- clock ---------- */
const pad = (n) => String(n).padStart(2, "0");
function tickClock() {
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const weekday = now.toLocaleDateString([], { weekday: "short" }).replace(/\.|,/g, "");
  const month = now.toLocaleDateString([], { month: "short" }).replace(/\.|,/g, "");
  trayClock.textContent = `${weekday} ${now.getDate()} ${month}  ${time}`;
  trayClock.title = now.toLocaleString();
  const lockClock = document.getElementById("lock-clock");
  if (lockClock) lockClock.textContent = time;
  const lockDate = document.getElementById("lock-date");
  if (lockDate) lockDate.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}
tickClock();
setInterval(tickClock, 10000);
trayNet.addEventListener("click", () => open("settings"));
trayClock.addEventListener("click", () => open("sysmon"));

/* ---------- shortcuts ---------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { hideGrid(); hideSystemMenu(); hideDesktopMenu(); endSwitching(false); toggleShortcuts(false); }
  if (e.ctrlKey && e.altKey && (e.key === "t" || e.key === "T")) { e.preventDefault(); open("linux"); }
  if (e.ctrlKey && e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggleGrid(); }
});

/* ---------- go ---------- */
window.webvm = {
  vm, wm, settings, open, notify, bootImage, reboot, resetMachine,
  saveState: (opts) => vm.saveState(opts),
  applyWallpaper, WALLPAPERS,
};
applyWallpaper();
renderDesktopIcons();
if (splashFoot) splashFoot.textContent = `${imageName(settings.imageUrl)} · 32-bit x86 · v86 engine`;
updateSystemInfo();
open("linux");
if (!settings.welcomeSeen) open("welcome");
bootVM();
setTimeout(() => {
  if (splashDismissed) return;
  splashStatus.textContent = vm.restoring
    ? "Still restoring — a large machine takes a few seconds to come back."
    : "Still loading — the boot image is downloaded once and cached by the browser.";
}, 9000);
