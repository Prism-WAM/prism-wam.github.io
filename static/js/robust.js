/* PrismWAM — Robustness (#robust).
   One level control (Clean depth, Level 1–3) drives three views: the observed depth panel (crossfade), the corruption
   recipe and the success chart. Every number is the paper's (depth-corruption appendix: settings table and results).
   On first view the control steps once through the levels and stops on Level 3 (under 5 s); never with reduced motion,
   and the reader's first click, key press or focus on the control ends it. Only opacity / colour / transform change, so nothing reflows. */
(function () {
  "use strict";
  const P = window.PRISM;
  const root = document.getElementById("robust");
  if (!P || !root) return;
  const { $, $$, svg } = P;

  // RoboTwin C2R success (%), 50 tasks × 20 episodes per scene; each setting is its own trained model
  const LV = [
    { name: "Clean depth", short: "Clean", clean: 87.40, rand: 54.10, mean: 70.75, sigma: [0, 0], shift: 0, radius: 0, frac: 0, patch: 0 },
    { name: "Level 1", short: "Level 1", clean: 89.80, rand: 52.70, mean: 71.25, sigma: [12, 20], shift: 0, radius: 1, frac: 25, patch: 0 },
    { name: "Level 2", short: "Level 2", clean: 87.60, rand: 53.20, mean: 70.40, sigma: [24, 40], shift: 25, radius: 5, frac: 25, patch: 1.5 },
    { name: "Level 3", short: "Level 3", clean: 86.50, rand: 50.10, mean: 68.30, sigma: [36, 60], shift: 50, radius: 7, frac: 24, patch: 1.5 },
  ];
  // recipe rows: shown value, and the amount that fills the meter (as a share of the table's largest setting)
  const ROW = {
    sigma: { text: (l) => `${l.sigma[0]} / ${l.sigma[1]} mm`, amt: (l) => l.sigma[1], max: 60 },
    shift: { text: (l) => (l.shift ? `±${l.shift} mm` : "0 mm"), amt: (l) => l.shift, max: 50 },
    radius: { text: (l) => (l.radius ? `${l.radius} px` : "–"), amt: (l) => l.radius, max: 7 },
    frac: { text: (l) => `${l.frac}%`, amt: (l) => l.frac, max: 25 },
    patch: { text: (l) => `${l.patch}%`, amt: (l) => l.patch, max: 1.5 },
  };
  const SERIES = [   // drawn bottom-up, so the average sits on top
    { k: "rand", cls: "s-rand" },
    { k: "clean", cls: "s-clean" },
    { k: "mean", cls: "s-mean" },
  ];
  const f2 = (v) => v.toFixed(2);

  const seg = $("#rb-seg", root), grid = $("#rb-panel", root), box = $("#rb-chart", root);
  if (!seg || !grid || !box) return;
  const btns = $$('[role="tab"]', seg);
  const imgs = $$(".rb-img", root);
  const rows = $$(".rb-row", root);
  const sumN = $(".rb-sum-n", root), sumLv = $(".rb-sum-lv", root), delta = $(".rb-delta", root);
  const miniN = $(".rb-mini-n", root), miniD = $(".rb-mini-d", root);   // narrow screens: copy beside the sticky control

  let cur = btns.findIndex((b) => b.getAttribute("aria-selected") === "true");
  if (cur < 0) cur = LV.length - 1;
  let prevTimer = 0;
  let chart = null;        // { band, cols, cw } from the last draw
  let stopAuto = () => {};

  /* ───────── selection ───────── */
  function select(i) {
    if (i === cur || i < 0 || i >= LV.length) return;
    const prev = cur;
    cur = i;
    const L = LV[i];
    btns.forEach((b, k) => { b.setAttribute("aria-selected", String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    grid.setAttribute("aria-labelledby", btns[i].id);
    grid.dataset.lv = String(i);

    // depth panel: the new observation fades in over the previous one, which stays opaque underneath until it is covered
    clearTimeout(prevTimer);
    imgs.forEach((im, k) => {
      im.classList.toggle("is-on", k === i);
      im.classList.toggle("is-prev", k === prev);
      if (k === i) im.removeAttribute("aria-hidden"); else im.setAttribute("aria-hidden", "true");
    });
    prevTimer = setTimeout(() => imgs.forEach((im) => im.classList.remove("is-prev")), 520);

    paintRecipe(L);
    paintSummary(i);
    paintChart();
  }

  function paintRecipe(L) {
    rows.forEach((r) => {
      const d = ROW[r.dataset.p];
      if (!d) return;
      const a = d.amt(L);
      $(".rb-v", r).textContent = d.text(L);
      r.style.setProperty("--f", String(Math.round((a / d.max) * 1000) / 1000));
      r.classList.toggle("is-off", !a);
    });
  }

  function paintSummary(i) {
    const L = LV[i];
    sumN.textContent = f2(L.mean);
    sumLv.textContent = L.name;
    if (miniN) miniN.textContent = f2(L.mean) + "%";
    if (i === 0) { delta.textContent = "Reference"; if (miniD) miniD.textContent = ""; return; }
    const d = Math.round(L.mean * 100) - Math.round(LV[0].mean * 100);   // hundredths, no float drift
    const ds = `${d >= 0 ? "+" : "−"}${(Math.abs(d) / 100).toFixed(2)}`;
    delta.textContent = `${ds} points vs clean depth`;
    if (miniD) miniD.textContent = `${ds} vs clean depth`;
  }

  /* ───────── chart: success across the four settings ───────── */
  const Y0 = 40, Y1 = 100, TICKS = [40, 60, 80, 100];
  function draw() {
    const w = Math.round(box.clientWidth), h = Math.round(box.clientHeight);
    if (!w || !h) return;
    box.textContent = "";
    const s = svg("svg", { viewBox: `0 0 ${w} ${h}`, width: w, height: h, focusable: "false" }, box);
    const m = { l: 36, r: 2, t: 16, b: 30 };   // l: room for "100%", so the tick labels start at the card's content edge
    const pw = w - m.l - m.r, ph = h - m.t - m.b;
    const cw = pw / LV.length;
    const x = (i) => m.l + (i + 0.5) * cw;
    const y = (v) => m.t + (1 - (v - Y0) / (Y1 - Y0)) * ph;
    const inset = Math.min(6, cw * 0.06);

    // gridlines + y ticks
    const gg = svg("g", {}, s);
    TICKS.forEach((v) => {
      const yy = Math.round(y(v)) + 0.5;
      svg("line", { class: "rb-gl", x1: m.l, x2: w - m.r, y1: yy, y2: yy }, gg);
      svg("text", { class: "rb-yt", x: m.l - 8, y: yy + 3.5, "text-anchor": "end" }, gg).textContent = v === Y1 ? "100%" : String(v);
    });

    // hover ghost + selected band, the full column height down to its label
    const bandAttrs = { x: m.l + inset, y: 2, width: cw - 2 * inset, height: h - 2, rx: 8 };
    const ghost = P.canHover ? svg("rect", Object.assign({ class: "rb-ghost" }, bandAttrs), s) : null;
    const band = svg("rect", Object.assign({ class: "rb-band" }, bandAttrs), s);
    // the gridlines read through the band
    s.appendChild(gg);

    // lines
    SERIES.forEach((se) => {
      svg("polyline", { class: `rb-ln ${se.cls}`, points: LV.map((l, i) => `${x(i).toFixed(1)},${y(l[se.k]).toFixed(1)}`).join(" ") }, s);
    });

    // per column: dots, values, label
    const narrow = cw < 84;
    const cols = LV.map((l, i) => {
      const g = svg("g", { class: "rb-col" }, s);
      SERIES.forEach((se) => {
        const cx = x(i), cy = y(l[se.k]);
        svg("circle", { class: `rb-dot ${se.cls}`, cx: cx.toFixed(1), cy: cy.toFixed(1), r: se.k === "mean" ? 4.25 : 3.5 }, g);
        svg("text", { class: `rb-val ${se.cls}`, x: cx.toFixed(1), y: (cy - 10).toFixed(1), "text-anchor": "middle" }, g).textContent = f2(l[se.k]);
      });
      svg("text", { class: "rb-xt", x: x(i).toFixed(1), y: h - 10, "text-anchor": "middle" }, g).textContent = narrow ? l.short : l.name;
      return g;
    });

    // pointer targets: a column picks its level
    LV.forEach((l, i) => {
      const r = svg("rect", { class: "rb-hit", x: m.l + i * cw, y: 0, width: cw, height: h }, s);
      r.addEventListener("click", () => { stopAuto(); select(i); });
      if (ghost) {
        r.addEventListener("pointerenter", (e) => {
          if (e.pointerType === "touch") return;
          ghost.style.transform = `translateX(${(i * cw).toFixed(1)}px)`;
          ghost.classList.toggle("is-on", i !== cur);
        });
        r.addEventListener("pointerleave", () => ghost.classList.remove("is-on"));
      }
    });

    chart = { band, cols, cw, ghost };
    paintChart(true);
  }

  function paintChart(instant) {
    if (!chart) return;
    const { band, cols, cw, ghost } = chart;
    if (instant) band.style.transition = "none";
    band.style.transform = `translateX(${(cur * cw).toFixed(1)}px)`;
    if (instant) { void band.getBoundingClientRect(); band.style.transition = ""; }
    cols.forEach((g, k) => g.classList.toggle("is-sel", k === cur));
    if (ghost) ghost.classList.remove("is-on");
  }

  let rq = 0, lastW = 0, lastH = 0;
  const redraw = () => {
    cancelAnimationFrame(rq);
    rq = requestAnimationFrame(() => {
      const w = Math.round(box.clientWidth), h = Math.round(box.clientHeight);
      if (w === lastW && h === lastH && chart) return;
      lastW = w; lastH = h; draw();
    });
  };
  if ("ResizeObserver" in window) new ResizeObserver(redraw).observe(box);
  else window.addEventListener("resize", redraw);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastW = 0; redraw(); });
  draw();

  /* ───────── tabs: click + arrow keys (automatic activation) ───────── */
  btns.forEach((b, k) => b.addEventListener("click", () => select(k)));
  seg.addEventListener("keydown", (e) => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    let j = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % btns.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + btns.length) % btns.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = btns.length - 1;
    if (j < 0) return;
    e.preventDefault();
    btns[j].focus();
    select(j);
  });

  /* ───────── first view: step once Clean → Level 3 ───────── */
  (function autoStep() {
    if (P.reduced) return;
    const STEP = 1400;   // 3 steps × 1.4 s + the 0.45 s crossfade stays under 5 s (WCAG 2.2.2), with margin for timer slack
    const NS = "http://www.w3.org/2000/svg";
    btns.forEach((b) => {
      const s = document.createElementNS(NS, "svg");
      s.setAttribute("class", "seg-ring"); s.setAttribute("aria-hidden", "true");
      const r = document.createElementNS(NS, "rect"); r.setAttribute("pathLength", "100");
      s.appendChild(r); b.appendChild(s);
    });
    const fit = () => btns.forEach((b) => {
      const w = b.offsetWidth, h = b.offsetHeight, s = b.querySelector(".seg-ring"), r = s && s.firstChild;
      if (!r || !w || !h) return;
      s.setAttribute("viewBox", `0 0 ${w} ${h}`);
      r.setAttribute("x", ".75"); r.setAttribute("y", ".75");
      r.setAttribute("width", String(w - 1.5)); r.setAttribute("height", String(h - 1.5)); r.setAttribute("rx", "6.25");
    });
    fit();
    let ro = null;
    if ("ResizeObserver" in window) { ro = new ResizeObserver(fit); ro.observe(seg); }
    seg.style.setProperty("--seg-ms", STEP + "ms");

    let on = true, vis = false, started = false, io = null;
    const sync = () => seg.classList.toggle("is-paused", !vis || document.hidden);
    const run = () => {
      btns.forEach((b) => b.classList.remove("is-run"));
      if (!on) return;
      if (cur >= LV.length - 1) { stopAuto(); return; }
      void btns[cur].offsetWidth;
      btns[cur].classList.add("is-run");
    };
    stopAuto = () => {
      if (!on) return;
      on = false;
      seg.classList.remove("is-auto", "is-paused");
      btns.forEach((b) => b.classList.remove("is-run"));
      if (io) io.disconnect();
      if (ro) ro.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
    const userStop = (e) => { if (e.isTrusted) stopAuto(); };
    seg.addEventListener("pointerdown", userStop, true);
    seg.addEventListener("keydown", userStop, true);
    // keyboard arrival: Tab into the tablist must not start (or continue) a rotation that moves the selection away from focus
    seg.addEventListener("focusin", userStop, true);
    grid.addEventListener("focusin", userStop, true);
    seg.addEventListener("animationend", (e) => {
      if (!on || !started || !e.target.closest || !e.target.closest(".is-run")) return;
      select(cur + 1);
      run();
    });

    // start from clean depth, so the first thing the reader sees is the uncorrupted observation
    select(0);
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver((es) => { vis = es[0].isIntersecting; sync(); }, { threshold: 0.6 });
      io.observe(seg);
    } else vis = true;
    document.addEventListener("visibilitychange", sync);
    P.onVisible($(".rb-fig", root) || grid, () => {
      if (!on) return;
      if (seg.contains(document.activeElement) || grid.contains(document.activeElement)) { stopAuto(); return; }
      started = true;
      seg.classList.add("is-auto");
      sync(); run();
    }, { threshold: 0.6 });
  })();
})();
