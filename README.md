# Raspberry Pi Desktop, in a browser tab

This page boots **Raspberry Pi Desktop for PC** — the Raspberry Pi Foundation's 32-bit x86 edition of the
Pi's desktop — inside the browser, with the [v86](https://github.com/copy/v86) emulator. One machine, one
window, no other apps.

Static files only: it runs from GitHub Pages with no backend and no build step.

## What runs, and what cannot

Raspberry Pi OS **for the Pi** cannot run here. Every image the Foundation ships for the board is ARM
(`armhf` or `arm64`), and v86 emulates a 32-bit x86 PC; ARM instructions cannot execute on that CPU.

[Raspberry Pi Desktop for PC](https://www.raspberrypi.com/software/raspberry-pi-desktop/) is the other
product with that name: the same Pi desktop, built for 32-bit x86 machines. That is the one thing this
project boots, and the only image it accepts. Use the **2022-07-01 `i386`** live ISO (3.4 GB) — it is the
last i386 release; the October 2026 build is `amd64`-only and cannot run on this CPU.

## Using it

Open the page. The machine starts on its own: there is no download button, no file picker, and nothing to
install. A cold boot prints kernel messages for a few minutes before the system is up.

If the edge proxy cannot be reached, the page offers a local file instead — pick the
[2022-07-01-raspios-bullseye-i386.iso](https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso)
(3,607,101,440 bytes, sha256 `5fa906df25e600bf7d7e6a5eb7b0e9b6605e60992ee6c8efe79bc99e7c2452bd`) and it boots from disk instead.

## How the image gets in

A 3.4 GB ISO cannot be loaded into a browser tab, so it never is. The page streams it:

* **The file is never stored here.** GitHub rejects blobs over 100 MB and caps a published Pages site at
  1 GB, so the image stays on Raspberry Pi's download server and is read through a small range proxy
  (`edge/worker.js`, deployed separately — see below). The Worker adds the CORS headers a browser needs
  (Raspberry Pi's server sends none, so the file cannot be read cross-origin directly) and answers each
  `Range` request with the matching bytes.
* **v86 reads 8 MiB chunks on demand** over those range requests, so RAM stays at the 1 GB given to the
  guest and only the blocks the guest asks for are ever transferred.
* **The boot sector is rewritten on the way through.** The ISO's syslinux entry has
  `quiet splash plymouth.ignore-serial-consoles persistence`; plymouth's splash never quits on this
  emulated VGA and the boot hangs behind it forever. The proxy replaces those parameters with
  `console=tty1 xforcevesa nomodeset` in the same 2 KiB sector (identical byte length, so the ISO9660
  directory stays valid). Booting from a local file does the same thing in the page (`js/vm.js`).
* **The ISO's boot menu waits for a keypress** (`timeout 0`), so the page presses Enter for you a few
  seconds in, and again on every restart.

### The edge proxy

`edge/worker.js` is deployed as its own Worker (`edge/deploy.json` is the manifest, published through
Freebuff Sites at `https://pi-desktop-iso-proxy-jdg88r-preview.freebuff.site/iso`). It stores nothing:
`/iso` forwards to Raspberry Pi's server, adds CORS, and patches the boot sector.

That hosting tier allows **10,000 requests a day**. One boot costs roughly 430 of them (3.4 GB ÷ 8 MiB),
so the proxy carries about twenty cold boots a day before the environment is paused. Raise `chunkSize` in
`js/vm.js` to trade memory for fewer requests; point `ISO_STREAM.url` somewhere else if you host the
proxy yourself.

Networking uses v86's NE2000 card and the public WebSocket relay (`wss://relay.widgetry.org/`), which is
what gives the guest a DHCP lease and real TCP.

## Status, honestly

* The boot is real: syslinux → 32-bit kernel → live squashfs → systemd → the Pi Desktop system.
* It is slow. Expect several minutes to userspace on an emulated CPU.
* The graphical session is the weak point: on v86's plain VGA the guest can end up at a text login
  instead of lightdm/LXDE. The boot parameters above force the VESA driver, which is the best path this
  emulator offers, but a full desktop is not guaranteed.
* Streaming needs the edge proxy to be up. Without it the page falls back to a local ISO file.
* The live session has no writable disk: changes inside the guest are lost when it restarts.

## Layout

```
index.html        the page: toolbar, screen, boot card
css/style.css     styles for the single machine window
edge/worker.js    range proxy: CORS, byte ranges, boot-sector patch
edge/deploy.json  manifest for deploying that Worker
js/main.js        wiring: boot, fit, fullscreen, paste, restart
js/vm.js          v86 controller, ISO slicing and boot-sector patch
vm/libv86.js      v86 runtime (BSD-2-Clause)
vm/v86.wasm       v86 JIT
vm/seabios.bin    BIOS
vm/vgabios.bin    VGA BIOS
```

## Credits

* [v86](https://github.com/copy/v86) — x86 emulator and x86-to-Wasm JIT, BSD-2-Clause (see `vm/LICENSE-v86.txt`).
* Raspberry Pi Desktop is © Raspberry Pi Ltd.
