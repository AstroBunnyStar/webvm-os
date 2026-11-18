// Text editor: write a file and hand it to the Linux machine (or download it).
import { addSharedFile, formatBytes } from "../store.js";

export const editorApp = {
  id: "editor",
  title: "Text Editor",
  icon: "📝",
  width: 720,
  height: 540,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "ed-wrap";
    root.innerHTML = `
      <div class="ed-bar">
        <input type="text" data-el="name" value="notes.txt" spellcheck="false" style="max-width:220px" />
        <span class="hint" data-el="meta"></span>
        <span style="flex:1"></span>
        <button class="btn sm" data-act="open">Open from computer…</button>
        <button class="btn sm" data-act="download">Download</button>
        <button class="btn sm primary" data-act="save">Save to Linux VM</button>
        <input type="file" hidden data-el="picker" />
      </div>
      <textarea spellcheck="false" data-el="text"></textarea>`;

    const nameEl = root.querySelector('[data-el="name"]');
    const textEl = root.querySelector('[data-el="text"]');
    const meta = root.querySelector('[data-el="meta"]');
    const picker = root.querySelector('[data-el="picker"]');

    textEl.value = `# Notes from WebVM OS
#
# This file can be saved straight into the Linux machine:
# the Files app shows it under /mnt/host once you mount the share.
#
# In the guest:
#   mkdir -p /mnt/host
#   mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host
#   cat /mnt/host/notes.txt

def greet(name):
    return f"hello, {name}!"

print(greet("linux"))
`;

    const updateMeta = () => {
      meta.textContent = formatBytes(new TextEncoder().encode(textEl.value).length);
    };
    textEl.addEventListener("input", updateMeta);
    updateMeta();

    const bytes = () => new TextEncoder().encode(textEl.value);
    const fileName = () => (nameEl.value.trim() || "notes.txt").replace(/[^\w.\- ]+/g, "_");

    root.querySelector('[data-act="save"]').addEventListener("click", async () => {
      const data = bytes();
      try {
        const result = await vm.shareFile(fileName(), data);
        addSharedFile({ name: fileName(), size: data.length, bytes: data, guestPath: result.guestPath, source: "editor" });
        api.notify(`Saved ${fileName()} into the VM`);
      } catch (err) {
        api.notify(`Could not save: ${err.message}`, "err");
      }
    });

    root.querySelector('[data-act="download"]').addEventListener("click", () => {
      const blob = new Blob([textEl.value], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });

    root.querySelector('[data-act="open"]').addEventListener("click", () => picker.click());
    picker.addEventListener("change", async () => {
      const file = picker.files && picker.files[0];
      if (!file) return;
      if (file.size > 1024 * 1024) { api.notify("That file is larger than 1 MB — use the Files app instead", "err"); return; }
      textEl.value = await file.text();
      nameEl.value = file.name;
      updateMeta();
      picker.value = "";
    });

    api.win.body.appendChild(root);
    setTimeout(() => textEl.focus(), 50);
  },
};
