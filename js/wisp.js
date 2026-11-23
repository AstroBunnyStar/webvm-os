// WispScope, built in: the verified public relay list, a browser-side latency check that speaks the
// Wisp handshake, and an image transport that reads the ISO through a relay.
//
// Relay data comes from https://github.com/AstroBunnyStar/wispscope (wisp-relays/independent-57.txt):
// 57 endpoints that passed a real Wisp handshake followed by an HTTP response through a CONNECT.
//
// Wisp carries raw TCP, so TLS is what keeps a relay honest: libcurl.js (libcurl compiled to WASM,
// shipped in vm/) terminates TLS inside this tab, and the relay only ever sees an encrypted stream to
// the image proxy. That is also why this path works on a network that blocks the image host's name.

export const WISP_RELAYS = [
  "wss://myproxy-zeta.vercel.app/wisp/",
  "wss://motor-cycle-part.org/wisp/",
  "wss://bare-server.fly.dev/wisp/",
  "wss://fern.best/wisp/",
  "wss://vibeos.sh/api/wisp/",
  "wss://wisp.anjomous.workers.dev/",
  "wss://orbitweb.org/campus/",
  "wss://wisp.terbiumon.top/wisp/",
  "wss://invisiproxy.com/wisp/",
  "wss://definitelyscience.com/wisp/",
  "wss://lichology.com/wisp/",
  "wss://dkwmkvruzebnqlmvwzhy.supabase.co/functions/v1/proxy-wisp/",
  "wss://mages.io/wisp/",
  "wss://gointospace.app/wisp/",
  "wss://zakaon.top/wisp/",
  "wss://vela-wisp.onrender.com/",
  "wss://shasta-dtg.pages.dev/wisp/",
  "wss://tinf0il.site/wisp/",
  "wss://yashsurjuse-wisp.hf.space/",
  "wss://hurt-agata-liventcord-api-7072e9a6.koyeb.app/wisp/",
  "wss://purnhab68-gitea.hf.space/",
  "wss://wisp.freewisp.org/",
  "wss://wisp.webmc.xyz/",
  "wss://wisp.mercurywork.shop/",
  "wss://anura.pro/",
  "wss://holywisp.fracit.al/",
  "wss://browserjs-production.up.railway.app/wisp/",
  "wss://arsenic.smartfoloo.space/wisp/",
  "wss://chat.smartfoloo.space/wisp/",
  "wss://tokyo.new-updates.info/wisp/",
  "wss://mex-ubg-wisp.onrender.com/wisp/",
  "wss://truffled.lol/wisp/",
  "wss://daydreamx.pro/wisp/",
  "wss://studyworkandmore.uk/wisp/",
  "wss://xh4r26oz8gg460od.oid76seqraqkbvwx.mvd.hi.stack.ddnsfree.com/wisp/",
  "wss://civil.quartinal.me/wisp/",
  "wss://petezahgames.com/wisp/",
  "wss://15.204.116.230.sslip.io/wisp/",
  "wss://achromaon.top/wisp/",
  "wss://edushasta.lol/wisp/",
  "wss://aetheris.win/wisp/",
  "wss://us-east.wisp.q13x.com/",
  "wss://se-asia.wisp.q13x.com/",
  "wss://mci-wisp-node.sparkpowered.org/",
  "wss://nrt-wisp-node.sparkpowered.org/",
  "wss://fra-wisp-node.sparkpowered.org/",
  "wss://sin-wisp-node.sparkpowered.org/",
  "wss://linuxontab-net.fly.dev/wisp",
  "wss://zodiac.icu/wisp/",
  "wss://lunaar.org/wisp/",
  "wss://admin.proxy.hydrovolter.com/wisp/",
  "wss://speedster.heavengtwashere.workers.dev/wisp/",
  "wss://app-dry-waterfall-5636.fly.dev/wisp/",
  "wss://superuser-wisp.wasmer.app/wisp/",
  "wss://symbolic-jocelyne-jxo-prod-c0e42749.apps.mistral.run/",
  "wss://ns514995.ip-167-114-208.net/api",
  "wss://pgis-wisp.getvoroa.com/",
];

// Picked by scanning the list from this page; the relay dialog can replace it at any time.
export const DEFAULT_RELAY = "wss://wisp.mercurywork.shop/";

