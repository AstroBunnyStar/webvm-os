// Range proxy for every machine this page can boot.
//
// Distro mirrors send no CORS headers and a multi-gigabyte image cannot be downloaded into a tab first, so
// this Worker answers Range requests with CORS and v86 streams the image one chunk at a time. Nothing is
// stored and nothing is downloaded in full.
//
//   /iso                 Raspberry Pi Desktop (kept for the old links)
//   /img?u=<encoded url> any allowlisted image
//
// Only the hosts below may be fetched: an unrestricted `?u=` would be an open proxy. Redirects are followed
// (Debian and Slackware both bounce to a mirror), but the URL the page asks for has to be on the list.

export const PI_UPSTREAM =
  "https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso";

export const ISO_SIZE = 3607101440;

// Raspberry Pi's live ISO keeps its kernel log behind plymouth's splash on this emulated VGA, and a machine
// whose desktop never paints its greeter leaves nothing else to read. The 2 KiB sectors that hold the boot
// command line are therefore rewritten as they stream past: plymouth is dropped, X is pinned to plain VESA,
// and the kernel gets a serial console together with journald's console forwarding, so kernel messages and
// each service's own output — LightDM's included — leave the guest on COM1. No other image needs this.
//
// Which sector matters. v86 boots this ISO through El Torito, which starts isolinux.bin; archdetect finds a
// 32-bit CPU that reports PAE, so the i386 menu's default entry — isolinux/x86run.cfg — loads the 686-pae
// kernel, which faults under v86 shortly after X starts. That entry is therefore retargeted to the same-length
// non-PAE pair (/live/vmlinuz0, /live/initrd0.img) that isolinux/nopaerun.cfg uses, and both isolinux sectors
// get the command line. Each menu holds two entries, so each substitution has two occurrences in its sector.
// The ISO's other boot menu, boot/grub/grub.cfg, is the one a UEFI machine reads and v86 never gets there.
//
// The replacement command line is longer than the one it replaces, which is allowed: both isolinux sectors end
// in 1.6 KiB of zero padding, and patchSector() spends that padding instead of pushing the rest of the sector
// out of the 2 KiB extent the ISO9660 directory record still points at.
const CMDLINE = [
  "quiet splash plymouth.ignore-serial-consoles persistence",
  "console=tty1 console=ttyS0 xforcevesa nomodeset systemd.journald.forward_to_console=1",
];
const NON_PAE = [
  ["/live/vmlinuz1", "/live/vmlinuz0"],
  ["/live/initrd1.img", "/live/initrd0.img"],
];

const PATCHES = new Map([
  [
    PI_UPSTREAM,
    {
      size: ISO_SIZE,
      sectors: [
        // isolinux/x86run.cfg — the entry archdetect picks here, so it also needs the non-PAE kernel.
        { offset: 110737 * 2048, length: 2048, patches: [CMDLINE, ...NON_PAE] },
        // isolinux/nopaerun.cfg — the menu for CPUs without PAE: the command line only.
        { offset: 110684 * 2048, length: 2048, patches: [CMDLINE] },
      ],
    },
  ],
]);

const ALLOWED_HOSTS = new Set([
  "downloads.raspberrypi.com",
  "dl-cdn.alpinelinux.org",
  "tinycorelinux.net",
  "www.tinycorelinux.net",
  "repo-default.voidlinux.org",
  "cdimage.debian.org",
  "saimei.ftp.acc.umu.se",
  "ftp.acc.umu.se",
  "mirror.archlinux32.org",
  "mirror.math.princeton.edu",
  "mirrors.slackware.com",
  "ftp.osuosl.org",
  "mxlinux.mirror.liquidtelecom.com",
  "mirror.it.ubc.ca",
  "distro.ibiblio.org",
]);

const PASSTHROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

function cors(response, request) {
  const headers = new Headers(response.headers);
  const asked = request && request.headers.get("Access-Control-Request-Headers");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  // v86's range reader sends X-Accept-Encoding besides Range; reflect whatever was asked for.
  headers.set("Access-Control-Allow-Headers", asked || "Range, X-Accept-Encoding, Content-Type");
  headers.set(
    "Access-Control-Expose-Headers",
    "Content-Range, Content-Length, Accept-Ranges, ETag, Content-Encoding",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

function plain(status, message) {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
  });
}

/** The upstream URL for this request, or a short reason why it will not be fetched. */
function targetFor(url) {
  if (url.pathname === "/iso") return { target: PI_UPSTREAM };
  if (url.pathname === "/img") {
    const raw = url.searchParams.get("u");
    if (!raw) return { error: "Missing ?u= — this endpoint needs the image URL to stream." };
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      return { error: "?u= is not a URL." };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { error: "Only http(s) images." };
    if (!ALLOWED_HOSTS.has(parsed.hostname)) return { error: `${parsed.hostname} is not on the image allowlist.` };
    return { target: parsed.href };
  }
  return { error: "Not found. Images are at /iso and /img?u=<url>." };
}

