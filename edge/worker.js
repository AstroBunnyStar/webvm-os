// Range proxy for the Raspberry Pi Desktop ISO.
const UPSTREAM =
  "https://downloads.raspberrypi.com/rpd_x86/images/rpd_x86-2022-07-04/2022-07-01-raspios-bullseye-i386.iso";
export const ISO_SIZE = 3607101440;

const PATCH_OFFSET = 110737 * 2048;
const PATCH_LENGTH = 2048;
const PATCH_FROM = "quiet splash plymouth.ignore-serial-consoles persistence";
const PATCH_TO = "console=tty1 xforcevesa nomodeset";

const PASSTHROUGH = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

function patchSector(bytes) {
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.includes(PATCH_FROM)) return bytes;
  const patched = text.split(PATCH_FROM).join(PATCH_TO.padEnd(PATCH_FROM.length, " "));
  return new TextEncoder().encode(patched);
}

function parseRange(header) {
  const match = /^bytes=(\d+)-(\d*)$/.exec((header || "").trim());
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === "" ? ISO_SIZE - 1 : Number(match[2]);
  return { start, end: Math.min(end, ISO_SIZE - 1) };
}

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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/iso") {
      return new Response("Not found. The image is at /iso.\n", {
        status: 404,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), request);

    const rangeHeader = request.headers.get("range");
    const range = parseRange(rangeHeader);
    const upstream = await fetch(UPSTREAM, {
      method: rangeHeader ? "GET" : "HEAD",
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
      const from = PATCH_OFFSET - range.start;
      if (from >= 0 && from + PATCH_LENGTH <= body.length) {
        body.set(patchSector(body.slice(from, from + PATCH_LENGTH)), from);
      }
      // The body is already decoded here, so the upstream's encoding and length no longer describe it.
      headers.delete("content-length");
      headers.delete("content-encoding");
      return cors(new Response(body, { status: upstream.status, headers }), request);
    }

    return cors(new Response(upstream.body, { status: upstream.status, headers }), request);
  },
};
