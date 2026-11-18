// Download files from the internet: keep them on the host or hand them to the Linux guest.
import { addSharedFile } from "../store.js";

const bytesToSize = (n) => {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    onProgress(buf.length, buf.length);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

const nameFromUrl = (url) => {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "download";
    return decodeURIComponent(last);
  } catch {
    return "download";
  }
};

export const downloadsApp = {
  id: "downloads",
  title: "Downloads",
  icon: "⬇️",
  width: 660,
  height: 520,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "pane";
    root.innerHTML = `
      <h2 class="app-h">Download from the internet</h2>
      <p class="app-p">
        Fetches a URL in this browser tab, then either saves it to your computer or copies it straight
        into the running Linux machine over the 9p share (it appears at <code>/mnt/host/</code> after mounting).
      </p>
      <label class="field"><span>URL</span>
        <input type="url" data-el="url" placeholder="https://example.com/file.tar.gz" spellcheck="false" />
      </label>
      <label class="field"><span>Save as</span>
        <input type="text" data-el="name" placeholder="file.tar.gz" spellcheck="false" />
      </label>
      <div class="row wrap">
        <button class="btn primary" data-act="host">⬇ Save to this computer</button>
        <button class="btn" data-act="guest">🐧 Send to Linux VM</button>
        <span class="hint" data-el="status"></span>
      </div>
      <div class="bar" style="width:100%;margin-top:12px"><i data-el="fill"></i></div>
      <div class="sep"></div>
      <div class="row" style="justify-content:space-between">
        <strong style="font-size:12.5px">Files fetched this session</strong>
        <button class="btn sm ghost" data-act="mount">Type mount command in VM</button>
      </div>
      <div class="dl-list" data-el="list"><div class="empty">Nothing downloaded yet.</div></div>
      <p class="hint" style="margin-top:14px">
        Downloads go through your browser, so a server that does not allow cross-origin requests will fail here
        (that is the browser's CORS rule, not a bug). Try package mirrors, raw files or GitHub release assets.
      </p>`;

    const urlEl = root.querySelector('[data-el="url"]');
    const nameEl = root.querySelector('[data-el="name"]');
    const status = root.querySelector('[data-el="status"]');
    const fill = root.querySelector('[data-el="fill"]');
    const list = root.querySelector('[data-el="list"]');
    const items = [];

    urlEl.addEventListener("input", () => {
      if (!nameEl.value || nameEl.dataset.auto !== "0") {
        nameEl.value = nameFromUrl(urlEl.value);
        nameEl.dataset.auto = "1";
      }
    });
    nameEl.addEventListener("input", () => { nameEl.dataset.auto = "0"; });

    const renderList = () => {
      list.innerHTML = "";
      if (!items.length) {
        list.innerHTML = '<div class="empty">Nothing downloaded yet.</div>';
        return;
      }
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "dl-item";
        row.innerHTML = `<span class="name"></span><span class="size"></span>`;
        row.querySelector(".name").textContent = item.name;
        row.querySelector(".size").textContent = bytesToSize(item.bytes.length);
        const save = document.createElement("button");
        save.className = "btn sm";
        save.textContent = "Save";
        save.addEventListener("click", () => saveToHost(item));
        const share = document.createElement("button");
        share.className = "btn sm";
        share.textContent = "→ VM";
        share.addEventListener("click", () => sendToGuest(item));
        row.append(save, share);
        list.appendChild(row);
      }
    };

    const saveToHost = (item) => {
      const blob = new Blob([item.bytes], { type: item.type || "application/octet-stream" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = item.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      api.notify(`Saved ${item.name} to your computer`);
    };

    const sendToGuest = async (item) => {
      try {
        const result = await vm.shareFile(item.name, item.bytes);
        addSharedFile({ name: item.name, size: item.bytes.length, bytes: item.bytes, guestPath: result.guestPath, source: "download" });
        api.notify(`Copied to the VM at ${result.guestPath}`);
        status.textContent = `in VM: ${result.guestPath}`;
      } catch (err) {
        api.notify(`Could not copy into the VM: ${err.message}`, "err");
      }
    };

    const download = async (target) => {
      const href = urlEl.value.trim();
      if (!href) return;
      const name = (nameEl.value || nameFromUrl(href)).trim();
      status.textContent = "fetching…";
      fill.style.width = "8%";
      try {
        const bytes = await fetchWithProgress(href, (loaded, total) => {
          status.textContent = total ? `${bytesToSize(loaded)} / ${bytesToSize(total)}` : bytesToSize(loaded);
          fill.style.width = total ? `${Math.round((loaded / total) * 100)}%` : "65%";
        });
        fill.style.width = "100%";
        const item = { name, bytes, type: "" };
        items.unshift(item);
        renderList();
        status.textContent = `${bytesToSize(bytes.length)} fetched`;
        if (target === "host") saveToHost(item);
        if (target === "guest") await sendToGuest(item);
      } catch (err) {
        fill.style.width = "0%";
        status.textContent = "failed";
        api.notify(`Download failed: ${err.message}`, "err");
      }
    };

    root.querySelector('[data-act="host"]').addEventListener("click", () => download("host"));
    root.querySelector('[data-act="guest"]').addEventListener("click", () => download("guest"));
    root.querySelector('[data-act="mount"]').addEventListener("click", () => {
      if (!vm.running) { api.notify("Start the Linux machine first", "err"); return; }
      vm.command(vm.mountHint());
      api.notify("Mount command typed into the guest — run it at the shell");
    });

    api.win.body.appendChild(root);
  },
};
