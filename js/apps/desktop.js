// A real X11 desktop inside the emulated machine: Xorg + Fluxbox + xterm.
// The guest already runs a 1024x768 framebuffer console, so Xorg's fbdev driver is the
// most reliable option here; VESA is offered as a fallback.
const ALPINE = "https://dl-cdn.alpinelinux.org/alpine/v3.21";
const MAIN = `${ALPINE}/main`;
const COMMUNITY = `${ALPINE}/community`;

const XORG_CONF = (driver) =>
  [
    "mkdir -p /etc/X11;",
    "printf '",
    'Section "Device"\\n',
    `Identifier "gfx"\\n`,
    `Driver "${driver}"\\n`,
    'EndSection\\n',
    'Section "Screen"\\n',
    'Identifier "scr"\\n',
    'Device "gfx"\\n',
    'DefaultDepth 16\\n',
    'SubSection "Display"\\n',
    'Depth 16\\n',
    'Modes "1024x768"\\n',
    'EndSubSection\\n',
    'EndSection\\n',
    'Section "InputClass"\\n',
    'Identifier "keyboard"\\n',
    'MatchIsKeyboard "on"\\n',
    'Driver "evdev"\\n',
    'EndSection\\n',
    'Section "InputClass"\\n',
    'Identifier "pointer"\\n',
    'MatchIsPointer "on"\\n',
    'Driver "evdev"\\n',
    'EndSection\\n',
    "' > /etc/X11/xorg.conf",
  ].join("");

const STEPS = [
  {
    id: "net",
    title: "1 · Network & package index",
    desc: "Brings up eth0, requests a lease and adds the online Alpine main + community repositories.",
    cmd:
      "ip link set eth0 up; udhcpc -i eth0 -n; " +
      `grep -q "alpine/v3.21/main" /etc/apk/repositories || echo ${MAIN} >> /etc/apk/repositories; ` +
      `grep -q "alpine/v3.21/community" /etc/apk/repositories || echo ${COMMUNITY} >> /etc/apk/repositories; ` +
      "apk update",
  },
  {
    id: "install",
    title: "2 · Install Xorg, Fluxbox and xterm",
    desc: "Real X server, fbdev + VESA video drivers, evdev input, a window manager and a terminal. About 90 MB.",
    cmd:
      "apk add --no-cache xorg-server xf86-video-fbdev xf86-video-vesa " +
      "xf86-input-evdev xf86-input-libinput xinit fluxbox xterm font-misc-misc " +
      "eudev udev-init-scripts",
  },
  {
    id: "configure",
    title: "3 · Configure the display",
    desc: "Writes /etc/X11/xorg.conf for the emulated framebuffer and sets Fluxbox as the session.",
    cmd: `${XORG_CONF("fbdev")}; printf '#!/bin/sh\\nexec fluxbox\\n' > /root/.xinitrc; chmod +x /root/.xinitrc`,
  },
  {
    id: "start",
    title: "4 · Start the graphical session",
    desc: "Starts udev, then startx. If the fbdev driver fails it automatically retries with VESA.",
    cmd:
      "rc-service udev start >/dev/null 2>&1; " +
      "startx || { sed -i 's/\"fbdev\"/\"vesa\"/' /etc/X11/xorg.conf; echo 'fbdev failed, retrying with vesa'; startx; }",
  },
];

const HELPERS = [
  {
    title: "X did not start — show the log",
    cmd: "tail -n 30 /var/log/Xorg.0.log",
  },
  {
    title: "Try the VESA driver instead",
    cmd: `${XORG_CONF("vesa")}; startx`,
  },
  {
    title: "Return to the text console",
    cmd: "echo console is on tty1 — press Ctrl+Alt+Del in the Terminal toolbar to reboot",
  },
];

