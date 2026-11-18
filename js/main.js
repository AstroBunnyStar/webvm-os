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

const APPS = [
  linuxApp,
  filesApp,
  editorApp,
  pythonApp,
  webApp,
  downloadsApp,
  catalogApp,
  desktopApp,
  sysmonApp,
  calculatorApp,
  settingsApp,
  aboutApp,
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

const NET_LABELS = { wsproxy: "relay", wisp: "wisp", fetch: "http", none: "offline" };
const netLabel = () => NET_LABELS[settings.backend] || settings.backend;
const vmNetLabel = () => (vm.phase === "running" ? netLabel() : "idle");

/* ---------- dock ---------- */
const launchers = new Map();
for (const app of APPS) {
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

/* ---------- app launching ---------- */
function open(id) {
  const spec = appById.get(id);
  if (!spec) return;
  hideGrid();
  hideSystemMenu();
  return wm.open(spec, { vm, settings, saveSettings, open, notify, reboot, bootImage, vmNetLabel });
}

function toggleApp(id) {
  const win = wm.wins.get(id);
  if (!win) { open(id); return; }
  if (win.minimised) { win.unminimise(); win.focus(); return; }
  if (win.focused) win.minimise();
  else win.focus();
}

/* ---------- boot ---------- */
async function bootVM() {
  const screen = document.querySelector(".vm-screen");
  if (!screen) return;
  try {
    await vm.boot(screen);
  } catch (err) {
    vm.phase = "error";
    vm.errorMessage = (err && err.message) || String(err);
    vm.emit({ type: "phase" });
    notify(vm.errorMessage, "err");
    dismissSplash();
  }
}
const reboot = () => bootVM();

async function bootImage(url) {
  vm.imageBuffer = null;
  vm.pendingImageName = null;
  settings.imageUrl = url;
  saveSettings(settings);
  open("linux");
  await bootVM();
}

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
      splashStatus.textContent = vm.progressLabel || "Downloading the Linux image…";
    } else if (vm.phase === "booting") {
      splashFill.style.width = "100%";
      splashStatus.textContent = "Starting the machine…";
      setTimeout(dismissSplash, 500);
    } else if (vm.phase === "running") {
      dismissSplash();
    }
    updateSystemInfo();
  }
  if (event.type === "error") {
    vm.errorMessage = event.message;
    dismissSplash();
    notify(event.message, "err");
    updateSystemInfo();
  }
});

/* ---------- app grid ---------- */
function renderGrid() {
  gridApps.innerHTML = "";
  const term = gridSearch.value.trim().toLowerCase();
  for (const app of APPS) {
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
  if (act === "restart") { reboot(); notify("Restarting the machine"); }
  if (act === "lock") lockScreen.hidden = false;
  hideSystemMenu();
});
document.addEventListener("pointerdown", (e) => {
  if (!systemMenu.hidden && !e.target.closest("#system-menu") && !e.target.closest("#system-btn")) hideSystemMenu();
});

/* ---------- lock screen ---------- */
lockScreen.addEventListener("click", () => { lockScreen.hidden = true; });

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
  if (e.key === "Escape") { hideGrid(); hideSystemMenu(); }
  if (e.ctrlKey && e.altKey && (e.key === "t" || e.key === "T")) { e.preventDefault(); open("linux"); }
  if (e.ctrlKey && e.altKey && (e.key === "a" || e.key === "A")) { e.preventDefault(); toggleGrid(); }
});

/* ---------- go ---------- */
window.webvm = { vm, wm, settings, open, notify, bootImage, reboot };
updateSystemInfo();
open("linux");
bootVM();
setTimeout(() => {
  if (splashDismissed) return;
  splashStatus.textContent = "Still loading — the 48 MB image is downloaded once and cached by the browser.";
}, 9000);
