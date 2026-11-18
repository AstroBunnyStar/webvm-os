// Settings: machine size, network backend, boot image.
import { IMAGES, DEFAULT_IMAGE, imageByUrl } from "../images.js";

export const settingsApp = {
  id: "settings",
  title: "Settings",
  icon: "⚙️",
  width: 620,
  height: 580,

  mount(api) {
    const s = api.settings;
    const root = document.createElement("div");
    root.className = "pane";
    root.innerHTML = `
      <h2 class="app-h">Machine settings</h2>
      <p class="app-p">Changes take effect when the machine is restarted.</p>
      <div class="settings-grid">
        <label class="field"><span>Memory</span>
          <select data-el="memory">
            <option value="256">256 MB</option>
            <option value="512">512 MB (recommended)</option>
            <option value="1024">1 GB</option>
            <option value="2048">2 GB</option>
          </select>
        </label>
        <label class="field"><span>Network card</span>
          <select data-el="nic">
            <option value="ne2k">NE2000 (best compatibility)</option>
            <option value="virtio">VirtIO (faster with modern guests)</option>
          </select>
        </label>
        <label class="field"><span>Network backend</span>
          <select data-el="backend">
            <option value="wsproxy">WebSocket relay (full TCP)</option>
            <option value="wisp">WISP proxy (full TCP)</option>
            <option value="fetch">Browser fetch (HTTP only)</option>
            <option value="none">Offline</option>
          </select>
        </label>
        <label class="field"><span>Display scale</span>
          <select data-el="scale">
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>
      </div>
      <label class="field" data-el="relay-field"><span>Relay URL</span>
        <input type="text" data-el="relay" spellcheck="false" />
      </label>
      <label class="field"><span>Operating system</span>
        <select data-el="preset"></select>
      </label>
      <p class="hint" data-el="preset-note" style="margin-top:-6px"></p>
      <label class="field" data-el="image-field"><span>Custom image URL</span>
        <input type="text" data-el="image" spellcheck="false" />
      </label>
      <div class="row wrap" style="margin-top:12px">
        <button class="btn primary" data-act="apply">Apply &amp; restart</button>
        <button class="btn" data-act="reset">Reset to defaults</button>
      </div>
      <div class="sep"></div>
      <label class="field"><span>Boot a custom image from this computer (.iso / .img, 32-bit x86)</span>
        <input type="file" data-el="file" accept=".iso,.img,.bin" />
      </label>
      <p class="hint" data-el="file-note"></p>`;

    const memory = root.querySelector('[data-el="memory"]');
    const nic = root.querySelector('[data-el="nic"]');
    const backend = root.querySelector('[data-el="backend"]');
    const scale = root.querySelector('[data-el="scale"]');
    const relayField = root.querySelector('[data-el="relay-field"]');
    const relay = root.querySelector('[data-el="relay"]');
    const preset = root.querySelector('[data-el="preset"]');
    const presetNote = root.querySelector('[data-el="preset-note"]');
    const imageField = root.querySelector('[data-el="image-field"]');
    const image = root.querySelector('[data-el="image"]');
    const file = root.querySelector('[data-el="file"]');
    const fileNote = root.querySelector('[data-el="file-note"]');

    memory.value = String(s.memoryMB);
    nic.value = s.nic;
    backend.value = s.backend;
    scale.value = String(s.scale || 1);
    relay.value = s.backend === "wisp" ? s.wispUrl : s.relayUrl;
    image.value = s.imageUrl;

    const describe = () => {
      const known = imageByUrl(s.imageUrl);
      presetNote.textContent = known
        ? `${known.size} · ${known.note}`
        : "Any 32-bit x86 ISO/IMG works.";
    };
    const syncPreset = () => {
      const known = imageByUrl(image.value.trim());
      preset.value = known ? known.id : "custom";
      imageField.style.display = known ? "none" : "";
      describe();
    };
    preset.innerHTML =
      IMAGES.map((i) => `<option value="${i.id}">${i.name} (${i.size})</option>`).join("") +
      `<option value="custom">Custom image URL…</option>`;
    syncPreset();
    preset.addEventListener("change", () => {
      const chosen = IMAGES.find((i) => i.id === preset.value);
      if (chosen) image.value = chosen.url;
      imageField.style.display = chosen ? "none" : "";
      describe();
    });

    backend.addEventListener("change", () => {
      relayField.style.display = backend.value === "wsproxy" || backend.value === "wisp" ? "" : "none";
      if (backend.value === "wisp") relay.value = s.wispUrl;
      else if (backend.value === "wsproxy") relay.value = s.relayUrl;
    });
    if (!["wsproxy", "wisp"].includes(s.backend)) relayField.style.display = "none";

    file.addEventListener("change", async () => {
      const chosen = file.files && file.files[0];
      if (!chosen) return;
      fileNote.textContent = `Reading ${chosen.name} (${Math.round(chosen.size / 1048576)} MB)…`;
      api.vm.imageBuffer = new Uint8Array(await chosen.arrayBuffer());
      api.vm.pendingImageName = chosen.name;
      fileNote.textContent = `${chosen.name} is loaded and will be used on the next start. Click Apply & restart.`;
    });

    root.querySelector('[data-act="apply"]').addEventListener("click", () => {
      const next = {
        memoryMB: Number(memory.value),
        nic: nic.value,
        backend: backend.value,
        scale: Number(scale.value),
        imageUrl: image.value.trim() || s.imageUrl,
      };
      if (backend.value === "wisp") next.wispUrl = relay.value.trim();
      else next.relayUrl = relay.value.trim();
      Object.assign(api.settings, next);
      api.saveSettings(api.settings);
      api.notify("Settings saved — restarting the machine");
      api.reboot();
    });

    root.querySelector('[data-act="reset"]').addEventListener("click", () => {
      api.vm.imageBuffer = null;
      fileNote.textContent = "Custom image cleared.";
      memory.value = "512";
      nic.value = "ne2k";
      backend.value = "wsproxy";
      relay.value = "wss://relay.widgetry.org/";
      scale.value = "1";
      image.value = DEFAULT_IMAGE.url;
      syncPreset();
    });

    api.win.body.appendChild(root);
  },
};