export const desktopApp = {
  id: "desktop",
  title: "Desktop (X11)",
  icon: "🍓",
  width: 760,
  height: 600,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "pane";
    root.innerHTML = `
      <h2 class="app-h">Run a real Linux graphical desktop</h2>
      <p class="app-p">
        The machine in the <b>Terminal</b> window can boot a genuine X11 session: Xorg, the Fluxbox
        window manager and xterm — the same stack a small Linux desktop uses. Click the Terminal
        screen once to capture the mouse, press <kbd>Esc</kbd> to release it.
      </p>
      <div class="callout" style="border-color:rgba(233,84,32,.35);background:rgba(233,84,32,.08);color:#f0d3c9">
        <div class="callout-icon">🍓</div>
        <div>
          Raspberry Pi OS is ARM-only and cannot run inside a 32-bit x86 emulator. This is the real thing
          in x86 form: a graphical Linux session with a window manager, driven by a real framebuffer.
          It is slow — expect a 1990s workstation, not a Pi 5.
        </div>
      </div>
      <div class="cat-card" style="margin-top:12px;border-color:rgba(233,84,32,.45)">
        <div class="cat-top"><span class="cat-name">Fastest path — boot the bundled SliTaz desktop</span></div>
        <p>The bundled SliTaz image already contains Xorg, Openbox, a panel and a file manager, so it boots
        straight into a graphical desktop in a couple of minutes with no downloads at all.</p>
        <div class="cat-actions">
          <button class="btn sm primary" data-act="boot-gui">Boot the graphical desktop</button>
        </div>
      </div>
      <p class="hint" style="margin-top:12px">
        Or add a desktop to the Alpine machine below — log in as <code>root</code> first, run the steps in
        order and wait for the shell prompt to come back between them. Step 2 downloads about 90 MB and is
        slow on emulated hardware.
      </p>
      <div data-el="steps" class="stack" style="margin-top:12px"></div>
      <div class="row wrap">
        <button class="btn ghost" data-act="term">Show terminal</button>
        <button class="btn ghost" data-act="copy">Copy all</button>
        <span class="hint" data-el="status"></span>
      </div>
      <div class="sep"></div>
      <strong style="font-size:12.5px">If something goes wrong</strong>
      <div data-el="helpers" class="stack" style="margin-top:10px"></div>`;

    const stepsEl = root.querySelector('[data-el="steps"]');
    const helpersEl = root.querySelector('[data-el="helpers"]');
    const status = root.querySelector('[data-el="status"]');

    const refresh = () => {
      status.textContent = vm.running
        ? "machine running — log in as root, then run the steps"
        : "machine is not running";
    };

    const card = (title, desc, cmd, actionLabel) => {
      const el = document.createElement("div");
      el.className = "cat-card";
      el.innerHTML = `
        <div class="cat-top"><span class="cat-name"></span></div>
        <p></p>
        <code style="white-space:pre-wrap;word-break:break-all;max-height:74px;overflow:auto;display:block"></code>
        <div class="cat-actions">
          <button class="btn sm primary" data-act="run"></button>
          <button class="btn sm ghost" data-act="copy-one">Copy</button>
        </div>`;
      el.querySelector(".cat-name").textContent = title;
      if (desc) el.querySelector("p").textContent = desc;
      else el.querySelector("p").remove();
      el.querySelector("code").textContent = cmd;
      el.querySelector('[data-act="run"]').textContent = actionLabel;
      el.querySelector('[data-act="run"]').addEventListener("click", () => {
        if (!vm.running) { api.notify("Start the machine first", "err"); return; }
        vm.command(cmd);
        api.notify(`Typed into the guest: ${title}`);
      });
      el.querySelector('[data-act="copy-one"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(cmd); api.notify("Command copied"); }
        catch { api.notify(cmd); }
      });
      return el;
    };

    for (const step of STEPS) stepsEl.appendChild(card(step.title, step.desc, step.cmd, "Run this step"));
    for (const helper of HELPERS) helpersEl.appendChild(card(helper.title, "", helper.cmd, "Run"));

    root.querySelector('[data-act="copy"]').addEventListener("click", async () => {
      const all = STEPS.map((s) => s.cmd).join("\n");
      try { await navigator.clipboard.writeText(all); api.notify("All commands copied"); }
      catch { api.notify("Clipboard unavailable"); }
    });
    root.querySelector('[data-act="term"]').addEventListener("click", () => api.open("linux"));
    const bootGui = root.querySelector('[data-act="boot-gui"]');
    if (bootGui) {
      bootGui.addEventListener("click", () => {
        api.bootImage("media/slitaz-rolling.iso");
        api.notify("Booting SliTaz — the graphical desktop appears in the Machine window");
      });
    }

    vm.on(refresh);
    refresh();
    api.win.body.appendChild(root);
  },
};
