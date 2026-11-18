// About panel: what this is, what it can do, how to deploy it.
export const aboutApp = {
  id: "about",
  title: "About WebVM",
  icon: "📖",
  width: 660,
  height: 560,

  mount(api) {
    const root = document.createElement("div");
    root.className = "pane about";
    root.innerHTML = `
      <h2 class="app-h">WebVM</h2>
      <p class="app-p">A complete 32-bit x86 PC, emulated in WebAssembly, with a desktop shell around it.
      No server, no container, no plugin — just static files served over HTTPS.</p>

      <h3>What actually runs</h3>
      <ul>
        <li><b>Machine</b> is a real x86 PC. It boots <b>Alpine Linux 3.21</b> (console, log in as <code>root</code>,
        no password) or <b>SliTaz</b> with a real X11 desktop — Openbox, panel, icons. Switch in <b>Settings</b>.</li>
        <li><b>Files</b>, <b>Text Editor</b> and <b>Downloads</b> hand files to that machine over a 9p share (<code>/mnt/host</code>).</li>
        <li><b>Python 3</b> runs natively in this tab through Pyodide, and inside the guest after <code>apk add python3</code>.</li>
        <li><b>Software</b> installs real Alpine packages (git, gcc, node, vim, ffmpeg…) with <code>apk</code>.</li>
        <li><b>System Monitor</b>, <b>Calculator</b>, <b>Settings</b> and this panel are native to the shell.</li>
      </ul>

      <h3>The graphical desktop</h3>
      <p>Choose <b>SliTaz — graphical X11 desktop</b> in <b>Settings</b> (or press the button in the Desktop app) and
      the machine boots into a genuine Xorg session: Openbox window manager, a panel with an Applications menu,
      desktop icons, the Midori browser, a file manager and a terminal. Click the screen to capture the mouse,
      <code>Esc</code> releases it. It is a real Linux desktop, just a very slow one.</p>
      <p>The other route is to install a desktop into Alpine yourself — the <b>Desktop (X11)</b> app types the whole
      Xorg + Fluxbox + xterm install into the guest for you, with an fbdev→VESA fallback and the Xorg log.</p>

      <h3>Networking</h3>
      <p>The guest's NE2000 card is bridged to the internet through a WebSocket relay (<b>wsproxy</b>).
      The default is the public relay <code>wss://relay.widgetry.org/</code>, which is shared and therefore slow.
      For real use, run your own relay (v86's <code>tools/websockproxy</code>) and paste the URL in <b>Settings</b>.
      Inside the guest, bring the link up with:</p>
      <p><code>ip link set eth0 up && udhcpc -i eth0</code></p>
      <p>The live ISO only has a repository on the CD, so add the online mirror once:</p>
      <p><code>echo https://dl-cdn.alpinelinux.org/alpine/v3.21/main &gt;&gt; /etc/apk/repositories &amp;&amp; apk update</code></p>
      <p>The relay hands out one address per tab, so a machine restored from a snapshot can come back
      holding a lease it no longer routes. Press <b>🌐 Network</b> after a restore to ask for a fresh
      one; if the shared relay still will not answer, <b>Restart</b> gives the guest a new connection.</p>
      <p>Then <code>wget</code>, <code>apk add</code>, <code>git clone</code> and <code>python3</code> work over TCP.
      The <b>Software</b> app does that setup for you with one button.</p>

      <h3>Saving the machine</h3>
      <p>The guest is a real PC, so WebVM keeps a snapshot of it in this browser's IndexedDB —
      roughly the size of the machine's RAM, which is why autosave is coarse: every five minutes, plus
      when the page is closed or reloaded. Opening the site again <b>restores that snapshot instead of
      cold-booting</b>:
      installed packages, running programs and shell history are all still there.</p>
      <p><b>💾 Save</b> in the Machine window writes one immediately — use it before closing something
      you care about — and the status bar shows when the last one was taken. <b>🧹 Reset</b> (or <b>Restart machine</b>) discards the snapshot and boots a
      fresh guest. Snapshots belong to this browser and this site: clearing site data, a private
      window, or another browser gives you a clean machine. They are not a virtual disk — the guest's
      RAM is its only storage, so the snapshot is the machine.</p>

      <h3>Honest limits</h3>
      <ul>
        <li>It is a 32-bit PC running in software: expect roughly a 1990s–2000s PC of performance.</li>
        <li><b>Raspberry Pi OS cannot run here.</b> Pi OS 32-bit is ARM code and this is an x86 CPU; the
        64-bit Raspberry Pi Desktop for PC needs a 64-bit kernel and a multi-gigabyte image. The
        <b>Raspberry Pi</b> app explains this and where to run it instead.</li>
        <li>Minecraft Java Edition cannot run here — it needs a 64-bit CPU, a GPU with OpenGL and several GB of RAM.</li>
        <li>The guest is live media: changes live in RAM. WebVM snapshots that RAM so a reload resumes
        it, but <b>Restart</b> or <b>Reset</b> starts a fresh machine.</li>
        <li>1 GB+ of RAM needs a desktop browser with enough headroom; 512 MB is the sweet spot.</li>
      </ul>

      <h3>Deploying</h3>
      <p>This site is plain static files. Push the folder to a repository and enable GitHub Pages; the included
      workflow (<code>.github/workflows/pages.yml</code>) publishes it on every push to <code>main</code>.
      Nothing needs building and no server is involved. Keep both images in the repository — the largest is
      59 MB and GitHub Pages allows files up to 100 MB.</p>

      <div class="sep"></div>
      <p class="hint">Emulation: <a href="https://github.com/copy/v86" target="_blank" rel="noopener">v86</a> (BSD-2-Clause).
      Guest systems: Alpine Linux and SliTaz. Python in the browser: Pyodide.</p>`;

    api.win.body.appendChild(root);
  },
};
