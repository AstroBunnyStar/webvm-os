// Raspberry Pi: why Pi OS cannot run here, and what to do instead.
const PI_OS_URL = "https://www.raspberrypi.com/software/operating-systems/";
const PI_DESKTOP_URL = "https://downloads.raspberrypi.com/rpd_x86/images/";

export const piApp = {
  id: "rpi",
  title: "Raspberry Pi",
  icon: "🥧",
  width: 720,
  height: 620,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "pane";
    root.innerHTML = `
      <h2 class="app-h">Can this machine run Raspberry Pi OS?</h2>
      <p class="app-p">
        No — and it is worth being precise about why, because it is not a matter of picking the
        right image or the right settings.
      </p>

      <div class="callout" style="border-color:rgba(255,107,97,.35);background:rgba(255,107,97,.08);color:#f3cdc8">
        <div class="callout-icon">🚫</div>
        <div>
          <strong>Raspberry Pi OS 32-bit is ARM code.</strong> It is built for the armhf CPU in a Pi,
          and this page emulates a 32-bit <em>x86</em> PC (v86). ARM instructions cannot execute on an
          x86 CPU, so no Pi OS image — Lite, Desktop, 32-bit or 64-bit — can boot in this window,
          bundled or brought from your own disk.
        </div>
      </div>

      <div class="callout" style="margin-top:10px">
        <div class="callout-icon">🧩</div>
        <div>
          <strong>Raspberry Pi Desktop for PC exists, but it will not fit here either.</strong> The
          Foundation ships a PC/Mac edition with the same desktop. The October 2026 release is
          <em>amd64 (64-bit) only</em> and about 2.6 GB, and this emulator is 32-bit x86 — it cannot run
          a 64-bit kernel at all. The one Pi image that does match this CPU is the archived
          <em>32-bit</em> build, <code>2022-07-01-raspios-bullseye-i386.iso</code> (Debian 11, 3,440 MB).
          It is genuine i386 code, so QEMU on your own computer can boot it — but no browser tab can
          hold 3.4 GB of CD image plus 2 GB of guest RAM, so it cannot boot here either.
        </div>
      </div>

      <div class="sep"></div>
      <strong style="font-size:12.5px">So where can you actually run it?</strong>
      <ul class="pi-list">
        <li>On a Raspberry Pi — a Pi 3, 4, 5 or Zero 2 W with a real armhf CPU.</li>
        <li>In QEMU on your own PC, where the ARM is emulated properly and the disk is not capped by a browser tab.</li>
        <li>On an old PC from USB: <a href="${PI_OS_URL}" target="_blank" rel="noopener">Raspberry Pi Desktop</a>
        gives the same desktop without the Pi hardware (64-bit PC required for the 2026 release).</li>
      </ul>
      <div class="row wrap" style="margin-top:10px">
        <a class="btn" href="${PI_OS_URL}" target="_blank" rel="noopener">Official Pi OS downloads ↗</a>
        <a class="btn" href="${PI_DESKTOP_URL}" target="_blank" rel="noopener">Pi Desktop x86 archive ↗</a>
      </div>

      <div class="sep"></div>
      <strong style="font-size:12.5px">What this machine can do instead</strong>
      <div class="cat" style="margin-top:10px">
        <div class="cat-card">
          <div class="cat-top"><span class="cat-glyph">🍓</span><span class="cat-name">A real X11 desktop</span></div>
          <p>The bundled SliTaz image boots into Xorg with Openbox, a panel and a file manager — the same
          kind of session a small Pi desktop is, on x86.</p>
          <div class="cat-actions"><button class="btn sm primary" data-act="gui">Boot SliTaz desktop</button></div>
        </div>
        <div class="cat-card">
          <div class="cat-top"><span class="cat-glyph">🐍</span><span class="cat-name">Pi-style projects</span></div>
          <p>Python 3 runs in this tab, and <code>apk add python3</code> puts it inside the guest. GPIO
          needs Pi hardware; the rest of the coding tutorials work.</p>
          <div class="cat-actions"><button class="btn sm" data-act="python">Open Python</button></div>
        </div>
      </div>

      <div class="sep"></div>
      <strong style="font-size:12.5px">Or bring a 32-bit x86 ISO of your own</strong>
      <p class="hint" style="margin:6px 0 10px">
        Any i386 distro under roughly 1 GB can boot here. Bigger images exceed what a browser tab can
        hold; raise the RAM in Settings if the guest needs more than 512 MB.
      </p>
      <label class="field"><span>ISO / IMG file (.iso, .img — 32-bit x86 only)</span>
        <input type="file" data-el="file" accept=".iso,.img,.bin" />
      </label>
      <p class="hint" data-el="note">Nothing loaded yet.</p>`;

    const file = root.querySelector('[data-el="file"]');
    const note = root.querySelector('[data-el="note"]');

    file.addEventListener("change", async () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      note.textContent = `Reading ${chosen.name} (${Math.round(chosen.size / 1048576)} MB)…`;
      try {
        api.vm.imageBuffer = new Uint8Array(await chosen.arrayBuffer());
        api.vm.pendingImageName = chosen.name;
        note.textContent = `${chosen.name} is loaded into memory and will boot the machine.`;
        api.notify(`Booting ${chosen.name}`);
        api.reboot();
      } catch {
        note.textContent = `${chosen.name} could not be read — the file is probably too large for this tab.`;
        api.notify("That image is too large to load here", "err");
      }
    });

    root.querySelector('[data-act="gui"]').addEventListener("click", () => {
      api.bootImage("media/slitaz-rolling.iso");
      api.notify("Booting SliTaz — the desktop appears in the Machine window");
    });
    root.querySelector('[data-act="python"]').addEventListener("click", () => api.open("python"));

    if (!vm.running) note.textContent = "The machine is not running yet — load an image to boot it.";

    api.win.body.appendChild(root);
  },
};
