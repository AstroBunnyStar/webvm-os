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
project boots, and the only image it accepts. Use the **2022-07-01 `i386`** live ISO (3.4 GB).

## Using it

Open the page and press **Start**. Nothing boots on page load. A cold boot prints kernel messages for a few
minutes before the system is up.

### Settings

The ⚙ **Settings** button sets the guest memory, image URL, range-read size, and network relay. Settings
are kept in `localStorage`. Restart reboots the selected image and applies the saved settings.

If streaming is unavailable, choose a local ISO file with the toolbar button or drag and drop it onto the page.

## Why the ISO is not bundled with the site

The ISO is 3,607,101,440 bytes (about 3.4 GB). It cannot be included in this repository or served as part
of this GitHub Pages site: GitHub rejects individual repository files larger than 100 MB, and Pages has a
1 GB published-site limit. Splitting the ISO into pieces would not avoid the Pages limit. To serve the
image without a separate range proxy, this project would need a different hosting service with sufficient
storage and range-request support. The current site uses a range proxy to fetch the official ISO on demand;
the browser reads only the needed chunks rather than downloading the whole image up front.

The official image URL is
[2022-07-01-raspios-bullseye-i386.iso](https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso)
(3,607,101,440 bytes, SHA-256 `5fa906df25e600bf7d7e6a5eb7b0e9b6605e60992ee6c8efe79bc99e7c2452bd`).

## How booting works

* v86 reads image data in chunks on demand; the complete image is not loaded into browser memory.
* The boot configuration sector is patched byte-for-byte to remove a splash screen that can hang under the
  emulated VGA. The same patch is applied for streamed and local images.
* The ISO boot menu waits for a keypress, so the page sends Enter repeatedly during startup.
* Networking uses v86's NE2000 card and the configured public WebSocket relay.

## Status, honestly

* The boot is real: syslinux → 32-bit kernel → live squashfs → systemd → the Pi Desktop system.
* It is slow. Expect several minutes to userspace on an emulated CPU.
* The graphical session is the weak point: on v86's plain VGA the guest can end up at a text login instead
  of lightdm/LXDE. A full desktop is not guaranteed.
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
