// Calculator with a small expression evaluator (no eval()).
const KEYS = [
  ["C", "⌫", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ".", "±", "="],
];

const PREC = { "+": 1, "−": 1, "×": 2, "÷": 2, "%": 2 };

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === " ") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let n = c;
      i++;
      while (i < expr.length && /[0-9.]/.test(expr[i])) { n += expr[i]; i++; }
      const value = Number(n);
      if (Number.isNaN(value)) throw new Error("bad number");
      tokens.push({ type: "num", value });
      continue;
    }
    if (c === "(" || c === ")") { tokens.push({ type: c }); i++; continue; }
    if (c in PREC) {
      const prev = tokens[tokens.length - 1];
      const unary = c === "−" && (!prev || prev.type === "op" || prev.type === "(");
      if (unary) { tokens.push({ type: "num", value: -1 }); tokens.push({ type: "op", op: "×" }); i++; continue; }
      tokens.push({ type: "op", op: c });
      i++;
      continue;
    }
    throw new Error(`unexpected "${c}"`);
  }
  return tokens;
}

function evaluate(expr) {
  const tokens = tokenize(expr);
  const output = [];
  const ops = [];
  for (const t of tokens) {
    if (t.type === "num") output.push(t.value);
    else if (t.type === "op") {
      while (ops.length && ops[ops.length - 1] !== "(" && PREC[ops[ops.length - 1]] >= PREC[t.op]) {
        output.push(ops.pop());
      }
      ops.push(t.op);
    } else if (t.type === "(") ops.push("(");
    else {
      while (ops.length && ops[ops.length - 1] !== "(") output.push(ops.pop());
      if (!ops.length) throw new Error("unbalanced )");
      ops.pop();
    }
  }
  while (ops.length) {
    const op = ops.pop();
    if (op === "(") throw new Error("unbalanced (");
    output.push(op);
  }
  const stack = [];
  for (const t of output) {
    if (typeof t === "number") { stack.push(t); continue; }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error("bad expression");
    if (t === "+") stack.push(a + b);
    else if (t === "−") stack.push(a - b);
    else if (t === "×") stack.push(a * b);
    else if (t === "÷") { if (b === 0) throw new Error("division by zero"); stack.push(a / b); }
    else if (t === "%") stack.push(a % b);
  }
  if (stack.length !== 1) throw new Error("bad expression");
  return stack[0];
}

const fmt = (n) => {
  if (!Number.isFinite(n)) return "Error";
  const rounded = Math.round(n * 1e10) / 1e10;
  return String(rounded);
};

export const calculatorApp = {
  id: "calculator",
  title: "Calculator",
  icon: "🧮",
  width: 380,
  height: 520,

  mount(api) {
    const root = document.createElement("div");
    root.className = "calc";
    root.innerHTML = `
      <div class="calc-display" data-el="display">0</div>
      <div class="calc-expr" data-el="expr"></div>
      <div class="calc-keys">
        ${KEYS.flat().map((k) => {
          const cls = k === "=" ? "eq" : ["+", "−", "×", "÷", "%"].includes(k) ? "op" : ["C", "⌫", "±"].includes(k) ? "fn" : "";
          return `<button class="calc-key ${cls}" data-key="${k}">${k}</button>`;
        }).join("")}
      </div>`;

    const display = root.querySelector('[data-el="display"]');
    const exprEl = root.querySelector('[data-el="expr"]');
    let expr = "";
    let justEvaluated = false;

    const paint = () => {
      display.textContent = expr || "0";
      exprEl.textContent = "";
      try {
        if (/[+−×÷%]/.test(expr)) exprEl.textContent = `= ${fmt(evaluate(expr))}`;
      } catch { /* incomplete expression */ }
    };

    const press = (key) => {
      if (key === "C") { expr = ""; justEvaluated = false; paint(); return; }
      if (key === "⌫") { expr = expr.slice(0, -1); paint(); return; }
      if (key === "±") {
        expr = expr.startsWith("−") ? expr.slice(1) : `−${expr}`;
        paint();
        return;
      }
      if (key === "=") {
        try {
          const value = fmt(evaluate(expr));
          expr = value;
          justEvaluated = true;
          display.textContent = value;
          exprEl.textContent = "";
        } catch (err) {
          display.textContent = "Error";
          exprEl.textContent = err.message;
        }
        return;
      }
      if (justEvaluated && /[0-9.]/.test(key)) { expr = ""; }
      justEvaluated = false;
      expr += key;
      paint();
    };

    root.querySelectorAll(".calc-key").forEach((btn) => {
      btn.addEventListener("click", () => press(btn.dataset.key));
    });

    const onKey = (e) => {
      const map = { "/": "÷", "*": "×", "-": "−", "+": "+", Enter: "=", "=": "=", Backspace: "⌫", Escape: "C", "%": "%" };
      if (/^[0-9.]$/.test(e.key)) { press(e.key); e.preventDefault(); return; }
      if (map[e.key]) { press(map[e.key]); e.preventDefault(); }
    };
    root.tabIndex = 0;
    root.addEventListener("keydown", onKey);
    setTimeout(() => root.focus(), 50);

    paint();
    api.win.body.appendChild(root);
  },
};
