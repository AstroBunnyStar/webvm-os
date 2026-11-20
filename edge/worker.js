// Range proxy for the Raspberry Pi Desktop ISO.
const UPSTREAM =
  "https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso";
export const ISO_SIZE = 3607101440;

const PATCH_OFFSET = 110737 * 2048;
const PATCH_LENGTH = 2048;
const PATCH_FROM = new TextEncoder().encode("quiet splash plymouth.ignore-serial-consoles persistence");
const PATCH_TO = new TextEncoder().encode("console=tty1 xforcevesa nomodeset");
const PASSTHROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

function patchSector(bytes) {
  const patched = bytes.slice();
  outer: for (let i = 0; i <= patched.length - PATCH_FROM.length; i++) {
    for (let j = 0; j < PATCH_FROM.length; j++) {
      if (patched[i + j] !== PATCH_FROM[j]) continue outer;
    }
    patched.set(PATCH_TO, i);
    patched.fill(0x20, i + PATCH_TO.length, i + PATCH_FROM.length);
  }
  return patched;
}

function parseRange(header) {
  const match = /^bytes=(\d+)-(\d*)$/.exec((header || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] === "" ? ISO_SIZE - 1 : Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= ISO_SIZE || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, ISO_SIZE - 1) };
}

function cors(response, request) {
  const headers = new Headers(response.headers);
  const asked = request && request.headers.get("Access-Control-Request-Headers");
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  headers.set("Access-Control-Allow-Headers", asked || "Range, X-Accept-Encoding, Content-Type");
  headers.set("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, ETag, Content-Encoding");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/iso") {
      return new Response("Not found. The image is at /iso.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      return cors(new Response("Method not allowed\n", { status: 405 }), request);
    }
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request);

    const rangeHeader = request.headers.get("range");
    const range = rangeHeader ? parseRange(rangeHeader) : null;
    if (rangeHeader && !range) {
      return cors(new Response(null, { status: 416, headers: { "Content-Range": `bytes */${ISO_SIZE}` } }), request);
    }

    const upstream = await fetch(UPSTREAM, {
      method: rangeHeader && request.method === "GET" ? "GET" : "HEAD",
      headers: rangeHeader ? { Range: rangeHeader } : {},
      redirect: "follow",
    });

    const headers = new Headers();
    for (const name of PASSTHROUGH) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("Cache-Control", "public, max-age=31536000, immutable");

    const touchesSector = range && range.start < PATCH_OFFSET + PATCH_LENGTH && range.end >= PATCH_OFFSET;
    if (touchesSector) {
      const body = new Uint8Array(await upstream.arrayBuffer());
      const offset = PATCH_OFFSET - range.start;
      if (offset >= 0 && offset + PATCH_LENGTH <= body.length) {
        body.set(patchSector(body.slice(offset, offset + PATCH_LENGTH)), offset);
      }
      headers.delete("content-length");
      headers.delete("content-encoding");
      return cors(new Response(body, { status: upstream.status, headers }), request);
    }
    return cors(new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers }), request);
  },
};
