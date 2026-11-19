// The Linux machine window: v86 screen, toolbar and boot progress.
import { imageName } from "../images.js";
import { formatBytes } from "../store.js";

export const linuxApp = {
  id: "linux",
  title: "Machine",
  icon: "🖥️",
  width: 900,
  height: 600,
  closable: false,

  mount(api) {
    const { vm } = api;
    const osName = vm.pendingImageName || imageName(api.settings.imageUrl);
    const root = document.createElement("div");
    root.className = "vm-wrap";
    root.innerHTML = `
      <div class="vm-toolbar">
        <button class="btn sm" data-act="restart" title="Reboot the guest">⟲ Restart</button>
        <button class="btn sm" data-act="pause">⏸ Pause</button>
        <button class="btn sm" data-act="cad" title="Send Ctrl+Alt+Del">Ctrl+Alt+Del</button>
        <button class="btn sm" data-act="net" title="Bring eth0 up, take a DHCP lease and add the online Alpine mirrors">🌐 Network</button>
        <button class="btn sm" data-act="reconnect" title="Reopen the relay connection and have the guest take a fresh lease (types into its console), then test a real fetch">🔌 Reconnect</button>
        <button class="btn sm" data-act="paste" title="Type the contents of your clipboard into the guest">📋 Paste</button>
        <button class="btn sm" data-act="save" title="Save the machine now so a reload resumes it — autosave only runs every five minutes">💾 Save</button>
        <button class="btn sm" data-act="reset" title="Discard the saved machine and cold-boot a fresh one">🧹 Reset</button>
        <span class="spacer"></span>
        <button class="btn sm" data-act="scale" title="Zoom the emulated display">1×</button>
        <button class="btn sm" data-act="shot" title="Save a PNG of the guest screen">Screenshot</button>
        <button class="btn sm" data-act="full" title="Fullscreen guest display">⛶</button>
      </div>
      <div class="vm-screen-wrap">
        <div class="vm-screen" tabindex="0">
          <div class="vm-text"></div>
          <canvas></canvas>
        </div>
        <div class="vm-overlay">
          <div class="spin"></div>
          <div class="boot-title">Starting ${osName}…</div>
          <div class="boot-sub">Loading the emulated machine.</div>
          <div class="bar"><i></i></div>
          <button class="btn primary" data-act="retry" hidden>Try again</button>
        </div>
        <div class="vm-hint" data-el="hint">Click the screen to capture the mouse and keyboard · <b>Esc</b> releases it</div>
      </div>
      <div class="vm-status">
        <span><span class="dot"></span><span class="s-phase">starting</span></span>
        <span class="s-net"></span>
        <span class="s-mem"></span>
        <span class="s-snap"></span>
      </div>`;

    const overlay = root.querySelector(".vm-overlay");
    const title = root.querySelector(".boot-title");
    const sub = root.querySelector(".boot-sub");
    const fill = root.querySelector(".bar > i");
    const spinner = root.querySelector(".spin");
    const retry = root.querySelector('[data-act="retry"]');
    const dot = root.querySelector(".dot");
    const sPhase = root.querySelector(".s-phase");
    const sNet = root.querySelector(".s-net");
    const sMem = root.querySelector(".s-mem");
    const sSnap = root.querySelector(".s-snap");
    const saveBtn = root.querySelector('[data-act="save"]');
    const reconnectBtn = root.querySelector('[data-act="reconnect"]');
    const scaleBtn = root.querySelector('[data-act="scale"]');
    const pauseBtn = root.querySelector('[data-act="pause"]');
    const screen = root.querySelector(".vm-screen");

    let scale = Number(api.settings.scale) || 1;

    // Size the emulated display ourselves from the canvas' native resolution.
    // (v86's own set_scale() measures the element, which reads 0 while the canvas
    // is hidden in text mode and collapses the display.)
    const applyFit = () => {
      const canvas = screen.querySelector("canvas");
      const wrap = root.querySelector(".vm-screen-wrap");
      if (!canvas || !wrap || !canvas.width || canvas.width < 320) return;
      const availW = Math.max(240, wrap.clientWidth - 12);
      const availH = Math.max(160, wrap.clientHeight - 12);
      const factor = Math.min(1, availW / canvas.width, availH / canvas.height) * scale;
      canvas.style.width = `${Math.round(canvas.width * factor)}px`;
      canvas.style.height = `${Math.round(canvas.height * factor)}px`;
    };

    // In VGA text mode v86 renders into a monospaced <div>; size the font so the whole
    // 80xN console fits the window instead of overflowing it.
    const BASE_TEXT_PX = 14;
    const applyTextFit = () => {
      const textEl = screen.querySelector(".vm-text");
      const wrap = root.querySelector(".vm-screen-wrap");
      if (!textEl || !wrap) return;
      if (getComputedStyle(textEl).display === "none") return;
      // Measure at the base size, then shrink the font so the whole console fits.
      textEl.style.fontSize = `${BASE_TEXT_PX}px`;
      textEl.style.lineHeight = `${BASE_TEXT_PX}px`;
      const w = textEl.scrollWidth || textEl.offsetWidth;
      const h = textEl.scrollHeight || textEl.offsetHeight;
      if (!w || !h) return;
      const k = Math.min(1, (wrap.clientWidth - 16) / w, (wrap.clientHeight - 16) / h);
      const px = Math.max(6, Math.floor(BASE_TEXT_PX * k));
      textEl.style.fontSize = `${px}px`;
      textEl.style.lineHeight = `${px}px`;
    };

    const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const snapshotStatus = () => {
      if (vm.saving) return "state: saving…";
      if (vm.restoring) return "state: restoring saved session";
      if (vm.snapshot) return `state: saved ${clock(vm.snapshot.savedAt)} · ${formatBytes(vm.snapshot.bytes)}`;
      return "state: fresh machine";
    };

    const render = () => {
      const phase = vm.phase;
      const running = phase === "running";
      overlay.classList.toggle("hidden", running);
      dot.className = `dot ${running ? "live" : phase === "error" ? "err" : phase === "paused" ? "" : "busy"}`;
      sPhase.textContent = {
        idle: "starting", loading: "loading image", booting: "booting kernel",
        running: "running", paused: "paused", error: "error",
      }[phase] || phase;
      sNet.textContent = `network: ${api.vmNetLabel()}`;
      sNet.title = vm.networkStale
        ? "This session came back from a snapshot. The relay gives each tab one address, so the guest may need 🌐 Network (or a Restart) before it can reach the internet."
        : "";
      sMem.textContent = `${api.settings.memoryMB} MB RAM`;
      sSnap.textContent = snapshotStatus();
      // The reconnect recipe types a shell loop, so it only makes sense with a relay-issued lease.
      reconnectBtn.hidden = !vm.usesServerLease();
      reconnectBtn.disabled = !!vm.reconnecting;
      reconnectBtn.textContent = vm.reconnecting ? "🔌 Reconnecting…" : "🔌 Reconnect";
      pauseBtn.textContent = phase === "paused" ? "▶ Resume" : "⏸ Pause";
      spinner.style.display = phase === "error" ? "none" : "";
      retry.hidden = phase !== "error";

      if (phase === "loading") {
        title.textContent = "Downloading the Linux image";
        sub.textContent = vm.progressLabel || "Fetching the boot image…";
        fill.style.width = `${Math.max(2, vm.progress)}%`;
      } else if (phase === "booting" || phase === "idle") {
        title.textContent = "Booting the kernel";
        sub.textContent = `SeaBIOS is starting ${osName}. A cold boot usually takes 30–90 seconds.`;
        fill.style.width = "100%";
      } else if (phase === "paused") {
        title.textContent = "Machine paused";
        sub.textContent = "The guest CPU is stopped. Press Resume to continue.";
        fill.style.width = "100%";
      } else if (phase === "error") {
        title.textContent = "Could not start the machine";
        sub.textContent = vm.errorMessage || "The boot image could not be loaded.";
        fill.style.width = "100%";
      }
    };

    root.querySelector('[data-act="restart"]').addEventListener("click", () => vm.restart());
    root.querySelector('[data-act="cad"]').addEventListener("click", () => vm.ctrlAltDel());
    root.querySelector('[data-act="paste"]').addEventListener("click", async () => {
      if (!vm.running) { api.notify("Wait for the machine to finish booting", "err"); return; }
      try {
        const text = await navigator.clipboard.readText();
        if (!text) { api.notify("The clipboard is empty"); return; }
        vm.type(text);
        api.notify(`Typed ${text.length} characters into the guest`);
      } catch {
        api.notify("The browser blocked clipboard access", "err");
      }
    });
    saveBtn.addEventListener("click", async () => {
      if (!vm.running) { api.notify("Wait for the machine to finish booting", "err"); return; }
      saveBtn.disabled = true;
      const record = await vm.saveState();
      saveBtn.disabled = false;
      if (record) api.notify(`Saved ${formatBytes(record.bytes)} of machine state — a reload resumes here`);
      else api.notify("The machine could not be saved", "err");
    });
    root.querySelector('[data-act="reset"]').addEventListener("click", async () => {
      if (!confirm("Discard the saved machine and cold-boot a fresh guest? Everything in the guest's RAM is lost.")) return;
      api.notify("Discarding the saved machine and starting fresh…");
      try { await api.resetMachine(); } catch (err) { api.notify((err && err.message) || String(err), "err"); }
    });
    reconnectBtn.addEventListener("click", () => {
      if (!vm.running) { api.notify("Wait for the machine to finish booting", "err"); return; }
      if (!vm.reconnectNetwork()) { api.notify("The machine is not running", "err"); return; }
      api.notify("Asking the guest for a fresh lease — this types into its console");
    });
    root.querySelector('[data-act="net"]').addEventListener("click", () => {
      if (!vm.running) { api.notify("Wait for the machine to finish booting", "err"); return; }
      vm.networkSetup();
      api.notify("Network setup typed into the guest — log in as root first");
    });
    pauseBtn.addEventListener("click", () => (vm.phase === "paused" ? vm.resume() : vm.pause()));
    scaleBtn.addEventListener("click", () => {
      scale = scale >= 2 ? 1 : scale === 1 ? 1.5 : 2;
      scaleBtn.textContent = `${scale}×`;
      api.settings.scale = scale;
      api.saveSettings(api.settings);
      applyFit();
    });
    root.querySelector('[data-act="shot"]').addEventListener("click", () => {
      const img = vm.screenshot();
      if (!img || !img.src) return;
      const a = document.createElement("a");
      a.href = img.src;
      a.download = `webvm-screenshot-${Date.now()}.png`;
      a.click();
    });
    root.querySelector('[data-act="full"]').addEventListener("click", () => {
      if (vm.emulator) vm.emulator.screen_go_fullscreen();
    });
    retry.addEventListener("click", () => api.reboot());
    const hint = root.querySelector(".vm-hint");
    const hideHint = () => { hint.style.opacity = "0"; };
    // Capture only makes sense in a graphical mode; in a text console the pointer stays free and a
    // click just gives the guest the keyboard.
    const graphical = () => {
      const canvas = screen.querySelector("canvas");
      return !!canvas && canvas.width > 320 && getComputedStyle(canvas).display !== "none";
    };
    screen.addEventListener("pointerdown", (event) => {
      screen.focus();
      hideHint();
      if (event.button === 0 && !document.pointerLockElement && graphical()) vm.lockMouse();
    });
    vm.on(() => { if (vm.phase === "running") setTimeout(hideHint, 14000); });

    // While the pointer is captured the browser hides it, so say where it went and how to get it back.
    const HINT_FREE = "Click the screen to capture the mouse and keyboard · <b>Esc</b> releases it";
    const HINT_LOCKED = "Mouse captured — the guest cursor follows yours · <b>Esc</b> releases it";
    const onPointerLock = () => {
      const locked = !!document.pointerLockElement;
      hint.innerHTML = locked ? HINT_LOCKED : HINT_FREE;
      hint.style.opacity = "1";
      if (!locked) setTimeout(hideHint, 4000);
    };
    document.addEventListener("pointerlockchange", onPointerLock);

    scaleBtn.textContent = `${scale}×`;
    vm.on((event) => {
      if (event.type === "net") {
        if (event.state === "online") api.notify("The guest is online again");
        if (event.state === "failed") api.notify("The guest still has no lease — see its console", "err");
        if (event.state === "timeout") api.notify("No answer from the relay after two minutes", "err");
      }
      render();
      if (event.type === "screen") requestAnimationFrame(() => { applyFit(); applyTextFit(); });
    });
    render();
    api.win.onResize = () => { applyFit(); applyTextFit(); render(); };
    // The guest may switch video modes without us noticing; re-fit periodically.
    const fitTimer = setInterval(() => { applyFit(); applyTextFit(); }, 2000);
    api.win.onClose = () => {
      clearInterval(fitTimer);
      document.removeEventListener("pointerlockchange", onPointerLock);
      // Never leave the host pointer captured by a window that is gone.
      if (document.pointerLockElement) document.exitPointerLock();
    };

    api.win.body.style.overflow = "hidden";
    api.win.body.appendChild(root);
    api.win.screenElement = screen;
  },
};