/** libcurl.js insists on a trailing slash; the scanner's list does not always have one. */
export function normalizeRelay(url) {
  const trimmed = String(url || "").trim();
  if (!/^wss?:\/\/\S+$/i.test(trimmed)) return "";
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

/* ---------- Wisp protocol ---------- */

const TYPE_CONNECT = 1;
const TYPE_CONTINUE = 3;
const TYPE_CLOSE = 4;
const TYPE_INFO = 5;

function frame(type, id, payload = new Uint8Array(0)) {
  const out = new Uint8Array(5 + payload.length);
  out[0] = type;
  new DataView(out.buffer).setUint32(1, id >>> 0, true);
  out.set(payload, 5);
  return out;
}

/** CONNECT: stream type 1 (TCP), port, hostname — the v2 layout every relay in the list speaks. */
function connectFrame(id, host, port) {
  const name = new TextEncoder().encode(host);
  const payload = new Uint8Array(3 + name.length);
  payload[0] = 1;
  new DataView(payload.buffer).setUint16(1, port, true);
  payload.set(name, 3);
  return frame(TYPE_CONNECT, id, payload);
}

function readFrame(data) {
  const bytes = new Uint8Array(data);
  if (bytes.length < 5) return null;
  return {
    type: bytes[0],
    id: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1, true),
    payload: bytes.subarray(5),
  };
}

/**
 * Open a relay, finish the Wisp handshake, and CONNECT to `host:port`. Resolves with how long the relay
 * took to answer for that destination — the same test WispScope runs, pointed at the image proxy, so a
 * green relay is one that can actually serve this machine's image.
 */
export function scanRelay(url, { host, port = 443, timeoutMs = 9000 } = {}) {
  const relay = normalizeRelay(url);
  return new Promise((resolve) => {
    const started = performance.now();
    let socket = null;
    let done = false;
    let stage = "socket";
    let infoSent = false;

    const finish = (ok, note) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { socket && socket.close(); } catch { /* already closed */ }
      resolve({ url: relay || url, ok, note, ms: Math.round(performance.now() - started) });
    };
    const timer = setTimeout(() => finish(false, `timeout:${stage}`), timeoutMs);

    if (!relay) return finish(false, "bad-url");
    try {
      socket = new WebSocket(relay);
    } catch {
      return finish(false, "bad-url");
    }
    socket.binaryType = "arraybuffer";
    socket.onopen = () => { stage = "handshake"; };
    socket.onerror = () => finish(false, "refused");
    socket.onclose = (event) => { if (!done) finish(false, `closed:${event.code}`); };

    const connect = () => {
      stage = "connect";
      socket.send(connectFrame(1, host, port));
    };

    socket.onmessage = (event) => {
      const packet = readFrame(event.data);
      if (!packet) return finish(false, "bad-frame");
      if (packet.type === TYPE_INFO) {
        if (!infoSent) {
          infoSent = true;
          socket.send(frame(TYPE_INFO, 0, new Uint8Array([2, 1])));
        }
        return;
      }
      if (packet.type === TYPE_CONTINUE) {
        if (packet.id === 0 && (stage === "handshake" || stage === "info")) {
          stage = "info";
          connect();
        } else if (packet.id === 1) {
          finish(true, "connected");
        }
        return;
      }
      if (packet.type === TYPE_CLOSE) {
        finish(false, `refused:${packet.payload[0] ?? "?"}`);
      }
    };
  });
}

/** Scan many relays a few at a time; `onResult` fires as each one settles. */
export async function scanRelays(relays, options, onResult, concurrency = 6) {
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < relays.length) {
      const url = relays[next++];
      const result = await scanRelay(url, options);
      results.push(result);
      if (onResult) onResult(result);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, relays.length) }, worker));
  return results;
}

/* ---------- libcurl.js ---------- */

let loader = null;

/** vm/libcurl.js is a classic script that declares `libcurl` with const: a global binding, not window.libcurl. */
function libcurlApi() {
  if (window.libcurl) return window.libcurl;
  return typeof libcurl !== "undefined" ? libcurl : null;
}

/** Load the WASM libcurl client once, on demand: a visitor who never starts costs nothing. */
export function loadLibcurl({ script = "vm/libcurl.js", wasm = "vm/libcurl.wasm" } = {}) {
  const loaded = libcurlApi();
  if (loaded && loaded.ready) return Promise.resolve(loaded);
  if (loader) return loader;
  loader = new Promise((resolve, reject) => {
    const boot = () => {
      const api = libcurlApi();
      if (!api) return reject(new Error("libcurl.js did not initialise"));
      if (api.ready) return resolve(api);
      api.load_wasm(wasm).then(() => resolve(api), reject);
    };
    if (libcurlApi()) return boot();
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    element.onload = boot;
    element.onerror = () => reject(new Error("libcurl.js could not be loaded"));
    document.head.appendChild(element);
  });
  loader.catch(() => { loader = null; });
  return loader;
}

