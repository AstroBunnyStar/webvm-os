// First-run tour: what the machine is and the three things worth doing first.
export const welcomeApp = {
  id: "welcome",
  title: "Welcome",
  icon: "🐧",
  launcher: false,
  width: 700,
  height: 560,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "pane welcome";
    root.innerHTML = `
      <div class="welcome-head">
        <div class="welcome-logo">🐧</div>
        <div>
          <h2 class="app-h">Welcome to WebVM OS</h2>
          <p class="app-p" style="margin:0">A real 32-bit x86 PC, emulated in WebAssembly, inside a browser tab.</p>
        </div>
      </div>
      <div class="cat" data-el="cards"></div>
      <div class="sep"></div>
      <strong style="font-size:12.5px">Three things that are not obvious</strong>
      <ul class="welcome-tips">
        <li>Click the black <b>Machine</b> screen once to capture the mouse and keyboard — <kbd>Esc</kbd> gives them back.</li>
        <li>Log in at the console as <code>root</code> with no password; the prompt looks like <code>localhost:~#</code>.</li>
        <li>Files you send from <b>Files</b> or <b>Downloads</b> appear inside the guest at <code>/mnt/host</code> after the mount command.</li>
        <li><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>T</kbd> reopens the Machine window, <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>A</kbd> opens the app overview.</li>
      </ul>
      <div class="row wrap" style="margin-top:16px">
        <label class="check"><input type="checkbox" data-el="again" /> Show this every time</label>
        <span style="flex:1"></span>
        <button class="btn ghost" data-act="guide">Desktop guide</button>
        <button class="btn primary" data-act="close">Start using the machine</button>
      </div>`;

    const cards = root.querySelector('[data-el="cards"]');
    const again = root.querySelector('[data-el="again"]');
    again.checked = false;

    const card = (glyph, name, body, buttonLabel, onClick) => {
      const el = document.createElement("div");
      el.className = "cat-card";
      el.innerHTML = `
        <div class="cat-top"><span class="cat-glyph">${glyph}</span><span class="cat-name"></span></div>
        <p></p>
        <div class="cat-actions"><button class="btn sm primary" data-act="go"></button></div>`;
      el.querySelector(".cat-name").textContent = name;
      el.querySelector("p").textContent = body;
      const button = el.querySelector('[data-act="go"]');
      button.textContent = buttonLabel;
      button.addEventListener("click", onClick);
      cards.appendChild(el);
      return button;
    };

    const onlineButton = card(
      "🌐",
      "Get the machine online",
      "Brings eth0 up, takes a DHCP lease and adds the online Alpine mirrors. Run it after you log in as root.",
      "Set up networking",
      () => {
        if (!vm.running) { api.notify("Wait for the machine to finish booting", "err"); return; }
        vm.networkSetup();
        api.notify("Setup command typed — press Enter in the Machine window if it is still waiting");
      },
    );

    card(
      "🖥️",
      "Boot a real graphical desktop",
      "SliTaz is bundled with Xorg, Openbox and a panel, so it boots straight into a desktop with no downloads.",
      "Boot SliTaz desktop",
      () => {
        api.bootImage("media/slitaz-rolling.iso");
        api.notify("Booting SliTaz — the desktop appears in the Machine window in a couple of minutes");
        api.win.close();
      },
    );

    card(
      "🎨",
      "Make it yours",
      "Four wallpapers, memory size, network backend, display scale and the boot image all live in Settings.",
      "Open Settings",
      () => api.open("settings"),
    );

    root.querySelector('[data-act="guide"]').addEventListener("click", () => api.open("desktop"));
    root.querySelector('[data-act="close"]').addEventListener("click", () => {
      api.settings.welcomeSeen = !again.checked;
      api.saveSettings(api.settings);
      api.win.close();
    });

    // Keep the networking card honest about the machine state.
    const refresh = () => {
      onlineButton.disabled = !vm.running;
      onlineButton.title = vm.running ? "Type the setup command into the guest" : "Waiting for the machine to boot";
    };
    vm.on(refresh);
    refresh();

    api.win.body.appendChild(root);
  },
};
