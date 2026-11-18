// Software catalogue: one click types the right apk command into the running guest.
import { NETWORK_SETUP_CMD as SETUP_CMD } from "../vm.js";

const CATALOG = [
  { name: "Python 3 + pip", glyph: "🐍", pkg: "python3 py3-pip", cmd: "apk add --no-cache python3 py3-pip", note: "CPython inside the Linux machine. Then run python3." },
  { name: "Git", glyph: "🌿", pkg: "git", cmd: "apk add --no-cache git", note: "Clone repositories straight into the guest." },
  { name: "Node.js + npm", glyph: "🟩", pkg: "nodejs npm", cmd: "apk add --no-cache nodejs npm", note: "JavaScript runtime and package manager." },
  { name: "C/C++ toolchain", glyph: "🔧", pkg: "build-base", cmd: "apk add --no-cache build-base", note: "gcc, g++, make and headers — compile real programs." },
  { name: "vim", glyph: "📝", pkg: "vim", cmd: "apk add --no-cache vim", note: "Full-featured modal editor." },
  { name: "htop", glyph: "📊", pkg: "htop", cmd: "apk add --no-cache htop", note: "Interactive process viewer." },
  { name: "tmux", glyph: "🪟", pkg: "tmux", cmd: "apk add --no-cache tmux", note: "Terminal multiplexer and sessions." },
  { name: "curl + wget", glyph: "🌐", pkg: "curl wget", cmd: "apk add --no-cache curl wget", note: "Fetch things from the network inside the guest." },
  { name: "ffmpeg", glyph: "🎬", pkg: "ffmpeg", cmd: "apk add --no-cache ffmpeg", note: "Convert audio and video files." },
  { name: "SQLite", glyph: "🗄️", pkg: "sqlite", cmd: "apk add --no-cache sqlite", note: "Embedded SQL database and CLI." },
  { name: "OpenSSH client", glyph: "🔑", pkg: "openssh", cmd: "apk add --no-cache openssh", note: "ssh and scp from inside the VM." },
  { name: "Ruby", glyph: "💎", pkg: "ruby", cmd: "apk add --no-cache ruby", note: "The Ruby interpreter." },
];

export const catalogApp = {
  id: "catalog",
  title: "Software",
  icon: "📦",
  width: 780,
  height: 580,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "pane";
    root.innerHTML = `
      <h2 class="app-h">Install software in the Linux machine</h2>
      <p class="app-p">
        Alpine uses <code>apk</code>. Each button types the install command into the guest shell —
        make sure you are logged in at a prompt (<code>localhost:~#</code>) and connected to the network.
      </p>
      <div class="callout" style="margin-bottom:14px;border-color:rgba(78,161,255,.3);background:rgba(78,161,255,.07);color:#cfe2fb">
        <div class="callout-icon">1️⃣</div>
        <div>
          <strong>First: connect the guest to the internet.</strong>
          Log in as <code>root</code>, then press this once. It brings up <code>eth0</code>, gets a lease,
          adds the online Alpine mirror and refreshes the index — after that every Install button works.
          <div class="cat-actions" style="margin-top:10px">
            <button class="btn sm primary" data-act="setup">Set up networking &amp; packages</button>
            <button class="btn sm ghost" data-act="copy-setup">Copy command</button>
          </div>
        </div>
      </div>
      <div class="row wrap" style="margin-bottom:14px">
        <button class="btn" data-act="update">Refresh package index</button>
        <button class="btn ghost" data-act="search">apk search…</button>
        <span class="hint" data-el="status">guest state: unknown</span>
      </div>
      <div class="cat" data-el="cat"></div>
      <div class="sep"></div>
      <div class="callout">
        <div class="callout-icon">🎮</div>
        <div>
          <strong>About Minecraft:</strong> a browser-hosted VM cannot run Minecraft Java Edition.
          It needs a 64-bit CPU, several GB of RAM, OpenGL drivers and a GPU — this machine is a
          32-bit PC emulated instruction-by-instruction in WebAssembly, with a software VGA adapter.
          Anything genuinely 32-bit and CPU-only (Python, gcc, Node, servers, compilers, text tools)
          works instead, and <code>apk add</code> can install it.
        </div>
      </div>`;

    const cat = root.querySelector('[data-el="cat"]');
    const status = root.querySelector('[data-el="status"]');
    const refreshStatus = () => {
      status.textContent = vm.running ? "guest running — log in as root, then click Install" : "guest is not running";
    };

    const typeIt = (cmd) => {
      if (!vm.running) { api.notify("Start the Linux machine first", "err"); return; }
      vm.command(cmd);
      api.notify(`Typed into the guest: ${cmd}`);
    };

    for (const entry of CATALOG) {
      const card = document.createElement("div");
      card.className = "cat-card";
      card.innerHTML = `
        <div class="cat-top"><span class="cat-glyph">${entry.glyph}</span><span class="cat-name"></span></div>
        <p></p>
        <code></code>
        <div class="cat-actions">
          <button class="btn sm primary" data-act="install">Install</button>
          <button class="btn sm ghost" data-act="copy">Copy</button>
        </div>`;
      card.querySelector(".cat-name").textContent = entry.name;
      card.querySelector("p").textContent = entry.note;
      card.querySelector("code").textContent = entry.pkg;
      card.querySelector('[data-act="install"]').addEventListener("click", () => typeIt(entry.cmd));
      card.querySelector('[data-act="copy"]').addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(entry.cmd); api.notify("Command copied"); }
        catch { api.notify(entry.cmd); }
      });
      cat.appendChild(card);
    }

    root.querySelector('[data-act="setup"]').addEventListener("click", () => typeIt(SETUP_CMD));
    root.querySelector('[data-act="copy-setup"]').addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(SETUP_CMD); api.notify("Command copied"); }
      catch { api.notify(SETUP_CMD); }
    });
    root.querySelector('[data-act="update"]').addEventListener("click", () => typeIt("apk update"));
    root.querySelector('[data-act="search"]').addEventListener("click", () => {
      const term = window.prompt("Search Alpine packages for:", "python");
      if (term) typeIt(`apk search ${term}`);
    });
    vm.on(refreshStatus);
    refreshStatus();

    api.win.body.appendChild(root);
  },
};