async function responseBytes(response) {
  if (typeof response.arrayBuffer === "function") return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ---------- image transport ---------- */

/**
 * Reads byte ranges of the image over a Wisp relay and stands in for `XMLHttpRequest`, which is how v86
 * fetches a ranged CD image. Only the image URL is routed; everything else (BIOS, WASM, the guest's own
 * network relay) goes straight through the browser. A relay that fails mid-boot does not stop the
 * machine: that read, and the ones after it, fall back to the direct connection.
 */
export class RelayImage {
  constructor({ url, relay, onEvent } = {}) {
    this.url = String(url || "");
    this.relay = normalizeRelay(relay);
    this.onEvent = onEvent || (() => {});
    this.requests = 0;
    this.bytes = 0;
    this.fallbacks = 0;
    this.fellBack = false;
    this.native = null;
    this.installed = false;
  }

  get active() {
    return this.installed && !this.fellBack;
  }

  route(url) {
    return this.active && this.relay !== "" && String(url) === this.url;
  }

  /** One ranged GET through the relay, TLS terminated in the browser by libcurl. */
  async read(start, end, signal) {
    const libcurl = await loadLibcurl();
    libcurl.set_websocket(this.relay);
    const response = await libcurl.fetch(this.url, {
      headers: { Range: `bytes=${start}-${end}` },
      signal,
    });
    if (response.status !== 200 && response.status !== 206) {
      throw new Error(`the relay answered HTTP ${response.status}`);
    }
    const bytes = await responseBytes(response);
    if (!bytes.length) throw new Error("the relay returned an empty range");
    this.bytes += bytes.length;
    return bytes;
  }

  /** Read the first sector through the relay before the machine starts, so a dead relay fails loudly. */
  async check() {
    const bytes = await this.read(0, 2047);
    if (bytes.length !== 2048) throw new Error(`the relay returned ${bytes.length} of 2048 bytes`);
    return bytes;
  }

  noteFallback(error) {
    this.fallbacks += 1;
    if (!this.fellBack) {
      this.fellBack = true;
      this.onEvent({
        type: "transport",
        mode: "direct",
        error: (error && error.message) || String(error),
      });
    }
  }

  install() {
    if (this.installed) return;
    this.native = window.XMLHttpRequest;
    const transport = this;
    const Native = this.native;

    class RoutedXHR {
      constructor() {
        this.responseType = "";
        this.response = null;
        this.status = 0;
        this.statusText = "";
        this.readyState = 0;
        this.onload = null;
        this.onerror = null;
        this.onprogress = null;
        this.onreadystatechange = null;
        this.ontimeout = null;
        this.headers = {};
        this.url = "";
        this.method = "GET";
        this.nativeRequest = null;
        this.aborted = false;
      }

      open(method, url) {
        this.method = method || "GET";
        this.url = url;
        this.readyState = 1;
      }

      setRequestHeader(name, value) {
        this.headers[name] = value;
      }

      getResponseHeader() { return null; }

      getAllResponseHeaders() { return ""; }

      addEventListener() {}

      removeEventListener() {}

      abort() {
        this.aborted = true;
        if (this.nativeRequest) this.nativeRequest.abort();
      }

      send() {
        if (!transport.route(this.url)) return this.direct();
        transport.requests += 1;
        transport
          .read(...rangeOf(this), undefined)
          .then((bytes) => {
            if (this.aborted) return;
            const exact = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            this.status = 206;
            this.statusText = "Partial Content";
            this.response = this.responseType === "arraybuffer" ? exact : exact;
            this.readyState = 4;
            if (this.onprogress) this.onprogress({ loaded: bytes.length, total: bytes.length, target: this });
            if (this.onload) this.onload({ type: "load", target: this });
            if (this.onreadystatechange) this.onreadystatechange({ target: this });
          })
          .catch((error) => {
            if (this.aborted) return;
            transport.noteFallback(error);
            this.direct();
          });
      }

      /** The untouched browser request: used for every other URL, and when the relay gives up. */
      direct() {
        const request = new Native();
        this.nativeRequest = request;
        request.open(this.method, this.url, true);
        if (this.responseType) request.responseType = this.responseType;
        for (const name of Object.keys(this.headers)) request.setRequestHeader(name, this.headers[name]);
        request.onload = () => {
          this.status = request.status;
          this.statusText = request.statusText;
          this.response = request.response;
          this.readyState = 4;
          if (this.onprogress) this.onprogress({ target: this });
          if (this.onload) this.onload({ type: "load", target: this });
          if (this.onreadystatechange) this.onreadystatechange({ target: this });
        };
        request.onerror = () => {
          this.status = 0;
          if (this.onerror) this.onerror({ type: "error", target: this });
          if (this.onreadystatechange) this.onreadystatechange({ target: this });
        };
        request.send();
      }
    }

    window.XMLHttpRequest = RoutedXHR;
    this.installed = true;
  }

  uninstall() {
    if (!this.installed) return;
    if (this.native) window.XMLHttpRequest = this.native;
    this.installed = false;
    this.native = null;
  }
}

/** v86 sends `Range: bytes=start-end`; anything else is treated as a whole-file read of one chunk. */
function rangeOf(request) {
  const header = request.headers.Range || request.headers.range || "";
  const match = /bytes=(\d+)-(\d*)/.exec(header);
  if (!match) return [0, 0];
  const start = Number(match[1]);
  const end = match[2] === "" ? start : Number(match[2]);
  return [start, Math.max(start, end)];
}
