// Window manager for the WebVM desktop: draggable windows + dock integration.
let zTop = 10;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export class WindowManager {
  constructor({ layer, dock, launchers }) {
    this.layer = layer;
    this.dock = dock;
    this.launchers = launchers || new Map();
    this.wins = new Map();
    this.cascade = 0;
    window.addEventListener("resize", () => this.reflow());
  }

  open(spec, ctx) {
    const manager = this;
    const existing = this.wins.get(spec.id);
    if (existing) {
      existing.unminimise();
      existing.focus();
      return existing;
    }

    const el = document.createElement("section");
    el.className = "win";
    el.dataset.app = spec.id;
    el.innerHTML = `
      <header class="win-bar">
        <div class="win-title"></div>
        <div class="win-actions">
          <button class="win-btn" data-act="min" title="Minimise">─</button>
          <button class="win-btn" data-act="max" title="Maximise">▢</button>
          <button class="win-btn danger" data-act="close" title="Close">✕</button>
        </div>
      </header>
      <div class="win-body"></div>
      <div class="win-grip" title="Resize"></div>`;
    el.querySelector(".win-title").textContent = spec.title;

    const body = el.querySelector(".win-body");
    const bar = el.querySelector(".win-bar");

    const width = spec.width || 760;
    const height = spec.height || 540;
    const rect = this.layer.getBoundingClientRect();
    const n = this.cascade++ % 6;
    const left = clamp(96 + n * 28, 8, Math.max(8, rect.width - width - 8));
    const top = clamp(24 + n * 24, 8, Math.max(8, rect.height - height - 8));

    el.style.width = `${Math.min(width, rect.width - 16)}px`;
    el.style.height = `${Math.min(height, rect.height - 16)}px`;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;

    // Reuse the pinned dock launcher when the app has one, otherwise add an entry.
    const pinned = this.launchers.get(spec.id);
    const dockItem = pinned || document.createElement("button");
    if (!pinned) {
      dockItem.type = "button";
      dockItem.innerHTML = `<span>${spec.icon || "▣"}</span><span class="dock-dot"></span>`;
      dockItem.addEventListener("click", () => {
        if (win.minimised) { win.unminimise(); win.focus(); }
        else if (win.focused) win.minimise();
        else win.focus();
      });
    }
    dockItem.classList.add("running");
    dockItem.title = spec.title;

    const win = {
      id: spec.id,
      spec,
      el,
      body,
      dockItem,
      minimised: false,
      focused: false,
      maximised: false,
      prevRect: null,

      focus() {
        for (const other of manager.wins.values()) {
          other.focused = false;
          other.el.classList.remove("focused");
          other.dockItem.classList.remove("active");
        }
        win.focused = true;
        win.el.classList.add("focused");
        win.dockItem.classList.add("active");
        win.el.style.zIndex = ++zTop;
        if (manager.onStateChange) manager.onStateChange(manager.wins);
      },

      minimise() {
        win.minimised = true;
        win.el.classList.add("minned");
        win.dockItem.classList.remove("active");
      },

      unminimise() {
        win.minimised = false;
        win.el.classList.remove("minned");
      },

      toggleMax() {
        if (win.maximised) {
          win.maximised = false;
          el.classList.remove("maxed");
          if (win.prevRect) Object.assign(el.style, win.prevRect);
        } else {
          win.maximised = true;
          win.prevRect = { width: el.style.width, height: el.style.height, left: el.style.left, top: el.style.top };
          el.classList.add("maxed");
          el.style.left = "0px";
          el.style.top = "0px";
          el.style.width = "100%";
          el.style.height = "100%";
        }
        if (win.onResize) win.onResize();
      },

      /** Snap to half the screen ("left"/"right") or fill it ("max"). */
      snap(kind) {
        const bounds = manager.layer.getBoundingClientRect();
        win.prevRect = { width: el.style.width, height: el.style.height, left: el.style.left, top: el.style.top };
        el.classList.remove("maxed");
        if (kind === "max") {
          win.maximised = true;
          el.classList.add("maxed");
          el.style.left = "0px";
          el.style.top = "0px";
          el.style.width = "100%";
          el.style.height = "100%";
        } else {
          const half = Math.round(bounds.width / 2);
          win.maximised = false;
          el.style.width = `${half}px`;
          el.style.height = "100%";
          el.style.top = "0px";
          el.style.left = kind === "left" ? "0px" : `${bounds.width - half}px`;
        }
        if (win.onResize) win.onResize();
      },

      close() {
        win.el.remove();
        win.dockItem.classList.remove("running", "active");
        if (!pinned) win.dockItem.remove();
        manager.wins.delete(spec.id);
        if (win.onClose) win.onClose();
      },

      setTitle(t) {
        el.querySelector(".win-title").textContent = t;
        dockItem.title = t;
        if (manager.onTitleChange) manager.onTitleChange(spec.id, t);
      },
    };

    this.wins.set(spec.id, win);
    this.layer.appendChild(el);
    if (!pinned) {
      // Keep running windows before the separator, so the grid button stays last.
      const separator = this.dock.querySelector(".dock-sep");
      if (separator) this.dock.insertBefore(dockItem, separator);
      else this.dock.appendChild(dockItem);
    }
    win.focus();
    if (this.onStateChange) this.onStateChange(this.wins);

    el.querySelectorAll(".win-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === "min") win.minimise();
        if (act === "max") win.toggleMax();
        if (act === "close") (spec.closable === false ? win.minimise() : win.close());
      });
    });
    if (spec.closable === false) el.querySelector('[data-act="close"]').style.display = "none";

    el.addEventListener("pointerdown", () => win.focus(), true);
    bar.addEventListener("dblclick", (e) => { if (!e.target.closest(".win-btn")) win.toggleMax(); });

    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".win-btn") || win.maximised) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const startLeft = el.offsetLeft;
      const startTop = el.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const bounds = this.layer.getBoundingClientRect();
        el.style.left = `${clamp(startLeft + ev.clientX - startX, -el.offsetWidth + 120, bounds.width - 60)}px`;
        el.style.top = `${clamp(startTop + ev.clientY - startY, 0, bounds.height - 40)}px`;
      };
      const up = (ev) => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        if (win.maximised || !ev) return;
        // Dragging into an edge tiles the window, the way a real desktop does.
        const bounds = this.layer.getBoundingClientRect();
        if (ev.clientY <= bounds.top + 6) win.snap("max");
        else if (ev.clientX <= bounds.left + 8) win.snap("left");
        else if (ev.clientX >= bounds.left + bounds.width - 8) win.snap("right");
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });

    const grip = el.querySelector(".win-grip");
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const w0 = el.offsetWidth;
      const h0 = el.offsetHeight;
      grip.setPointerCapture(e.pointerId);
      const move = (ev) => {
        el.style.width = `${Math.max(320, w0 + ev.clientX - startX)}px`;
        el.style.height = `${Math.max(200, h0 + ev.clientY - startY)}px`;
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        if (win.onResize) win.onResize();
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
    });

    if (window.innerWidth <= 760) win.toggleMax();

    const api = {
      win,
      open: (id) => ctx.open(id),
      notify: ctx.notify,
      vm: ctx.vm,
      settings: ctx.settings,
      saveSettings: ctx.saveSettings,
      reboot: ctx.reboot,
      bootImage: ctx.bootImage,
      vmNetLabel: ctx.vmNetLabel,
      applyWallpaper: ctx.applyWallpaper,
    };

    try {
      spec.mount(api);
    } catch (err) {
      body.innerHTML = `<div class="pane"><p class="app-p">This app failed to start: ${String((err && err.message) || err)}</p></div>`;
      console.error(err);
    }
    return win;
  }

  reflow() {
    const rect = this.layer.getBoundingClientRect();
    for (const win of this.wins.values()) {
      if (win.maximised) continue;
      const el = win.el;
      if (el.offsetLeft > rect.width - 80) el.style.left = `${Math.max(0, rect.width - 120)}px`;
      if (el.offsetTop > rect.height - 40) el.style.top = `${Math.max(0, rect.height - 60)}px`;
    }
  }
}