function parseRange(header, total) {
  const match = /^bytes=(\d+)-(\d*)$/.exec((header || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === "" ? total - 1 : Number(match[2]);
  if (!Number.isFinite(start) || start >= total) return null;
  return { start, end: Math.min(end, total - 1) };
}

/**
 * Rewrite one boot-config sector, or return null when none of these patches belongs in it.
 *
 * The sector is held as a string of one character per byte, so indexOf and slice do the searching: every
 * occurrence is replaced, which these menus need because each one lists two entries. A replacement at least
 * as long as the text it replaces takes the extra room from the sector's trailing padding and cuts the text
 * after it short by the same amount, so the sector stays exactly 2 KiB and the ISO9660 directory record and
 * the boot loader keep reading the same extent. (A shorter replacement is nobody's case: the kernel names are
 * the same length and the command line is longer.)
 */
function patchSector(bytes, patches) {
  const size = bytes.length;
  const original = String.fromCharCode(...bytes);
  let text = original;
  for (const [from, to] of patches) {
    const grow = to.length - from.length;
    for (let at = text.indexOf(from); at !== -1; at = text.indexOf(from, at + to.length)) {
      // Growth larger than the padding left would drop real text off the end, so it is not attempted.
      if (grow > size - text.replace(/[\x00 \n]+$/, "").length) break;
      text = text.slice(0, at) + to + text.slice(at + from.length, size - grow);
    }
  }
  return text === original ? null : Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const found = targetFor(url);
    if (!found.target) return plain(found.error.startsWith("Not found") ? 404 : 403, found.error);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request);
    if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "Only GET and HEAD.");

    const target = found.target;
    const entry = PATCHES.get(target);
    const rangeHeader = request.headers.get("range");
    const range = rangeHeader && entry ? parseRange(rangeHeader, entry.size) : null;

    // A ranged fetch sometimes comes back 200 (the whole file) even from a mirror that supports ranges:
    // Cloudflare's own cache answers first when it already holds the object. `cacheTtl: 0` skips that cache,
    // and a couple of attempts covers the cases where it does not. A 200 here is never usable — its body
    // starts at byte 0, not at the offset v86 asked for.
    let upstream = null;
    let lastError = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(target, {
          method: rangeHeader ? "GET" : "HEAD",
          headers: {
            ...(rangeHeader ? { Range: rangeHeader } : {}),
            // v86 slices these bytes; a compressed body cannot be sliced, so ask for identity.
            "Accept-Encoding": "identity",
            // Without a User-Agent several mirrors (Debian's, antiX's, Arch Linux 32's) answer a ranged GET
            // with the whole file instead of 206, which would make streaming impossible.
            "User-Agent": "v86-image-proxy/1.0 (+https://github.com/AstroBunnyStar/wispscope)",
            "Cache-Control": "no-cache",
          },
          redirect: "follow",
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (rangeHeader && response.status === 200) {
          lastError = "the mirror answered with the whole file";
          try { await response.body?.cancel(); } catch { /* nothing to drain */ }
          continue;
        }
        upstream = response;
        break;
      } catch (error) {
        lastError = (error && error.message) || String(error);
      }
    }

    if (!upstream) return plain(502, `The mirror could not be read: ${lastError}.`);
    if (!upstream.ok && upstream.status !== 206) {
      return plain(502, `The mirror answered ${upstream.status}${upstream.statusText ? ` ${upstream.statusText}` : ""}.`);
    }

    const headers = new Headers();
    for (const name of PASSTHROUGH) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    const sectors =
      entry && range
        ? entry.sectors.filter((sector) => range.start < sector.offset + sector.length && range.end >= sector.offset)
        : [];
    if (sectors.length) {
      const body = new Uint8Array(await upstream.arrayBuffer());
      for (const sector of sectors) {
        const from = sector.offset - range.start;
        // A read that starts past the sector's start still lands on it; anything that cuts the sector short
        // is left untouched rather than half-rewritten.
        if (from < 0 || from + sector.length > body.length) continue;
        const patched = patchSector(body.subarray(from, from + sector.length), sector.patches);
        if (patched) body.set(patched, from);
      }
      // The body is rewritten here, so the upstream's encoding and length no longer describe it.
      headers.delete("content-length");
      headers.delete("content-encoding");
      return cors(new Response(body, { status: upstream.status, headers }), request);
    }

    return cors(new Response(upstream.body, { status: upstream.status, headers }), request);
  },
};
