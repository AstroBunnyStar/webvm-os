// Files: everything shared with the Linux machine, plus drag-and-drop into the guest.
import { sharedFiles, onSharedChange, addSharedFile, formatBytes } from "../store.js";

const iconFor = (name) => {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return "🖼️";
  if (/\.(py|js|mjs|c|h|cpp|rs|go|sh)$/i.test(name)) return "📜";
  if (/\.(iso|img)$/i.test(name)) return "💿";
  if (/\.(mp3|wav|ogg|flac)$/i.test(name)) return "🎵";
  if (/\.(mp4|mkv|webm|avi)$/i.test(name)) return "🎬";
  if (/\.(zip|tar|gz|xz|7z)$/i.test(name)) return "🗜️";
  return "📄";
};

const mountCmd = (vm) => vm.mountHint();

export const filesApp = {
  id: "files",
  title: "Files",
  icon: "📁",
  width: 740,
  height: 540,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.innerHTML = `
      <div class="files-head">
        <span class="badge">/mnt/host</span>
        <span class="files-path">files copied into the Linux machine</span>
        <span style="flex:1"></span>
        <button class="btn sm" data-act="mount">Mount in VM</button>
        <button class="btn sm primary" data-act="upload">Upload…</button>
        <input type="file" multiple hidden data-el="picker" />
      </div>
      <div data-el="list"></div>
      <div class="pane">
        <div class="empty" data-el="drop">
          Drag files here to copy them into the Linux machine.<br />
          They appear under <code>/mnt/host</code> once you run the mount command.
        </div>
      </div>`;

    const list = root.querySelector('[data-el="list"]');
    const picker = root.querySelector('[data-el="picker"]');
    const drop = root.querySelector('[data-el="drop"]');

    const render = () => {
      list.innerHTML = "";
      if (!sharedFiles.length) {
        drop.hidden = false;
        return;
      }
      drop.hidden = true;
      for (const file of sharedFiles) {
        const row = document.createElement("div");
        row.className = "file-row";
        row.innerHTML = `
          <span class="f-icon">${iconFor(file.name)}</span>
          <span class="f-name"></span>
          <span class="f-meta"></span>`;
        row.querySelector(".f-name").textContent = file.name;
        row.querySelector(".f-meta").textContent =
          `${formatBytes(file.size)} · ${new Date(file.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
        row.title = file.guestPath || file.name;
        if (file.bytes) {
          const save = document.createElement("button");
          save.className = "btn sm ghost";
          save.textContent = "Save";
          save.addEventListener("click", () => {
            const blob = new Blob([file.bytes]);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = file.name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
          });
          row.appendChild(save);
        }
        list.appendChild(row);
      }
    };

    const sendFiles = async (fileList) => {
      for (const file of fileList) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const result = await vm.shareFile(file.name, bytes);
          addSharedFile({ name: file.name, size: bytes.length, bytes, guestPath: result.guestPath, source: "upload" });
          api.notify(`Copied ${file.name} to the VM`);
        } catch (err) {
          api.notify(`Could not copy ${file.name}: ${err.message}`, "err");
        }
      }
    };

    root.querySelector('[data-act="upload"]').addEventListener("click", () => picker.click());
    picker.addEventListener("change", () => {
      if (picker.files && picker.files.length) sendFiles([...picker.files]);
      picker.value = "";
    });
    root.querySelector('[data-act="mount"]').addEventListener("click", () => {
      if (!vm.running) { api.notify("Start the Linux machine first", "err"); return; }
      vm.command(mountCmd(vm));
      api.notify("Mount command typed into the guest");
    });

    let dragDepth = 0;
    api.win.body.addEventListener("dragover", (e) => {
      e.preventDefault();
      dragDepth++;
      drop.classList.add("drag");
      drop.style.borderColor = "var(--accent)";
    });
    api.win.body.addEventListener("dragleave", () => {
      if (--dragDepth <= 0) { dragDepth = 0; drop.style.borderColor = ""; }
    });
    api.win.body.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      drop.style.borderColor = "";
      if (e.dataTransfer && e.dataTransfer.files.length) sendFiles([...e.dataTransfer.files]);
    });

    onSharedChange(render);
    render();
    api.win.body.appendChild(root);
  },
};
