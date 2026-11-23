# x86 machines, in a browser tab

A shelf of **real 32-bit x86 PCs** that boot inside the page, on the [v86](https://github.com/copy/v86)
emulator. Pick one and press Start: the disk is streamed from its own mirror, a chunk at a time, so nothing
is downloaded whole and nothing is stored here.

Static files only: runs from GitHub Pages with no backend and no build step. The only server-side piece is a
small range proxy in `edge/`, deployed separately (see below).

## The machines

v86 emulates a **32-bit x86 PC with a legacy BIOS**: no 64-bit mode, no UEFI, and only partial PAE. That
decides this whole list. A distribution is on it only if it still publishes an i386/i686 image that boots
from a plain BIOS — and, for Raspberry Pi Desktop, which kernel it is allowed to boot (see below).

| Machine | Release | Image | Status |
| --- | --- | --- | --- |
| Raspberry Pi Desktop | 2022-07-01, i386 | 3.4 GB live ISO | boots to X; no greeter (LightDM start timeout) |
| Alpine Linux | 3.24.4, x86 | 277 MB live ISO | boots, console (root, no password) |
| Alpine Linux extended | 3.24.4, x86 | 1.2 GB live ISO | boots, console + full package tree |
| Tiny Core Linux | 15.0, x86 | 24 MB live ISO | boots to a Fluxbox desktop |
| Tiny Core Plus | 15.0, x86 | 249 MB live ISO | boots |
| Void Linux | 2025-02-02, i686 | 974 MB base ISO | experimental |
| Void Linux Xfce | 2025-02-02, i686 | 1.3 GB live ISO | experimental |
| Debian | 12.11, i386 | 647 MB netinst | installer, not a live session |
| antiX | 26.1, 386 | 2.1 GB live ISO | experimental (newest desktop here) |
| Arch Linux 32 | 2024.07.10, i686 | 796 MB live ISO | experimental, console installer |
| Slackware | 15.0, 32-bit DVD | 3.6 GB install DVD | experimental |

"Experimental" means the image streams and starts, but nobody here has sat through a full boot to userspace
on it. They are kept because they are the current 32-bit releases, not because they were verified.

### What is missing, and why

The usual "modern Linux" list mostly cannot be here at all: Ubuntu (last i386 desktop 18.04), Linux Mint
(19.3), Fedora (i686 stopped after 32), openSUSE, Manjaro, Pop!\_OS, elementary and the rest publish only
x86-64 builds now, and Debian 13 dropped its i386 installer media. 64-bit kernels cannot execute on this CPU.

## Windows

There is a hard ceiling, and it is not about hosting or bandwidth:

| Windows | Here |
| --- | --- |
| 1.01, 2.03, 3.0, 3.1 | work (16-bit, floppy/HD) |
| 95 OSR2, 98 SE, ME | work well enough to be usable |
| NT 4.0, 2000, XP | work, but need the PC type changed from ACPI PC to Standard PC during setup |
| Vista, 7, 8 | **cannot run** — they need PAE/NX and SSE2 in a form v86 does not provide |
| 8.1, 10, 11 | **cannot run** — no 64-bit mode, and they need UEFI |

So "the newest Windows" on this page is the NT 5.x generation. Microsoft's images are not free to
redistribute and none of them is on a mirror this page may stream, so the Windows tiles are **bring your
own**: click one, pick an install ISO or a raw disk image you already have, and it boots from disk. Set the
computer type to Standard PC during a 2000/XP install. Expect a long wait — an emulated Pentium is slow.

For a free, NT-compatible alternative, ReactOS 0.4.16 also runs here: unzip its release, pick the `.iso`,
and it boots like the other machines.

## Using it

Open the page and pick a machine. Nothing boots on page load, so a visit costs the image proxy nothing; a
boot spends its request budget only while it is running.

* **Start** boots the machine you used last. **Machines** stops the guest and brings the picker back.
* **Choose image** (or dropping a file on the page) boots your own `.iso`, `.img` or `.bin`. Files up to
  2.8 MB are treated as floppies, `.iso` as a CD, everything else as a hard disk.
* **Restart**, **Pause**, **Paste** and **Fullscreen** act on the running guest.

### Settings

* **Memory** — 256 to 2048 MB. A machine raises this to its own minimum (antiX wants 1536).
* **Read size** — how much of the image each range request fetches. 8 MB is about 430 requests for a 3.4 GB
  boot and about 4 for Tiny Core; larger reads use more memory per request.
* **Network relay** — the WebSocket relay the guest's NE2000 card talks to, for real TCP inside the guest.

Settings live in `localStorage` and apply the next start.

### Serial console

**🖥 Serial** shows the guest's first serial port, captured byte for byte from the emulator as it arrives (the
last 128 KB is kept, oldest output dropped first). It stays empty for the images that do not set up a serial
console themselves. The Raspberry Pi ISO does, so its kernel log and the output of every service — LightDM's
owned, not just an inference from a black screen — can be read there while X, or a greeter that never paints,
holds the screen.

