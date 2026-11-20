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

1. Download `2022-07-01-raspios-bullseye-i386.iso` (3.4 GB) from the Foundation's download page.
2. Open the page and choose that file.
3. Wait. A cold boot prints kernel messages for a few minutes before the system is up.

Nothing is uploaded and nothing is cached: the file stays on your disk.

## How the image gets in

A 3.4 GB ISO cannot be loaded into a browser tab, so it never is:

* v86 is handed the `File` itself. It reads 512 KiB slices on demand through `File.slice()`, so only the
  blocks the guest actually asks for are ever read, and RAM stays at the 1 GB given to the guest.
* The ISO's own syslinux entry is rewritten in the stream (`js/vm.js`, sector 110737) before the guest
  sees it. Its `quiet splash plymouth.ignore-serial-consoles persistence` becomes
  `console=tty1 xforcevesa nomodeset`: plymouth's splash never quits on this emulated VGA, and the boot
  hangs behind it, so the parameters are replaced in place (same byte length) and the kernel log is left
  on the console instead. If the sector does not match — a different ISO — the file is booted untouched.
* The ISO's boot menu waits for a keypress (`timeout 0`), so the page presses Enter for you a few seconds
  in, and again on every restart.

Networking uses v86's NE2000 card and the public WebSocket relay (`wss://relay.widgetry.org/`), which is
what gives the guest a DHCP lease and real TCP.

## Status, honestly

* The boot is real: syslinux → 32-bit kernel → live squashfs → systemd → the Pi Desktop system.
* It is slow. Expect several minutes to userspace on an emulated CPU.
* The graphical session is the weak point: on v86's plain VGA the guest can end up at a text login
  instead of lightdm/LXDE. The boot parameters above force the VESA driver, which is the best path this
  emulator offers, but a full desktop is not guaranteed.
* The live session has no writable disk: changes inside the guest are lost when it restarts.

## Layout

```
index.html        the page: toolbar, screen, file picker
css/style.css     styles for the single machine window
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
