// Python 3 in the browser (CPython compiled to WebAssembly via Pyodide).
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";

const EXAMPLES = {
  hello: `import sys, platform
print("Python", platform.python_version(), "on", platform.machine())
print("Interpreter:", sys.implementation.name)
for i in range(1, 6):
    print("square of", i, "is", i * i)
`,
  math: `# Standard library only — no install needed
import math, statistics, random
data = [random.gauss(100, 15) for _ in range(200)]
print("mean  ", round(statistics.mean(data), 2))
print("median", round(statistics.median(data), 2))
print("sigma ", round(statistics.pstdev(data), 2))
print("sin(pi/6) =", math.sin(math.pi / 6))
`,
  files: `# Python here has an in-memory filesystem
with open("notes.txt", "w") as f:
    f.write("hello from WebVM\\nsecond line\\n")

with open("notes.txt") as f:
    for n, line in enumerate(f, 1):
        print(n, line.rstrip())

import os
print("files:", os.listdir("."))
`,
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

async function ensurePyodide(log) {
  if (window.__webvmPyodide) return window.__webvmPyodide;
  if (!window.loadPyodide) {
    log(`Loading the Python runtime from the CDN (${PYODIDE_BASE})…`, "sys");
    await loadScript(`${PYODIDE_BASE}pyodide.js`);
  }
  const py = await window.loadPyodide({ indexURL: PYODIDE_BASE });
  py.setStdout({ batched: (text) => log(text, "out") });
  py.setStderr({ batched: (text) => log(text, "err") });
  window.__webvmPyodide = py;
  log(`Python ${py.version} ready.`, "sys");
  return py;
}

export const pythonApp = {
  id: "python",
  title: "Python 3",
  icon: "🐍",
  width: 760,
  height: 560,

  mount(api) {
    const root = document.createElement("div");
    root.className = "py-wrap";
    root.innerHTML = `
      <div class="py-bar">
        <button class="btn primary sm" data-act="run">▶ Run</button>
        <span class="hint">Ctrl</span><span class="hint">+</span><span class="hint">Enter</span>
        <span class="spacer" style="flex:1"></span>
        <select data-act="example" class="btn sm" style="height:26px">
          <option value="">Examples…</option>
          <option value="hello">Hello, interpreter</option>
          <option value="math">Statistics &amp; math</option>
          <option value="files">Files &amp; os</option>
        </select>
        <button class="btn sm" data-act="clear">Clear output</button>
      </div>
      <div class="py-editor"><textarea spellcheck="false" data-el="code"></textarea></div>
      <div class="py-out" data-el="out"></div>
      <div class="py-bar">
        <input type="text" data-el="pkg" placeholder="package name, e.g. requests" style="flex:1;height:30px" />
        <button class="btn sm" data-act="pip">pip install</button>
      </div>`;

    const code = root.querySelector('[data-el="code"]');
    const out = root.querySelector('[data-el="out"]');
    const pkg = root.querySelector('[data-el="pkg"]');

    const log = (text, kind = "out") => {
      const span = document.createElement("span");
      span.className = kind;
      span.textContent = text + "\n";
      out.appendChild(span);
      out.scrollTop = out.scrollHeight;
    };

    code.value = EXAMPLES.hello;

    let busy = false;
    const run = async () => {
      if (busy) return;
      const source = code.value.trim();
      if (!source) return;
      busy = true;
      log(`>>> (${source.split("\n").length} lines)`, "sys");
      try {
        const py = await ensurePyodide(log);
        const result = await py.runPythonAsync(source);
        if (result !== undefined && result !== null) log(String(result), "out");
      } catch (err) {
        log(String(err && err.message ? err.message : err), "err");
      } finally {
        busy = false;
      }
    };

    root.querySelector('[data-act="run"]').addEventListener("click", run);
    root.querySelector('[data-act="clear"]').addEventListener("click", () => { out.textContent = ""; });
    root.querySelector('[data-act="example"]').addEventListener("change", (e) => {
      if (EXAMPLES[e.target.value]) code.value = EXAMPLES[e.target.value];
      e.target.value = "";
      code.focus();
    });
    root.querySelector('[data-act="pip"]').addEventListener("click", async () => {
      const name = pkg.value.trim();
      if (!name) return;
      log(`>>> pip install ${name}`, "sys");
      try {
        const py = await ensurePyodide(log);
        await py.loadPackage("micropip");
        const micropip = py.pyimport("micropip");
        await micropip.install(name);
        log(`installed ${name}`, "sys");
      } catch (err) {
        log(String(err && err.message ? err.message : err), "err");
      }
    });
    code.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
      if (e.key === "Tab") {
        e.preventDefault();
        const { selectionStart: s, selectionEnd: en } = code;
        code.value = `${code.value.slice(0, s)}    ${code.value.slice(en)}`;
        code.selectionStart = code.selectionEnd = s + 4;
      }
    });

    log("Python 3 runs locally in this browser tab (CPython on WebAssembly).", "sys");
    log("The first Run downloads the interpreter (~10 MB). pip works for pure-Python packages.", "sys");
    log("For the Linux guest, install Python 3 with: apk add python3", "sys");

    api.win.body.style.overflow = "hidden";
    api.win.body.appendChild(root);
    lintResize(api, root);
  },
};

// Keep the editor/output split sensible when the window is resized.
function lintResize(api, root) {
  api.win.onResize = () => {
    root.querySelector(".py-editor").style.flex = "1";
  };
}
