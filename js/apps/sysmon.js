// System monitor: machine state, memory, uptime and emulated CPU throughput.
export const sysmonApp = {
  id: "sysmon",
  title: "System Monitor",
  icon: "📊",
  width: 620,
  height: 500,

  mount(api) {
    const { vm } = api;
    const root = document.createElement("div");
    root.className = "mon";
    root.innerHTML = `
      <div class="mon-grid">
        <div class="mon-card"><div class="k">State</div><div class="v" data-el="state">starting</div><div class="u" data-el="state-sub">no machine yet</div></div>
        <div class="mon-card"><div class="k">Uptime</div><div class="v" data-el="uptime">0:00</div><div class="u">since boot</div></div>
        <div class="mon-card"><div class="k">Guest RAM</div><div class="v" data-el="mem">512 MB</div><div class="u">allocated to the VM</div></div>
        <div class="mon-card"><div class="k">Throughput</div><div class="v" data-el="mips">0</div><div class="u">million instr / s</div></div>
      </div>
      <canvas class="mon-chart" width="560" height="120" data-el="chart"></canvas>
      <div class="dl-list" data-el="log"></div>`;

    const state = root.querySelector('[data-el="state"]');
    const stateSub = root.querySelector('[data-el="state-sub"]');
    const uptime = root.querySelector('[data-el="uptime"]');
    const mem = root.querySelector('[data-el="mem"]');
    const mips = root.querySelector('[data-el="mips"]');
    const chart = root.querySelector('[data-el="chart"]');
    const log = root.querySelector('[data-el="log"]');

    const started = Date.now();
    const samples = new Array(60).fill(0);
    let lastInstr = null;
    let lastAt = Date.now();

    const events = [];
    const renderLog = () => {
      log.innerHTML = "";
      for (const line of events.slice(-6).reverse()) {
        const row = document.createElement("div");
        row.className = "dl-item";
        row.innerHTML = `<span class="name"></span><span class="size"></span>`;
        row.querySelector(".name").textContent = line.text;
        row.querySelector(".size").textContent = line.at;
        log.appendChild(row);
      }
    };

    vm.on((ev) => {
      if (ev.type === "phase" || ev.type === "error") {
        events.push({ text: `machine: ${vm.phase}`, at: new Date().toLocaleTimeString() });
        renderLog();
        tick();
      }
    });

    const drawChart = () => {
      const ctx = chart.getContext("2d");
      const w = chart.width;
      const h = chart.height;
      ctx.clearRect(0, 0, w, h);
      const max = Math.max(10, ...samples);
      const step = w / (samples.length - 1);
      ctx.beginPath();
      samples.forEach((v, i) => {
        const x = i * step;
        const y = h - (v / max) * (h - 10) - 5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = "#e95420";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fillStyle = "rgba(233,84,32,0.14)";
      ctx.fill();
    };

    const tick = () => {
      const now = Date.now();
      state.textContent = vm.phase;
      stateSub.textContent = vm.running ? "guest executing" : "machine is not running";
      const secs = Math.floor((now - started) / 1000);
      uptime.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      mem.textContent = `${api.settings.memoryMB} MB`;

      const emu = vm.emulator;
      if (emu) {
        const instr = emu.get_instruction_counter();
        if (lastInstr !== null) {
          const dt = Math.max(0.25, (now - lastAt) / 1000);
          const rate = (instr - lastInstr) / dt / 1e6;
          samples.push(Math.max(0, rate));
          samples.shift();
          mips.textContent = rate.toFixed(0);
          drawChart();
        }
        lastInstr = instr;
      } else {
        mips.textContent = "0";
      }
      lastAt = now;
    };

    tick();
    renderLog();
    drawChart();
    const timer = setInterval(tick, 1000);
    api.win.onClose = () => clearInterval(timer);

    api.win.body.appendChild(root);
  },
};