## How the images get in

A multi-gigabyte ISO cannot be loaded into a tab, so it never is:

* **The image is never stored here.** GitHub rejects blobs over 100 MB and caps a published Pages site at
  1 GB, so each image stays on its own mirror and is read through `edge/worker.js`. It answers
  `GET /img?u=<encoded url>` with the matching bytes, CORS headers and byte ranges, and `GET /iso` for the
  Raspberry Pi image (kept for old links). It stores nothing and downloads nothing in full.
* **Only allowlisted hosts are fetched** — an unrestricted `?u=` would be an open proxy. Redirects are
  followed (Debian and Slackware both bounce to a mirror), but the URL the page asks for must be listed.
* **The upstream must honour `Range`.** Some mirrors answer a range request with the whole file when the
  request has no User-Agent, so the proxy always sends one, and retries with Cloudflare's cache bypassed
  when a 200 comes back anyway. A 200 is never served to v86: its body would start at byte 0 instead of the
  offset v86 asked for.
* **v86 reads fixed-size chunks on demand** (`fixed_chunk_size`), so RAM stays at the memory given to the
  guest and only the blocks the guest asks for are transferred.
* **Raspberry Pi Desktop's boot line and kernel are rewritten on the way through.** v86 boots that ISO
  through El Torito, which starts `isolinux.bin`. `archdetect` finds a 32-bit CPU that reports PAE, so the
  i386 menu (`isolinux/x86.cfg`) loads and its default entry — `isolinux/x86run.cfg`, sector 110737 — starts
  `/live/vmlinuz1`, Debian's 686-pae kernel. That kernel boots but faults in the block layer under v86, so
  the sector is also moved to the non-PAE pair (`/live/vmlinuz0`, `/live/initrd0.img`) that
  `isolinux/nopaerun.cfg` keeps for CPUs without PAE; both replacement names are as long as the originals.
  The same sector and `isolinux/nopaerun.cfg` (110684) get `quiet splash
  plymouth.ignore-serial-consoles persistence` replaced with
  `console=tty1 console=ttyS0 xforcevesa nomodeset systemd.journald.forward_to_console=1`, on both entries,
  since each menu lists two. Kernel messages then go to COM1 as well as to the screen, and journald forwards
  every service's own output there as well. The ISO's other menu, `boot/grub/grub.cfg` (3709), is left alone:
  it is what a UEFI machine reads, and v86 boots through El Torito and isolinux. That command line is longer
  than the token run it replaces, so it takes room from the 1.6 KiB of zero padding at the end of each 2 KiB
  sector; the sector stays 2 KiB and the ISO9660 directory stays valid. A local copy of that ISO gets the same
  patch in the page (`js/vm.js`).

### The edge proxy

`edge/worker.js` is deployed as its own Worker (`edge/deploy.json` is the manifest, published through
Freebuff Sites at `https://pi-desktop-iso-proxy-jdg88r.freebuff.site` — the production environment).

That hosting tier allows **10,000 requests a day**, shared by every machine. A Tiny Core boot costs about 4,
Alpine about 40, Raspberry Pi Desktop about 430, Slackware about 490. Raise **Read size** to trade memory for
fewer requests; lower it if a single read is too large for the connection.

### The relay (experimental)

