# WebVM OS — a desktop operating system in your browser

An Ubuntu-style desktop shell (top bar, dock, application grid, lock screen) wrapped around a
complete 32-bit x86 PC emulated in WebAssembly. It boots a real Alpine Linux, gives it a network
card, lets you install packages into it, and hands files between the desktop and the machine — all
from static files, so it runs as-is on GitHub Pages.

![stack](https://img.shields.io/badge/engine-v86-4ea1ff) ![guest](https://img.shields.io/badge/guest-Alpine%20Linux-0f9d58) ![build](https://img.shields.io/badge/build-none-lightgrey)

## What you get

| App | What it does |
| --- | --- |
| **Machine** | The real x86 PC screen. Boots Alpine 3.21 (console, `apk`, `wget`, `python3`) or SliTaz with a full X11 desktop. |
| **Files** | Everything handed to the machine (`/mnt/host`), plus drag-and-drop uploads. |
| **Text Editor** | Write a file and save it straight into the guest, or download it. |
| **Python 3** | CPython on WebAssembly (Pyodide) with a REPL, examples and `pip install` (pure-Python wheels). |
| **Browser** | Web panel with a URL bar and shortcuts; sites that block framing open in a real tab. |
| **Downloads** | Fetch any URL in the browser, save it to your computer or copy it into the guest over a 9p share. |
| **Software** | One-click setup plus `apk add` for Python, git, node, gcc, vim, htop, ffmpeg, sqlite, ssh, ruby… |
| **Desktop (X11)** | One click boots the bundled SliTaz desktop, or installs Xorg + Fluxbox into Alpine with an fbdev→VESA fallback and an Xorg-log helper. |
| **Raspberry Pi** | Straight answers about Pi OS on this machine (spoiler: it is ARM, this is x86), where to run it instead, and a picker for your own 32-bit ISO. |
| **System Monitor** | Live machine state, uptime, memory and emulated CPU throughput graph. |
| **Calculator** | Working calculator with keyboard support. |
| **Settings** | RAM, network backend, display scale, operating system (Alpine or SliTaz), or your own 32-bit ISO. |
| **About** | How the pieces fit together, plus the honest limits. |

Shell features: top bar with network/time/system menu, left dock with running indicators,
application grid (**Activities** or `Ctrl+Alt+A`), lock screen, toast notifications, and
`Ctrl+Alt+T` for a terminal.

## Run it locally

Any static file server works — the app is plain HTML/CSS/ES modules, no build step:

```bash
npx serve .            # or: python3 -m http.server 8000
```

Then open <http://localhost:3000>. Don't open `index.html` from `file://`: WebAssembly and the
ISO need HTTP.

## Deploy to GitHub Pages

1. Push this folder to a repository (keep both images in `media/` — 48 MB and 59 MB, under GitHub's 100 MB per-file limit).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` publishes the repository root as the site.

Everything is relative-path and same-origin, so no configuration is needed. If your repository name
adds a subpath (`https://user.github.io/repo/`), it still works — all URLs are relative.

## Inside the Linux machine

Log in at the console as `root` (no password). Bring the network up:

```sh
ip link set eth0 up
udhcpc -i eth0
# the live ISO only ships an offline repo on the CD — add the online mirror once
echo https://dl-cdn.alpinelinux.org/alpine/v3.21/main >> /etc/apk/repositories
apk update
apk add python3 git nodejs build-base
```

The **Software** app has a *Set up networking & packages* button that types this sequence for you.

### Sessions survive a reload

The machine is snapshotted into IndexedDB — the guest's RAM, so roughly its memory size. WebVM saves
about once a minute, when the tab is hidden or closed, and whenever you press **💾 Save** in the
Machine window; the status bar says when the last snapshot was taken. Opening the site again restores
that snapshot instead of cold-booting, so packages you installed, programs that were running and your
shell history are all still there.

**🧹 Reset** in the Machine toolbar (or **Restart machine** anywhere) discards the snapshot and boots a
fresh guest. Snapshots belong to one browser and one origin: clearing site data, a private window or
another browser starts clean. The snapshot is the machine — the guest has no disk image, so its RAM is
where everything lives.

### How guest networking works

v86's NE2000 card is bridged to the internet through a WebSocket proxy. The default is the public
relay `wss://relay.widgetry.org/` (shared, so slow). Options in **Settings**:

* **WebSocket relay** — full TCP; the default. Paste your own relay URL (v86's `tools/websockproxy`) for real speed.
* **WISP** — full TCP through a WISP server (`wisp://host:port`).
* **Browser fetch** — no relay at all: the guest's HTTP requests become `fetch()` calls. Only works for
  CORS-enabled hosts, but needs no infrastructure.
* **Offline** — no network at all.

DNS is answered over DNS-over-HTTPS by v86. Ping only reaches the virtual router; TCP is fully proxied.

### A graphical Linux desktop inside the machine

**Fastest path:** **Desktop (X11) → Boot the graphical desktop**, or **Settings → Operating system →
SliTaz — graphical X11 desktop**. The bundled SliTaz image already contains Xorg, so the machine boots
straight into a real graphical session (Openbox, panel with an Applications menu, desktop icons, Midori,
file manager, terminal) in a couple of minutes with nothing to download except the 59 MB image itself.
Click the screen to capture the mouse, `Esc` releases it.

The **Desktop (X11)** app also walks through installing a desktop into Alpine with four steps (all typed
into the guest for you):

```sh
# 1. networking + online repositories
ip link set eth0 up; udhcpc -i eth0 -n
# 2. the X stack (~90 MB)
apk add --no-cache xorg-server xf86-video-fbdev xf86-video-vesa \
  xf86-input-evdev xf86-input-libinput xinit fluxbox xterm font-misc-misc \
  eudev udev-init-scripts
# 3. /etc/X11/xorg.conf (1024x768, fbdev) + ~/.xinitrc -> fluxbox
# 4. rc-service udev start; startx
```

> Expect this one to be slow: `xorg-server` pulls in mesa and LLVM (~90 MB), which is a long job on
> emulated hardware. SliTaz is the quick way to a desktop.

The emulated screen switches to a 1024×768 X session. Click the Terminal surface once to capture the
mouse, press `Esc` to release it. If Xorg refuses to start, the app has a button that prints
`/var/log/Xorg.0.log` and one that rewrites the config for the VESA driver.

Raspberry Pi OS itself cannot run here: Pi OS 32-bit is ARM (`armhf`) code and this machine emulates a
32-bit x86 CPU, so no Pi image can execute — bundled or supplied by you. The official
[Raspberry Pi Desktop for PC](https://www.raspberrypi.com/software/raspberry-pi-desktop/) does not fit
either: the October 2026 release is `amd64` (64-bit) only and about 2.6 GB, while v86 is 32-bit and
caps the guest at 2 GB of RAM. The **Raspberry Pi** app says all of this in the UI and points at the
real options. What you get here instead is an equivalent x86 graphical session.

### Transferring files into the guest

The **Downloads** app writes the fetched file into v86's `virtio-9p` share. Mount it once inside the guest:

```sh
mkdir -p /mnt/host
mount -t 9p -o trans=virtio,version=9p2000.L hostshare /mnt/host
ls /mnt/host
```

## Architecture

```
index.html            shell markup (top bar, dock, app grid, lock screen)
css/style.css         Yaru/Ubuntu-inspired theme, window chrome, per-app styles
js/main.js            shell: dock, app grid, system menu, clock, boot sequence
js/wm.js              window manager (drag, resize, minimise, maximise, dock state)
js/vm.js              v86 controller: boot, input, screenshots, 9p transfer, settings
js/store.js           files shared with the guest (Files, Editor, Downloads)
js/apps/*.js          one module per app
vm/libv86.js          v86 runtime (BSD-2-Clause)
vm/v86.wasm           v86 JIT, ~2 MB
vm/seabios.bin        BIOS
vm/vgabios.bin        VGA BIOS
media/*.iso           bootable 32-bit x86 guest
```

The VM is created with `new V86({ cdrom, memory_size, net_device, screen, filesystem, uart1, ... })`.
It renders straight into a `<canvas>` inside the window; keyboard events are captured by the runtime,
so typing in the guest works whenever the page has focus (v86 ignores input fields, so the Python
editor and URL bars are safe).

## Limitations (please read)

* **Minecraft Java Edition cannot run here.** It needs a 64-bit CPU, a GPU with OpenGL and several GB of
  RAM; this is a 32-bit PC emulated instruction-by-instruction with a software VGA adapter. 32-bit,
  CPU-only software — Python, gcc, Node, servers, compilers, editors — works, and `apk` can install it.
* Performance is roughly that of a late-1990s PC. Expect a 30–90 second cold boot.
* The guest is live media: everything lives in RAM and a restart gives you a clean machine.
* Raspberry Pi OS (armhf/ARM) and the 64-bit Raspberry Pi Desktop cannot boot in a 32-bit x86 emulator.
  Any 32-bit x86 ISO you supply yourself works, within browser memory limits.
* The public relay is shared and rate-limited. For daily use, host your own relay.
* 1 GB or more of RAM needs a desktop browser with headroom; 512 MB is the default and the sweet spot.

## Credits

* [v86](https://github.com/copy/v86) — x86 emulator and x86-to-Wasm JIT, BSD-2-Clause (see `vm/LICENSE-v86.txt`).
* [Alpine Linux](https://alpinelinux.org/) — guest operating system.
* [Pyodide](https://pyodide.org/) — CPython compiled to WebAssembly, loaded from jsDelivr on first use.
