// A web browser panel for the desktop. Sites that refuse framing are opened in a real tab.
const QUICK_LINKS = [
  { name: "Wikipedia", url: "https://en.m.wikipedia.org/wiki/Alpine_Linux", icon: "📚" },
  { name: "Alpine packages", url: "https://pkgs.alpinelinux.org/packages", icon: "📦" },
  { name: "Hacker News", url: "https://news.ycombinator.com", icon: "📰" },
  { name: "PyPI", url: "https://pypi.org", icon: "🐍" },
  { name: "GitHub", url: "https://github.com", icon: "🐙" },
  { name: "example.com", url: "https://example.com", icon: "🌐" },
];

export const webApp = {
  id: "web",
  title: "Browser",
  icon: "🌐",
  width: 940,
  height: 620,

  mount(api) {
    const root = document.createElement("div");
    root.className = "web-wrap";
    root.innerHTML = `
      <div class="web-bar">
        <input type="url" data-el="url" placeholder="https://example.com" spellcheck="false" />
        <button class="btn primary sm" data-act="go">Go</button>
        <button class="btn sm" data-act="tab" title="Open in a real browser tab">↗</button>
      </div>
      <div class="web-note">
        <span>Many large sites block being embedded in a frame — use ↗ to open them in a real tab.</span>
      </div>
      <div class="web-links" data-el="links"></div>
      <iframe class="web-frame" data-el="frame" referencepolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" hidden></iframe>`;

    const url = root.querySelector('[data-el="url"]');
    const frame = root.querySelector('[data-el="frame"]');
    const links = root.querySelector('[data-el="links"]');

    const normalise = (value) => {
      const v = value.trim();
      if (!v) return null;
      if (/^[a-z]+:\/\//i.test(v)) return v;
      if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(v)) return `https://${v}`;
      return `https://duckduckgo.com/?q=${encodeURIComponent(v)}`;
    };

    const go = (target) => {
      const url2 = normalise(target);
      if (!url2) return;
      url.value = url2;
      frame.hidden = false;
      links.hidden = true;
      frame.src = url2;
    };

    root.querySelector('[data-act="go"]').addEventListener("click", () => go(url.value));
    url.addEventListener("keydown", (e) => { if (e.key === "Enter") go(url.value); });
    root.querySelector('[data-act="tab"]').addEventListener("click", () => {
      const target = normalise(url.value);
      if (target) window.open(target, "_blank", "noopener,noreferrer");
    });

    for (const link of QUICK_LINKS) {
      const btn = document.createElement("button");
      btn.className = "web-link";
      btn.innerHTML = `<span style="font-size:18px">${link.icon}</span><span>${link.name}</span>`;
      btn.addEventListener("click", () => go(link.url));
      links.appendChild(btn);
    }

    api.win.body.style.overflow = "hidden";
    api.win.body.appendChild(root);
    setTimeout(() => url.focus(), 60);
  },
};