`js/wisp.js` carries WispScope's verified independent relay list (57 endpoints) and a scanner, and can route
the image's range reads through a relay with libcurl.js (TLS terminated in the tab, so the relay only sees
ciphertext). It is **not the default**: the preflight succeeds and the shim mounts, but image reads through
a relay have stalled in testing, so the machine reads straight from the proxy unless a relay is chosen in
the 🌐 **Relay** dialog. Treat that panel as the experiment it is.

Networking inside the guest uses v86's NE2000 card and the public WebSocket relay
(`wss://relay.widgetry.org/`), which is what gives the guest a DHCP lease and real TCP.

## Status, honestly

* Verified here: the picker renders every entry; every image URL answers a ranged request through the proxy
  (206, correct total size, CORS); Tiny Core Linux streams and reaches its own boot menu in v86.
* Raspberry Pi Desktop boots as far as X and stops there, and its serial console says why. Read through the
  deployed proxy and the page's own 🖥 Serial capture: isolinux → live squashfs → systemd → DHCP →
  `live-config` (6–9 minutes) → LightDM, which brings up X at 1280×720. The first line on that console is
  `Linux version 5.10.0-15-686 (debian-kernel@lists.debian.org) … #1 SMP Debian 5.10.120-1`, so the
  retargeted entry really does start the non-PAE kernel; under Debian's PAE kernel the same boot faults in
  `blk_mq_dispatch_rq_list` and stalls RCU. LightDM's own output is two warnings — `Error getting user list
  from org.freedesktop.Accounts: … ServiceUnknown` and `Could not enumerate user data directory
  /var/lib/lightdm/data` — and then systemd's verdict: `lightdm.service: start operation timed out.
  Terminating.`, `State 'stop-sigterm' timed out. Killing.`, SIGKILL of `lightdm` (740), `Xorg` (1084) and its
  `gdbus` helper (1078), `Failed with result 'timeout'`, `Scheduled restart job`, and another round. That
  cgroup never contains a greeter process, so the black screen is X up with no greeter launched yet, killed
  and restarted. polkit, udisks2, CUPS, wpa_supplicant and dhcpcd fail around it, and the console login
  rejects the live user, so no session is reachable.
* Not verified: a full boot to userspace of Alpine, Void, antiX, Arch Linux 32, Slackware or Debian's
  installer. They are listed as experimental for that reason.
* The guest is slow. Expect minutes, not seconds, on any full desktop.
* Live sessions have no writable disk: changes inside the guest are lost when it restarts.
* Streaming needs the edge proxy to be up. Without it, a machine falls back to a local image file.

## Layout

```
index.html        the page: toolbar, screen, machine picker
css/style.css     styles for the window and the picker
edge/worker.js    range proxy: CORS, byte ranges, host allowlist, boot-sector patch
edge/deploy.json  manifest for deploying that Worker
js/distros.js     the machine catalog: names, mirrors, exact sizes
js/main.js        wiring: catalog, boot, fit, fullscreen, paste, restart, relay panel
js/vm.js          v86 controller, lazy image plumbing, boot-sector patch, serial capture
js/wisp.js        Wisp relay list, scanner, libcurl.js transport
vm/libv86.js      v86 runtime (BSD-2-Clause)
vm/v86.wasm       v86 JIT
vm/seabios.bin    BIOS
vm/vgabios.bin    VGA BIOS
vm/libcurl.js     libcurl.js 0.7.5 (LGPL-3.0) for the relay transport
```

## Credits

* [v86](https://github.com/copy/v86) — x86 emulator and x86-to-Wasm JIT, BSD-2-Clause (`vm/LICENSE-v86.txt`).
* [libcurl.js](https://github.com/ading2210/libcurl.js) — libcurl in WebAssembly, LGPL-3.0
  (`vm/LICENSE-libcurl.txt`); used only by the experimental relay transport.
* [WispScope](https://github.com/AstroBunnyStar/wispscope) — the relay list and scanning approach.
* Every distribution and its trademarks belong to its own project; Windows is © Microsoft. Nothing here
  redistributes an image — each one is streamed from the publisher's own mirror.
