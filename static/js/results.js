/* PrismWAM — D. Results.
   Stat strip (count-up + rank badge), one linked leaderboard per benchmark, radar, efficiency bubbles.
   Every chart listens to the global model highlight (PRISM.hl / "prism:hl") and can set it.
   Only transform / opacity / colour change on interaction, so nothing on the page ever reflows. */
(function () {
  "use strict";
  const P = window.PRISM, D = window.PRISM_DATA;
  const root = document.getElementById("results");
  if (!P || !D || !root) return;

  const { $, $$, svg, fmt, nameHTML, clamp } = P;
  const M = D.MODELS, BENCH = D.BENCHMARKS, BEST = D.PRISM_BEST, RR = D.RADAR_RANGES;
  const OURS_ID = "prismwam";

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const plainName = (id) => M[id].name;
  const htmlName = (id) => `<span class="rs-nm">${nameHTML(esc(M[id].name))}</span>`;
  const NUMW = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];
  const others = (b) => Object.entries(b.scores).filter(([k]) => !M[k].ours).sort((p, q) => q[1] - p[1]);
  // which PrismWAM model stands behind PRISM_BEST on each benchmark (PrismWAM* where reported)
  const bestOf = {};
  BENCH.forEach((b) => {
    const ours = Object.keys(b.scores).filter((k) => M[k].ours);
    bestOf[b.id] = ours.find((k) => Math.abs(b.scores[k] - BEST[b.id]) < 0.005) || OURS_ID;
  });
  // PrismWAM models are ranked against the other methods only (not against their own sibling size)
  function rankFor(b, id) {
    if (!M[id].ours) return D.rankIn(b, id);
    const list = Object.entries(b.scores).filter(([k]) => k === id || !M[k].ours).sort((p, q) => q[1] - p[1]);
    return { rank: list.findIndex(([k]) => k === id) + 1, of: list.length };
  }
  // per-model caveats (BENCHMARKS[].notes), shown as a dagger beside the score and spelled out in titles / the card
  const noteOf = (b, id) => (b.notes && b.notes[id]) || "";

  // text measurement for SVG layout (fonts may still be loading; we re-render on document.fonts.ready)
  const mctx = document.createElement("canvas").getContext("2d");
  const FONT = getComputedStyle(document.body).fontFamily || "sans-serif";
  const textW = (s, size, weight = 400) => { mctx.font = `${weight} ${size}px ${FONT}`; return mctx.measureText(String(s)).width; };

  // SVG text with π0.5 → π + subscript tspan
  function svgName(textEl, name, subSize) {
    const m = String(name).match(/^(.*?π)(0\.5|0)(.*)$/);
    if (!m) { textEl.textContent = name; return; }
    textEl.appendChild(document.createTextNode(m[1]));
    const s = svg("tspan", { "font-size": subSize, dy: "0.28em" }, textEl);
    s.textContent = m[2];
    if (m[3]) { const t = svg("tspan", { dy: "-0.28em" }, textEl); t.textContent = m[3]; }
  }

  /* ───────────────────────── shared model card (PRISM.tip) ───────────────────────── */
  // cardId: the model the card currently shows; the card is hidden whenever the highlight names another model
  let tipMine = false, cardId = null, pinned = null, lastPT = "mouse", lastUp = 0, cardY = 0;
  const cardCache = {};
  function cardHTML(id) {
    if (cardCache[id]) return cardCache[id];
    const m = M[id];
    if (!m) return "";
    const ours = !!m.ours;
    const type = ours ? "Ours" : m.type;
    const pre = ours ? "no" : m.pre === null ? (m.preNote || "not stated") : m.pre ? "yes" : "no";
    const hrs = m.hoursLabel && !ours && m.pre ? `<span class="rs-mc-hrs num">, ${esc(m.hoursLabel)}</span>` : "";
    let rows = "";
    BENCH.forEach((b) => {
      const v = b.scores[id];
      if (v == null) {
        rows += `<span class="rs-mc-b">${esc(b.short)}</span><span class="rs-mc-nr">not reported</span>`;
        return;
      }
      const rk = rankFor(b, id);
      const w = clamp((v - b.lo) / (b.hi - b.lo), 0, 1);
      rows += `<span class="rs-mc-b">${esc(b.short)}</span>` +
        `<span class="rs-mc-bar"><i style="transform:scaleX(${w.toFixed(3)})"></i></span>` +
        `<span class="rs-mc-v num">${fmt(v, 2)}${noteOf(b, id) ? "<sup>†</sup>" : ""}</span>` +
        `<span class="rs-mc-r num">#${rk.rank}<small>/${rk.of}</small></span>`;
    });
    const tcls = ours ? "is-ours" : "";
    const html = `<div class="rs-mc ${ours ? "rs-mc-ours" : m.pre ? "rs-mc-pre" : ""}${id === "prismwam-15b" ? " rs-mc-15b" : ""}">` +
      `<div class="rs-mc-head"><span class="rs-mc-sw" aria-hidden="true"></span><b class="rs-mc-name">${htmlName(id)}</b><span class="rs-mc-type ${tcls}">${type}</span></div>` +
      `<p class="rs-mc-pre-l">Embodied action pretraining: <b>${pre}</b>${hrs}</p>` +
      `<div class="rs-mc-grid"><span class="rs-mc-h">Benchmark</span><span class="rs-mc-h"></span><span class="rs-mc-h rs-mc-hr">Score</span><span class="rs-mc-h rs-mc-hr">Rank</span>${rows}</div>` +
      (cardNotes(id) ? `<p class="rs-mc-note">${cardNotes(id)}</p>` : "") +
      // rankFor: a PrismWAM model is ranked without its sibling size; any other model via rankIn (every reported method)
      `<p class="rs-mc-foot">${ours
        ? "Rank among all reported methods; the other PrismWAM size is not counted."
        : "Rank among all reported methods, PrismWAM sizes included."}</p>` +
      `</div>`;
    return (cardCache[id] = html);
  }
  function cardNotes(id) {
    return BENCH.filter((b) => noteOf(b, id)).map((b) => `† ${esc(b.short)}: ${esc(noteOf(b, id))}.`).join(" ");
  }
  function showCard(id, x, y) { P.tip.show(cardHTML(id), x, y); tipMine = true; cardId = id; cardY = scrollY; }
  // reposition the card if it already shows this model, otherwise (re)render it
  function moveCard(id, x, y) { if (tipMine && cardId === id) P.tip.show(null, x, y); else showCard(id, x, y); }
  function hideCard() { if (tipMine) { P.tip.hide(); tipMine = false; cardId = null; } }
  // A leaderboard row's card sits over its own panel, just above or below the row, on whichever side
  // covers less of the other panels (the same model's rows there stay visible).
  function rowCard(row, id) {
    // leaderboard rows only highlight the model across the boards; the floating card covered the bars
    if (tipMine) hideCard();
    return;
    showCard(id, -999, -999);
    const t = P.tip.el(), w = t.offsetWidth, h = t.offsetHeight, pad = 14;
    const panel = row.closest(".rs-panel"), pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const rects = panels.filter((p) => p.el !== panel).map((p) => p.el.getBoundingClientRect());
    const twins = $$(`.rs-row[data-model="${id}"]:not(.is-out)`, grid).filter((r) => r !== row).map((r) => r.getBoundingClientRect());
    const area = (a, r) => Math.max(0, Math.min(a.r, r.right) - Math.max(a.l, r.left)) * Math.max(0, Math.min(a.b, r.bottom) - Math.max(a.t, r.top));
    const midY = rr.top + rr.height / 2 - h / 2, cx = pr.left + (pr.width - w) / 2;
    const cands = [[cx, rr.bottom + 6, 0], [cx, rr.top - 6 - h, 1], [pr.right + 8, midY, 40], [pr.left - w - 8, midY, 40]];
    let best = null, bc = Infinity;
    cands.forEach(([l0, t0, bias]) => {
      const l = clamp(l0, pad, innerWidth - w - pad), t = clamp(t0, pad, innerHeight - h - pad);
      const a = { l, t, r: l + w, b: t + h };
      let c = bias;
      if (area(a, rr) > 0) c += 1e7;                                   // never cover the hovered row
      twins.forEach((r) => { if (area(a, r) > 0) c += 4e4; });          // nor the same model in other panels
      rects.forEach((r) => { c += area(a, r) * 0.05; });
      if (c < bc) { bc = c; best = a; }
    });
    P.tip.show(null, best.l - 18, best.t - 18);
  }
  function pin(id, src, el, place) {
    if (pinned && pinned.id === id && pinned.el === el) { unpin(); return; }
    pinned = { id, src, el };
    P.hl.set(id, src);
    place();
  }
  function unpin() { if (!pinned) return; const s = pinned.src; pinned = null; P.hl.clear(s); hideCard(); }

  root.addEventListener("pointerdown", (e) => { lastPT = e.pointerType || "mouse"; }, true);
  root.addEventListener("pointerup", () => { lastUp = performance.now(); }, true);
  document.addEventListener("click", (e) => {
    if (pinned && !e.target.closest("#results .rs-row, #results .rs-bub, #results .rs-radar")) unpin();
    // touch: a tap outside the radar releases the axis it pinned
    if (axisSrc === "radar" && lastPT === "touch" && !e.target.closest("#results .rs-radar")) setAxis(null, "radar");
  });
  // keyboard focus keeps its card anchored to the focused mark; pointer / pinned cards close on scroll
  let focusAnchor = null, sq = 0;
  function cardAt(el, id) {
    if (el.classList.contains("rs-bub")) {
      const r = el.querySelector(".rs-bub-c").getBoundingClientRect();
      return showCard(id, r.right, r.top + r.height / 2);
    }
    rowCard(el, id);
  }
  window.addEventListener("scroll", () => {
    if (!tipMine) return;
    if (focusAnchor && document.activeElement === focusAnchor) {
      cancelAnimationFrame(sq);
      sq = requestAnimationFrame(() => { if (focusAnchor) cardAt(focusAnchor, focusAnchor.dataset.model); });
      return;
    }
    // ignore the small scroll nudges a tap or a scroll-anchoring correction can cause; close on a real scroll
    if (performance.now() - lastUp < 350 || Math.abs(scrollY - cardY) < 24) return;
    hideCard(); if (pinned) unpin();
  }, { passive: true });
  document.addEventListener("focusout", () => { focusAnchor = null; });

  /* ───────────────────────── 1 · stat strip ───────────────────────── */
  // Each cell: benchmark, the PrismWAM model behind the number, the number, and its overall rank (computed, not typed).
  (function stats() {
    $$("[data-rs=nbench], [data-rs=nbench2]", root).forEach((el) => { el.textContent = String(BENCH.length); });
    // headline count: benchmarks where a PrismWAM model leads every method without embodied action pretraining
    const nled = BENCH.filter((b) => { const t = Object.entries(b.scores).filter(([k]) => !M[k].pre).sort((p, q) => q[1] - p[1])[0]; return t && M[t[0]].ours; }).length;
    $$("[data-rs=nled]", root).forEach((el) => { el.textContent = String(nled); });
    $$(".rs-stat", root).forEach((li) => {
      const key = li.dataset.stat;
      const num = $(".rs-stat-num", li), unit = $(".rs-stat-unit", li), tag = $(".rs-stat-model span", li);
      const rankB = $(".rs-stat-rank b", li);
      let model = OURS_ID;
      if (key === "nopre") {
        // benchmarks on which a PrismWAM model is first among methods without embodied action pretraining
        const topNoPre = (b) => Object.entries(b.scores).filter(([k]) => !M[k].pre).sort((p, q) => q[1] - p[1])[0];
        const led = BENCH.filter((b) => { const t = topNoPre(b); return t && M[t[0]].ours; });
        // the base model alone where it leads everywhere; otherwise "PrismWAM best"
        const baseAll = BENCH.every((b) => {
          const t = Object.entries(b.scores).filter(([k]) => k === OURS_ID || (!M[k].ours && !M[k].pre)).sort((p, q) => q[1] - p[1])[0];
          return t && t[0] === OURS_ID;
        });
        num.textContent = String(led.length);
        if (tag) tag.textContent = baseAll ? M[OURS_ID].name : "PrismWAM";
        li.classList.toggle("is-15b", false);
        // "#1 on every benchmark" only when true; otherwise say on how many
        if (led.length !== BENCH.length && rankB) {
          const sl = rankB.parentElement.querySelector(".rs-sl-l"), ss = rankB.parentElement.querySelector(".rs-sl-s");
          if (sl) sl.textContent = `on ${led.length} of ${BENCH.length} benchmarks`;
          if (ss) ss.textContent = `on ${led.length} of ${BENCH.length}`;
        }
        li.ariaLabel = `Among methods without embodied action pretraining, ${baseAll ? M[OURS_ID].name : "a PrismWAM model"} scores highest on ` +
          `${led.length} of ${BENCH.length} benchmarks: ${BENCH.map((b) => b.short).join(", ")}.`;
        return;
      }
      const b = BENCH.find((x) => x.id === key);
      if (!b) return;
      model = bestOf[key];
      const val = BEST[key];
      num.textContent = fmt(val, 2); unit.textContent = b.unit;
      if (tag) tag.textContent = M[model].name;
      li.classList.toggle("is-15b", model === "prismwam-15b");
      const rk = D.rankIn(b, model);   // among every reported method, both PrismWAM sizes included, as on the board pills
      if (rankB) rankB.textContent = `#${rk.rank}`;
      const base = b.scores[OURS_ID];
      li.ariaLabel = `${b.name}, ${b.metric.toLowerCase()}${b.unit === "%" ? " (%)" : ""}: ${M[model].name} ${fmt(val)}, #${rk.rank} of ${rk.of} methods.` +
        (model !== OURS_ID && base != null ? ` The 5B PrismWAM scores ${fmt(base)}.` : "");
    });
  })();

  /* ───────────────────────── 2 · linked leaderboard ───────────────────────── */
  const board = $("#rs-board", root), grid = $("#rs-grid", root);
  const NAME_W = 104;
  let filter = "all", curRow = null;

  const panels = BENCH.map((b, bi) => {
    const rows = Object.entries(b.scores).sort((p, q) => q[1] - p[1]).map(([id, v], i) => ({ id, v, i }));
    const el = document.createElement("section");
    el.className = "rs-panel";
    el.dataset.bench = b.id;
    el.dataset.i = bi;
    const sub = b.metric + (b.unit === "%" ? " (%)" : "") + (b.lo > 0 ? `, axis from ${b.lo}` : "");
    const hasShort = b.short && b.short !== b.name;
    const n = rows.length;
    const rowHTML = (r) => {
      const m = M[r.id];
      const w = clamp((r.v - b.lo) / (b.hi - b.lo), 0, 1);
      const cls = "rs-row" + (m.ours ? " is-ours" : "") + (r.id === "prismwam-15b" ? " is-15b" : "") + (!m.ours && m.pre ? " is-pre" : "");
      const nt = noteOf(b, r.id);
      const aria = `${m.name}, ${fmt(r.v)}${b.unit === "%" ? " percent" : ""}, rank ${r.i + 1} of ${n}` + (!m.ours && m.pre ? ", uses embodied action pretraining" : "") + (nt ? `. ${nt}` : "");
      const tt = textW(m.name, 13, m.ours ? 600 : 450) > NAME_W - 2 ? ` title="${esc(m.name)}"` : "";   // NAME_W: narrowest name slot (phones)
      return `<div class="${cls}" data-model="${r.id}" role="listitem" tabindex="-1" aria-label="${esc(aria)}" style="--slot:${r.i};--w:${w.toFixed(4)};--k:${r.i}">` +
        `<span class="rs-name"${tt}>${htmlName(r.id)}</span>` +
        `<span class="rs-track"><span class="rs-bar"><i class="rs-fill"></i></span><span class="rs-val num"${nt ? ` title="${esc(nt)}"` : ""}>${fmt(r.v)}${nt ? `<sup class="rs-dag" aria-hidden="true">†</sup>` : ""}</span></span></div>`;
    };
    el.innerHTML =
      `<header class="rs-ph">` +
        `<div class="rs-ph-text"><h4 class="rs-ph-title" id="rs-p-${b.id}"${hasShort ? ` aria-label="${esc(b.name)}" title="${esc(b.name)}"` : ""}>` +
          (hasShort ? `<span class="rs-t-l">${esc(b.name)}</span><span class="rs-t-s">${esc(b.short)}</span>` : esc(b.name)) +
          `</h4><p class="rs-ph-sub">${esc(sub)}</p></div>` +
        `<span class="rs-ph-rank" title="PrismWAM's rank among the methods shown (best PrismWAM model)"><i aria-hidden="true"></i><span class="rs-rk-full num"></span><span class="rs-rk-short num" aria-hidden="true"></span></span>` +
      `</header>` +
      `<div class="rs-rows" role="list" aria-labelledby="rs-p-${b.id}" style="--vis:${n};--p:${bi}">` +
        `<span class="rs-axis" aria-hidden="true"><span class="rs-axis-end${b.lo > 0 ? " is-broken" : ""}">` +
          (b.lo > 0 ? `<svg class="rs-brk" viewBox="0 0 12 9"><path d="M1.5 6.5 6 1.5M6 7.5 10.5 2.5"/></svg>` : "") +
          `<span class="rs-tick num">${b.lo}</span></span></span>` +
        rows.map(rowHTML).join("") +
        `<span class="rs-hidden" aria-hidden="true"></span>` +
      `</div>`;
    grid.appendChild(el);
    rows.forEach((r) => { r.el = el.querySelector(`.rs-row[data-model="${r.id}"]`); });
    return { b, bi, el, rows, rank: $(".rs-rk-full", el), rankS: $(".rs-rk-short", el), rowsEl: $(".rs-rows", el), hidden: $(".rs-hidden", el), head: $(".rs-ph", el) };
  });

  grid.dataset.n = String(panels.length);   // the CSS picks the arrangement by count (five: 2 + 3)
  function visibleRows(p) { return p.rows.filter((r) => !r.el.classList.contains("is-out")); }

  function applyFilter(mode) {
    filter = mode;
    panels.forEach((p) => {
      let slot = 0, hiddenN = 0;
      p.rows.forEach((r) => {
        const out = mode === "nopre" && !!M[r.id].pre;
        r.el.classList.toggle("is-out", out);
        // a hidden row folds into the seam between its visible neighbours: its slot = visible rows above it
        if (out) { hiddenN++; r.el.setAttribute("aria-hidden", "true"); r.el.tabIndex = -1; r.el.style.setProperty("--slot", slot); }
        else { r.el.removeAttribute("aria-hidden"); r.el.style.setProperty("--slot", slot++); }
      });
      const vis = visibleRows(p);
      const best = vis.findIndex((r) => M[r.id].ours);
      p.rank.innerHTML = `Ours <b>#${best + 1}</b>&nbsp;of ${vis.length}`;
      p.rankS.innerHTML = `<b>#${best + 1}</b><small>/${vis.length}</small>`;
      p.rowsEl.style.setProperty("--vis", vis.length);
      if (hiddenN) p.hidden.innerHTML = `<i class="rs-hidden-sw"></i>${hiddenN} hidden`;
      p.el.classList.toggle("is-filtered", hiddenN > 0);
      // roving tab stop: keep it on a visible row
      if (!vis.some((r) => r.el.tabIndex === 0)) { p.rows.forEach((r) => (r.el.tabIndex = -1)); if (vis[0]) vis[0].el.tabIndex = 0; }
    });
    if (curRow && curRow.classList.contains("is-out")) { curRow = null; P.hl.clear("board"); }
  }
  panels.forEach((p) => { if (p.rows[0]) p.rows[0].el.tabIndex = 0; });
  applyFilter("all");
  // phones: the panels become a horizontal snap carousel (CSS); the dots under it show and choose the panel
  const dotsEl = $("#rs-dots", root);
  if (dotsEl) {
    dotsEl.innerHTML = panels.map((p) => `<button type="button" class="rs-dot" aria-label="${esc(p.b.name)}" title="${esc(p.b.name)}"><i></i>` +
      `<svg class="rs-dot-ring" viewBox="0 0 20 20" aria-hidden="true"><circle class="rs-ring-bg" cx="10" cy="10" r="8"/><circle class="rs-ring-fg" cx="10" cy="10" r="8"/></svg></button>`).join("");
    const dots = $$(".rs-dot", dotsEl);
    const padL = () => parseFloat(getComputedStyle(grid).scrollPaddingLeft) || 0;
    const leftOf = (p) => grid.scrollLeft + p.el.getBoundingClientRect().left - grid.getBoundingClientRect().left - padL();
    let curDot = -1, dq = 0;
    const markDot = () => {
      if (grid.scrollWidth <= grid.clientWidth + 1) return;
      const x = grid.scrollLeft, max = grid.scrollWidth - grid.clientWidth;
      let k = 0, bd = Infinity;
      panels.forEach((p, i) => { const d = Math.abs(Math.min(leftOf(p), max) - x); if (d < bd) { bd = d; k = i; } });
      if (k === curDot) return;
      curDot = k;
      dots.forEach((d, i) => { if (i === k) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current"); });
      runRing();
    };
    // Apple-style autoplay: a ring fills around the current dot, then the next panel slides in (and round again). It
    // waits while the reader touches the charts (resuming 5 s after), while a tapped row card is open, while the row
    // is off-screen or the tab hidden; never with reduced motion.
    const mqPhone = window.matchMedia("(max-width: 639px)");
    let hold = false, inView = false, resumeT = 0;
    const autoOn = () => !P.reduced && mqPhone.matches && grid.scrollWidth > grid.clientWidth + 1;
    function runRing() {
      dots.forEach((d) => d.classList.remove("is-run"));
      if (!autoOn() || curDot < 0) return;
      const d = dots[curDot]; void d.offsetWidth; d.classList.add("is-run");
    }
    function syncAuto() {
      const on = autoOn();
      dotsEl.classList.toggle("is-auto", on);
      dotsEl.classList.toggle("is-paused", !on || hold || !inView || document.hidden || !!(pinned && pinned.src === "board"));
    }
    const holdNow = () => { hold = true; clearTimeout(resumeT); syncAuto(); };
    const releaseSoon = () => { clearTimeout(resumeT); resumeT = setTimeout(() => { hold = false; runRing(); syncAuto(); }, 5000); };
    grid.addEventListener("pointerdown", holdNow, { passive: true });
    grid.addEventListener("pointerup", releaseSoon, { passive: true });
    grid.addEventListener("pointercancel", releaseSoon, { passive: true });
    dotsEl.addEventListener("pointerdown", holdNow, { passive: true });
    dotsEl.addEventListener("pointerup", releaseSoon, { passive: true });
    dotsEl.addEventListener("animationend", (e) => {
      if (!e.target.closest || !e.target.closest(".rs-dot.is-run") || dotsEl.classList.contains("is-paused")) return;
      const next = (curDot + 1) % panels.length;
      grid.scrollTo({ left: leftOf(panels[next]), behavior: "smooth" });
    });
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => { inView = es[0].isIntersecting; syncAuto(); }, { threshold: 0.5 }).observe(grid);
    document.addEventListener("visibilitychange", syncAuto);
    document.addEventListener("click", () => setTimeout(syncAuto, 0), true);   // a row card opening / closing
    (mqPhone.addEventListener ? mqPhone.addEventListener("change", () => { runRing(); syncAuto(); }) : null);
    dots.forEach((d, i) => d.addEventListener("click", () => {
      grid.scrollTo({ left: leftOf(panels[i]), behavior: P.reduced ? "auto" : "smooth" });
    }));
    grid.addEventListener("scroll", () => {
      cancelAnimationFrame(dq); dq = requestAnimationFrame(markDot);
      // a swipe to another panel releases a tapped (pinned) row card; keyboard focus keeps its card
      if (pinned && pinned.src === "board" && lastPT === "touch" && performance.now() - lastUp > 350) unpin();
    }, { passive: true });
    dots[0].setAttribute("aria-current", "true"); curDot = 0;
    runRing(); syncAuto();
  }

  const segBtns = $$(".rs-filter button", root);
  segBtns.forEach((btn) => btn.addEventListener("click", () => {
    segBtns.forEach((b) => { b.setAttribute("aria-selected", String(b === btn)); b.tabIndex = b === btn ? 0 : -1; });
    applyFilter(btn.dataset.filter);
  }));
  $(".rs-filter", root).addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = segBtns.indexOf(document.activeElement);
    if (i < 0) return;
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + segBtns.length) % segBtns.length;
    segBtns[j].focus(); segBtns[j].click(); e.preventDefault();
  });
  P.autoSeg($(".rs-filter", root));

  // pointer: event delegation on the grid
  function enterRow(row) {
    if (M[row.dataset.model] && M[row.dataset.model].inert) return;   // e.g. VPP2: shown, never linked
    curRow = row;
    P.hl.set(row.dataset.model, "board");
    rowCard(row, row.dataset.model);
  }
  grid.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const row = e.target.closest(".rs-row");
    if (row && row !== curRow && !row.classList.contains("is-out")) enterRow(row);
  });
  grid.addEventListener("pointermove", (e) => {
    // the card is anchored to the row; only bring it back if another chart took it
    if (e.pointerType !== "touch" && curRow && !(tipMine && cardId === curRow.dataset.model)) rowCard(curRow, curRow.dataset.model);
  });
  grid.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const row = e.target.closest(".rs-row");
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".rs-row") : null;
    if (row && row === curRow && to !== row) {
      curRow = null;
      if (!to && !pinned) P.hl.clear("board");
    }
  });
  grid.addEventListener("click", (e) => {
    const row = e.target.closest(".rs-row");
    if (!row || row.classList.contains("is-out")) return;
    if (lastPT === "touch" || !P.canHover) pin(row.dataset.model, "board", row, () => rowCard(row, row.dataset.model));
  });
  // panel header ↔ radar axis
  panels.forEach((p) => {
    p.head.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") setAxis(p.bi, "board"); });
    p.head.addEventListener("pointerleave", () => setAxis(null, "board"));
  });
  // keyboard: one tab stop per panel; ↑/↓ within a panel, ←/→ follows the same model across panels
  grid.addEventListener("focusin", (e) => {
    const row = e.target.closest(".rs-row");
    if (!row) return;
    const p = panels[+row.closest(".rs-panel").dataset.i];
    p.rows.forEach((r) => (r.el.tabIndex = r.el === row ? 0 : -1));
    if (pinned && pinned.el !== row) pinned = null;   // a pin elsewhere is stale once focus moves here
    if (M[row.dataset.model] && M[row.dataset.model].inert) { P.hl.clear("board"); hideCard(); return; }
    curRow = row;
    P.hl.set(row.dataset.model, "board");
    cardAt(row, row.dataset.model);
    focusAnchor = row.matches(":focus-visible") ? row : null;
    setAxis(p.bi, "board-key");
  });
  grid.addEventListener("focusout", (e) => {
    const to = e.relatedTarget;
    if (to && to.closest && to.closest("#rs-grid .rs-row")) return;
    curRow = null;
    if (pinned && pinned.src === "board") unpin(); else if (!pinned) P.hl.clear("board");
    setAxis(null, "board-key");
  });
  grid.addEventListener("keydown", (e) => {
    const row = e.target.closest(".rs-row");
    if (!row) return;
    const pi = +row.closest(".rs-panel").dataset.i;
    const vis = visibleRows(panels[pi]);
    const idx = vis.findIndex((r) => r.el === row);
    let target = null;
    if (e.key === "ArrowDown") target = vis[Math.min(vis.length - 1, idx + 1)];
    else if (e.key === "ArrowUp") target = vis[Math.max(0, idx - 1)];
    else if (e.key === "Home") target = vis[0];
    else if (e.key === "End") target = vis[vis.length - 1];
    else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      for (let k = 1; k < panels.length && !target; k++) {
        const pv = visibleRows(panels[(pi + dir * k + panels.length * 2) % panels.length]);
        target = pv.find((r) => r.id === row.dataset.model) || null;
        if (!target && k === 1) target = pv[Math.min(idx, pv.length - 1)];
      }
    } else if (e.key === "Escape") {
      // dismiss card + highlight but keep focus on the row (Enter / Space or an arrow key brings it back)
      unpin(); P.hl.clear("board"); hideCard(); return;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (tipMine && cardId === row.dataset.model) { hideCard(); P.hl.clear("board"); }
      else if (!(M[row.dataset.model] && M[row.dataset.model].inert)) { P.hl.set(row.dataset.model, "board"); cardAt(row, row.dataset.model); }
      return;
    }
    if (target) { e.preventDefault(); target.el.focus(); }
  });
  P.onVisible(grid, () => board.classList.add("is-grown"), { threshold: 0.18 });

  /* ───────────────────────── 3a · radar ───────────────────────── */
  const rBox = $("#rs-radar-box", root), rSvg = $("#rs-radar", root), info = $("#rs-info", root), chipsEl = $("#rs-chips", root);
  const info1 = $(".rs-info-1", info), info2 = $(".rs-info-2", info);
  // radar models grouped like the presets: no embodied action pretraining first, then pretrained, then "not stated"
  const preGroup = (id) => (M[id].pre === false ? 0 : M[id].pre ? 1 : 2);
  const RM_ORDER = ["starvla", "fastwam", "4dwam", "openwam", "pi05", "spatialforcing", "xwam"];
  const ordIdx = (id) => (RM_ORDER.includes(id) ? RM_ORDER.indexOf(id) : 99);
  const RM = D.radarModels().sort((p, q) => preGroup(p) - preGroup(q) || ordIdx(p) - ordIdx(q));
  // presets (RoboDojo style): "Without action pretraining" (default) / "All models"; any other chip set = "Custom".
  // 4D-WAM and X-WAM are never drawn (radar: false in data.js), so neither preset lists them.
  const PRESETS = { nopre: RM.filter((id) => M[id].pre === false), all: RM.slice() };
  const enabled = new Set(PRESETS.nopre);
  const preText = (id) => (M[id].pre === null ? "pretraining not stated"
    : M[id].pre ? `with embodied action pretraining${M[id].hoursLabel ? ` (${M[id].hoursLabel})` : ""}` : "no embodied action pretraining");
  // two colour families: cool slate = no embodied action pretraining, bright yellow = with it; dashes tell models apart
  const STY = {
    openwam: { c: "#f2b200", d: "" },
    pi05: { c: "#ffcd3c", d: "7 4" },
    "4dwam": { c: "#f5c542", d: "" },
    xwam: { c: "#f5c542", d: "10 3 2 3" },
    spatialforcing: { c: "#e0a400", d: "2 3" },
    starvla: { c: "#6f87a6", d: "1.5 3.5" },
    fastwam: { c: "#51657f", d: "4 3" },
  };
  RM.forEach((id, i) => { if (!STY[id]) STY[id] = { c: "#8b8b95", d: i % 2 ? "4 3" : "" }; });
  let RG = null, axis = null, axisSrc = null, radarHover = null, hlId = null;

  // chips double as the legend (line style swatch); the group separator is a forced line break (CSS), so the
  // no-pretraining group and the pretrained group each start their own line at every width
  chipsEl.innerHTML =
    `<span class="rs-chip rs-chip-ours" title="Always shown"><span class="rs-sw-ours" aria-hidden="true"></span>PrismWAM</span>` +
    RM.map((id, i) => (i && preGroup(id) > 0 && preGroup(RM[i - 1]) === 0 ? `<span class="rs-chip-sep" aria-hidden="true"></span>` : "") +
      `<button type="button" class="rs-chip" data-model="${id}" aria-pressed="${enabled.has(id)}" title="${esc(`${M[id].name}: ${M[id].type}, ${preText(id)}`)}">` +
      `<svg class="rs-sw" viewBox="0 0 22 10" aria-hidden="true"><line x1="1.5" y1="5" x2="20.5" y2="5" stroke="${STY[id].c}" stroke-dasharray="${STY[id].d}"/></svg>${htmlName(id)}</button>`).join("");
  const chipBtns = $$("button.rs-chip", chipsEl);
  // where a group would itself wrap (the narrowest phones), drop the group break so the chips flow and the legend
  // takes no extra line (measured on resize only, never on hover)
  const chipSep = $(".rs-chip-sep", chipsEl);
  function fitChips() {
    if (!chipSep) return;
    chipSep.classList.remove("is-flow");
    const kids = [...chipsEl.children], k = kids.indexOf(chipSep);
    const oneLine = (els) => els.every((e) => e.offsetTop === els[0].offsetTop);
    chipSep.classList.toggle("is-flow", !oneLine(kids.slice(0, k)) || !oneLine(kids.slice(k + 1)));
  }
  const presetBtns = $$(".rs-preset button", root), customEl = $("#rs-custom", root);
  const sameSet = (ids) => ids.length === enabled.size && ids.every((id) => enabled.has(id));
  const presetOf = () => Object.keys(PRESETS).find((k) => sameSet(PRESETS[k])) || null;
  function syncPresets() {
    const cur = presetOf();
    presetBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === cur)));
    chipBtns.forEach((b) => b.setAttribute("aria-pressed", String(enabled.has(b.dataset.model))));
    if (customEl) customEl.classList.toggle("is-on", !cur);
  }
  presetBtns.forEach((btn) => btn.addEventListener("click", () => {
    enabled.clear();
    (PRESETS[btn.dataset.preset] || []).forEach((id) => enabled.add(id));
    syncPresets(); paintRadar(); paintInfo();
  }));
  syncPresets();
  chipBtns.forEach((btn) => {
    const id = btn.dataset.model;
    btn.addEventListener("click", () => {
      if (enabled.has(id)) enabled.delete(id); else enabled.add(id);
      syncPresets();
      // a chip just switched off must not keep its polygon raised; on touch the toggle itself is the feedback
      if (lastPT === "touch" || !enabled.has(id)) P.hl.clear("chip");
      paintRadar(); paintInfo();
    });
    btn.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") P.hl.set(id, "chip"); });
    btn.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") P.hl.clear("chip"); });
    // preview from focus only for keyboard focus (a tap or click also focuses the button)
    btn.addEventListener("focus", () => { if (btn.matches(":focus-visible")) P.hl.set(id, "chip"); });
    btn.addEventListener("blur", () => { if (P.hl.get() === id) P.hl.clear("chip"); });
  });

  const radarNorm = (bid, v) => { const r = RR[bid]; return clamp((v - r[0]) / (r[1] - r[0]), 0, 1); };
  const radarPts = (vals) => vals.map((t, i) => [RG.cx + RG.R * t * Math.cos(RG.ang[i]), RG.cy + RG.R * t * Math.sin(RG.ang[i])]);
  const ptsAttr = (pts) => pts.map((p) => p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");

  function renderRadar() {
    const W = Math.round(rBox.clientWidth);
    if (!W) return;
    const narrow = W < 470;
    const fs = narrow ? 11 : 13, lh = fs + 3.5, gap = narrow ? 8 : 13;
    const n = BENCH.length;
    const ang = BENCH.map((_, i) => -Math.PI / 2 + (i * 2 * Math.PI) / n);
    const sideW = Math.max(...BENCH.map((b, i) => (Math.abs(Math.cos(ang[i])) > 0.2 ? Math.max(textW(b.short, fs, 600), textW("00.00", fs, 600)) : 0)));
    // the widest side vertex sets the radius (0.951 for five axes, 0.866 for six)
    const cmax = Math.max(...ang.map((a) => Math.abs(Math.cos(a))));
    const R = Math.round(narrow
      ? clamp((W / 2 - 3 - 0.7 * sideW) / cmax - gap, 64, 124)
      : clamp((W / 2 - 4 - sideW) / cmax - gap, 64, 126));
    // axis labels (two lines: short name, PrismWAM value), placed relative to the centre; the box then hugs them
    // vertically, so an odd number of axes (no bottom vertex) leaves no empty band under the chart
    const labPos = ang.map((a) => {
      const c = Math.cos(a), s = Math.sin(a);
      let x = (R + gap) * c, anchor = c > 0.2 ? "start" : c < -0.2 ? "end" : "middle", y1;
      const y = (R + gap) * s;
      if (s < -0.9) y1 = y - lh - 3;                // top
      else if (s > 0.9) y1 = y + fs + 1;           // bottom
      else if (narrow) {
        // phones: centre side labels just above (upper axes) or below (lower axes) their vertex
        anchor = "middle";
        x = R * c + Math.sign(c) * (gap * cmax + 0.2 * sideW);
        y1 = s < 0 ? R * s - 10 - lh - 3 : R * s + 10 + fs;
      } else y1 = y + (s < 0 ? -lh * 0.55 : lh * 0.05) + fs * 0.32;
      return { x, y1, anchor };
    });
    const top = Math.min(-R, ...labPos.map((l) => l.y1 - fs)) - 8, bot = Math.max(R, ...labPos.map((l) => l.y1 + lh + 9)) + 8;
    const H = Math.round(bot - top);
    const cx = W / 2, cy = Math.round(-top);
    RG = { W, H, cx, cy, R, ang, ring: gap + 2 * lh + 40, fs, lh, gap };
    rSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    rSvg.setAttribute("width", W);
    rSvg.setAttribute("height", H);
    rSvg.textContent = "";
    const hex = (t) => ptsAttr(ang.map((a) => [cx + R * t * Math.cos(a), cy + R * t * Math.sin(a)]));
    svg("rect", { class: "rs-hit", x: 0, y: 0, width: W, height: H, fill: "transparent" }, rSvg);
    const gGrid = svg("g", { class: "rs-r-grid" }, rSvg);
    svg("polygon", { class: "rs-r-bg", points: hex(1) }, gGrid);
    [0.25, 0.5, 0.75, 1].forEach((t) => svg("polygon", { class: t === 1 ? "rs-r-ring is-outer" : "rs-r-ring", points: hex(t) }, gGrid));
    // wedges (one per axis) — kite between the neighbouring edge midpoints
    const gW = svg("g", { class: "rs-r-wedges" }, rSvg);
    RG.wedges = ang.map((a, i) => {
      const a0 = a - Math.PI / n, a1 = a + Math.PI / n, rm = R * Math.cos(Math.PI / n);
      const pts = [[cx, cy], [cx + rm * Math.cos(a0), cy + rm * Math.sin(a0)], [cx + R * Math.cos(a), cy + R * Math.sin(a)], [cx + rm * Math.cos(a1), cy + rm * Math.sin(a1)]];
      return svg("polygon", { class: "rs-r-wedge", points: ptsAttr(pts) }, gW);
    });
    RG.spokes = ang.map((a) => svg("line", { class: "rs-r-spoke", x1: cx, y1: cy, x2: cx + R * Math.cos(a), y2: cy + R * Math.sin(a) }, gGrid));
    // PrismWAM best
    const origin = `${cx}px ${cy}px`;
    const prismVals = BENCH.map((b) => radarNorm(b.id, BEST[b.id]));
    RG.prismPts = radarPts(prismVals);
    const gP = svg("g", { class: "rs-prism", style: `transform-origin:${origin}` }, rSvg);
    svg("polygon", { class: "rs-prism-area", points: ptsAttr(RG.prismPts) }, gP);
    RG.prismDots = RG.prismPts.map((p) => svg("circle", { class: "rs-prism-dot", cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 3.6 }, gP));
    RG.gPrism = gP;
    // comparison models
    const gM = svg("g", { class: "rs-polys" }, rSvg);
    RG.gPolys = gM;
    RG.polys = {};
    RG.pts = {};
    RM.forEach((id) => {
      const pts = radarPts(BENCH.map((b) => radarNorm(b.id, b.scores[id])));
      RG.pts[id] = pts;
      const g = svg("g", { class: "rs-poly", "data-model": id, style: `transform-origin:${origin}` }, gM);
      svg("polygon", { class: "rs-poly-line", points: ptsAttr(pts), stroke: STY[id].c, "stroke-dasharray": STY[id].d || "none" }, g);
      pts.forEach((p) => svg("circle", { class: "rs-poly-dot", cx: p[0].toFixed(1), cy: p[1].toFixed(1), r: 2.6, fill: STY[id].c }, g));
      RG.polys[id] = g;
    });
    // axis labels: short name + PrismWAM best value
    const gL = svg("g", { class: "rs-r-labels" }, rSvg);
    RG.labels = BENCH.map((b, i) => {
      const x = cx + labPos[i].x, y1 = cy + labPos[i].y1, anchor = labPos[i].anchor;
      const g = svg("g", { class: "rs-r-lab", "data-i": i }, gL);
      const t1 = svg("text", { class: "rs-r-name", x: x.toFixed(1), y: y1.toFixed(1), "text-anchor": anchor, "font-size": fs }, g);
      t1.textContent = b.short;
      const t2 = svg("text", { class: "rs-r-val", x: x.toFixed(1), y: (y1 + lh).toFixed(1), "text-anchor": anchor, "font-size": fs }, g);
      t2.textContent = fmt(BEST[b.id], 2);
      const tw = textW(b.short, fs, 600);
      const ux = anchor === "start" ? x : anchor === "end" ? x - tw : x - tw / 2;
      const u = svg("rect", { class: "rs-r-ul", x: ux.toFixed(1), y: (y1 + lh + 5).toFixed(1), width: tw.toFixed(1), height: 2.5, rx: 1.25 }, g);
      u.style.transformOrigin = `${(ux + tw / 2).toFixed(1)}px ${(y1 + lh + 6).toFixed(1)}px`;
      return g;
    });
    rSvg.setAttribute("aria-label", radarSummary());
    paintRadar();
    paintAxis();
  }

  function radarSummary() {
    const parts = BENCH.map((b) => `${b.short} ${fmt(BEST[b.id])}`);
    return `Radar chart of PrismWAM's best result on ${NUMW[BENCH.length] || BENCH.length} benchmarks: ${parts.join(", ")}. ` +
      `Axis ranges: ${BENCH.map((b) => `${b.short} ${RR[b.id][0]} to ${RR[b.id][1]}`).join(", ")}. ` +
      `Compared models: ${RM.map(plainName).join(", ")}. Use the left and right arrow keys to step through benchmarks.`;
  }

  function paintRadar() {
    if (!RG) return;
    const h = hlId;
    const hIn = !!h && RM.includes(h), hOurs = !!h && !!M[h] && !!M[h].ours;
    rSvg.classList.toggle("has-hl", hIn || hOurs);
    RG.gPrism.classList.toggle("is-hl", hOurs);
    RM.forEach((id) => {
      const g = RG.polys[id];
      g.classList.toggle("is-on", enabled.has(id) || id === h);
      g.classList.toggle("is-hl", id === h);
    });
    if (hIn && RG.gPolys.lastChild !== RG.polys[h]) RG.gPolys.appendChild(RG.polys[h]);
    chipBtns.forEach((b) => b.classList.toggle("is-hl", b.dataset.model === h));
  }

  function setAxis(i, src) {
    if (i == null) { if (axisSrc !== src) return; axis = null; axisSrc = null; }
    else { axis = i; axisSrc = src; }
    paintAxis();
  }
  function paintAxis() {
    if (RG) {
      RG.labels.forEach((g, i) => g.classList.toggle("is-on", i === axis));
      RG.spokes.forEach((l, i) => l.classList.toggle("is-on", i === axis));
      RG.wedges.forEach((w, i) => w.classList.toggle("is-on", i === axis));
      RG.prismDots.forEach((c, i) => c.classList.toggle("is-on", i === axis));
      rSvg.classList.toggle("has-axis", axis != null);
    }
    panels.forEach((p) => p.el.classList.toggle("is-linked", p.bi === axis && axisSrc !== "board-key" && axisSrc !== "board"));
    panels.forEach((p) => p.el.classList.toggle("is-axis", p.bi === axis && (axisSrc === "board" || axisSrc === "board-key")));
    paintInfo();
  }

  const swatch = (id) => `<svg class="rs-sw" viewBox="0 0 22 10" aria-hidden="true"><line x1="1.5" y1="5" x2="20.5" y2="5" stroke="${STY[id].c}" stroke-dasharray="${STY[id].d}"/></svg>`;
  const oursSw = `<span class="rs-sw-ours" aria-hidden="true"></span>`;
  // The strip is a fixed box, top-aligned so line 1 never moves between states: a title line, then a value grid.
  // At rest it reads out PrismWAM best on every axis; hovering a model reads out that model; hovering an axis
  // lists the models drawn. Its row count depends on width only (fitInfo), never on the state.
  // infoRows: rows the per-model list may use; axLay: how the per-axis readout is laid out (fitInfo)
  const infoRows = 3, mqNarrow = window.matchMedia("(max-width: 639px)");
  let axLay = { mode: "stack", tracks: 6, a: 2 };
  // columns that fit in the value grid; "compact" drops the line swatches to fit one more column
  function infoColumns(compact) {
    const w = info2.clientWidth || 300;
    // swatch 14 + gap 4 + longest name + gap 4 + pad 3 + value + slack 2 (12px type, see .rs-info-2 .rs-iv)
    const cell = (compact ? 9 : 27) + Math.max(...RM.map((id) => textW(M[id].name, 12))) + textW("00.00", 12, 600);
    return clamp(Math.floor((w + 10) / (cell + 10)), 1, 6);
  }
  // The per-axis readout mirrors the board: the first half of the benchmarks (the headline pair) on one line, the
  // rest on the next (five: 2 + 3), on a shared grid of a × b tracks, so neither line leaves an empty cell; each cell
  // stacks the benchmark's name over its value ("stack"). Strips too narrow for that (phones under ~350 px) fall back
  // to two columns of name + value ("grid"). Chosen from the width only, so every state shares the box height.
  function fitInfo() {
    const w = info2.clientWidth;
    if (!w) return;
    const n = BENCH.length, a = Math.floor(n / 2), b = n - a;
    // name size and hairline padding of a stacked cell, as in results.css (.rs-info-2[data-lay="stack"])
    const size = mqNarrow.matches ? 11 : 11.5, pad = mqNarrow.matches ? 8 : 10, vw = textW("00.00", 12.5, 600);
    const need = (lo, hi) => Math.max(vw, ...BENCH.slice(lo, hi).map((x) => textW(x.short, size))) + 1;
    const stack = w / a - 2 * pad >= need(0, a) && w / b - 2 * pad >= need(a, n);
    axLay = stack ? { mode: "stack", tracks: a * b, a } : { mode: "grid", tracks: 2, a: 2 };
    info.classList.toggle("is-tall", !stack);
  }
  function axisCells(id, ours) {
    const n = BENCH.length, a = axLay.a, split = axLay.mode !== "grid";
    return BENCH.map((b, i) => {
      const v = ours ? BEST[b.id] : b.scores[id], nt = ours ? "" : noteOf(b, id);
      // span: tracks per cell on its line; r0 / r1: first / last cell of a line (no hairline / no right padding)
      const span = split ? (i < a ? (n - a) : a) : 1;
      const r0 = split ? i === 0 || i === a : i % 2 === 0, r1 = split ? i === a - 1 || i === n - 1 : i % 2 === 1 || i === n - 1;
      return `<span class="rs-iv rs-iv-ax${ours ? " is-ours" : ""}${r0 ? " is-r0" : ""}${r1 ? " is-r1" : ""}" style="grid-column:span ${span}"><span class="rs-iv-n">${esc(b.short)}</span>` +
        (v == null ? `<b class="num is-nr" title="Not reported">–</b>`
          : `<b class="num"${nt ? ` title="${esc(nt)}"` : ""}>${fmt(v)}${nt ? "†" : ""}</b>`) + `</span>`;
    }).join("");
  }
  function paintInfo() {
    const h = hlId;
    info2.classList.remove("is-compact");
    if (axis != null) {
      const b = BENCH[axis], bm = bestOf[b.id];
      let shown = RM.filter((id) => enabled.has(id) || id === h).sort((p, q) => b.scores[q] - b.scores[p]);
      info1.innerHTML = `<span class="rs-i1-main"><span class="rs-i1-n"><b title="${esc(b.name)}">${esc(b.name)}</b></span><span class="rs-info-m">${esc(b.metric)}${b.unit === "%" ? " (%)" : ""}</span></span>` +
        `<span class="rs-iv is-ours">${oursSw}${esc(M[bm].name)} <b class="num">${fmt(BEST[b.id])}</b></span>`;
      // never clip the benchmark name mid-word: fall back to its short name when the slot is too narrow
      const nEl = $(".rs-i1-n > b", info1);
      if (nEl && b.short && nEl.scrollWidth > nEl.clientWidth + 0.5) nEl.textContent = b.short;
      if (!shown.length) info2.innerHTML = "";
      else {
        let cols = infoColumns(false), compact = false;
        if (infoRows * cols < shown.length && infoColumns(true) > cols) { cols = infoColumns(true); compact = true; }
        info2.style.setProperty("--cols", cols);
        delete info2.dataset.cols; delete info2.dataset.lay;   // per-model list: no column hairlines
        info2.classList.toggle("is-compact", compact);
        const cap = infoRows * cols;
        let extra = 0;
        if (shown.length > cap) {
          if (h && shown.indexOf(h) >= cap - 1) { shown = shown.filter((x) => x !== h); shown.splice(cap - 2, 0, h); }
          extra = shown.length - (cap - 1);
          shown = shown.slice(0, cap - 1);
        }
        info2.innerHTML = shown.map((id) => `<span class="rs-iv${id === h ? " is-hl" : ""}">${swatch(id)}<span class="rs-iv-n">${htmlName(id)}</span><b class="num"${noteOf(b, id) ? ` title="${esc(noteOf(b, id))}"` : ""}>${fmt(b.scores[id])}${noteOf(b, id) ? "†" : ""}</b></span>`).join("") +
          (extra ? `<span class="rs-iv rs-iv-more">+${extra} more</span>` : "");
      }
      info.dataset.state = "axis";
      return;
    }
    // resting state and model hover: one value per axis
    const ours = !h || !M[h] || !!M[h].ours;
    const sw = ours ? oursSw : RM.includes(h) ? swatch(h) : "";
    const meta = ours ? ""
      : `${M[h].type}, ${M[h].pre === null ? "pretraining not stated" : (M[h].pre ? "with" : "no") + " embodied action pretraining"}`;
    info1.innerHTML = `<span class="rs-i1-main"><span class="rs-i1-n">${sw}<b>${ours ? "PrismWAM" : htmlName(h)}</b></span>${meta ? `<span class="rs-info-m">${esc(meta)}</span>` : ""}</span>`;
    info2.style.setProperty("--cols", axLay.tracks);
    info2.dataset.cols = axLay.tracks;
    info2.dataset.lay = axLay.mode;
    info2.innerHTML = axisCells(ours ? OURS_ID : h, ours);
    info.dataset.state = h && M[h] ? "model" : "idle";
  }

  // hit-testing: wedge by angle (label ring included), models by nearest vertex / edge
  function svgPoint(e) {
    const rect = rSvg.getBoundingClientRect();
    const k = RG.W / rect.width;
    return [(e.clientX - rect.left) * k, (e.clientY - rect.top) * k];
  }
  function axisAt(x, y) {
    const dx = x - RG.cx, dy = y - RG.cy, d = Math.hypot(dx, dy);
    if (d > RG.R + RG.ring || d < 4) return null;
    const a = Math.atan2(dy, dx) + Math.PI / 2;
    const n = BENCH.length;
    return ((Math.round(a / ((2 * Math.PI) / n)) % n) + n) % n;
  }
  function segDist(px, py, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const t = clamp(((px - a[0]) * vx + (py - a[1]) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    return Math.hypot(px - a[0] - t * vx, py - a[1] - t * vy);
  }
  function modelAt(x, y) {
    const cands = RM.filter((id) => enabled.has(id) || id === hlId).map((id) => [id, RG.pts[id]]);
    cands.push([OURS_ID, RG.prismPts]);
    let best = null, bd = 9;
    cands.forEach(([id, pts]) => pts.forEach((p) => { const d = Math.hypot(x - p[0], y - p[1]); if (d < bd) { bd = d; best = id; } }));
    if (best) return best;
    bd = 4.5;
    cands.forEach(([id, pts]) => pts.forEach((p, i) => { const d = segDist(x, y, p, pts[(i + 1) % pts.length]); if (d < bd) { bd = d; best = id; } }));
    return best;
  }
  function radarPointer(e, tap) {
    if (!RG) return;
    const [x, y] = svgPoint(e);
    const ai = axisAt(x, y);
    if (ai == null) setAxis(null, "radar"); else if (ai !== axis || axisSrc !== "radar") setAxis(ai, "radar");
    const mid = modelAt(x, y);
    if (tap) { if (mid) pin(mid, "radar", rSvg, () => showCard(mid, e.clientX, e.clientY)); return; }
    if (mid) {
      if (radarHover !== mid) { radarHover = mid; P.hl.set(mid, "radar"); showCard(mid, e.clientX, e.clientY); }
      else moveCard(mid, e.clientX, e.clientY);
    } else if (radarHover) { radarHover = null; P.hl.clear("radar"); }
  }
  rSvg.addEventListener("pointermove", (e) => { if (e.pointerType !== "touch") radarPointer(e, false); });
  rSvg.addEventListener("pointerleave", (e) => {
    if (e.pointerType === "touch") return;
    setAxis(null, "radar");
    if (radarHover) { radarHover = null; P.hl.clear("radar"); }
  });
  rSvg.addEventListener("click", (e) => { if (lastPT === "touch" || !P.canHover) radarPointer(e, true); });
  // keyboard focus steps through axes and announces the strip; pointer focus (click / tap) does neither
  rSvg.addEventListener("focus", () => {
    if (!rSvg.matches(":focus-visible")) return;
    info.setAttribute("aria-live", "polite");
    setAxis(axis == null ? 0 : axis, "radar-key");
  });
  rSvg.addEventListener("blur", () => { info.setAttribute("aria-live", "off"); setAxis(null, "radar-key"); });
  rSvg.addEventListener("keydown", (e) => {
    const n = BENCH.length;
    let d = 0;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") d = 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") d = -1;
    else if (e.key === "Escape") { setAxis(null, axisSrc); return; }
    else return;
    e.preventDefault();
    info.setAttribute("aria-live", "polite");
    setAxis(((axis == null ? 0 : axis + d) + n) % n, "radar-key");
  });

  /* ───────────────────────── 3b · efficiency bubbles ───────────────────────── */
  const eBox = $("#rs-eff-box", root), eSvg = $("#rs-eff", root), takeaway = $("#rs-takeaway", root);
  const EFF = D.EFFICIENCY.slice();
  const LABEL_PREF = {
    "prismwam-15b": ["W", "SW", "S", "NW", "N"],
    prismwam: ["E", "SE", "NE", "S", "N"],
    xiaomi: ["S", "SE", "SW", "E", "N"],
    openwam: ["W", "NW", "SW", "N"],
    pi05: ["E", "SE", "NE", "W"],
    starvla: ["E", "N", "NE", "SE"],
    fastwam: ["E", "SE", "NE", "S"],
  };
  const LABEL_ORDER = ["prismwam-15b", OURS_ID, "xiaomi", "openwam", "pi05", "starvla", "fastwam"];
  const DIRS = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1], NE: [0.72, -0.72], SE: [0.72, 0.72], NW: [-0.72, -0.72], SW: [-0.72, 0.72] };
  const DIR_ALL = Object.keys(DIRS);

  (function () {
    const pw = EFF.find((e) => e.id === OURS_ID), xi = EFF.find((e) => e.id === "xiaomi");
    if (pw && xi) takeaway.innerHTML = `PrismWAM reaches <b class="num">${fmt(pw.score)}</b> with no embodied action pretraining; ${htmlName("xiaomi")} reaches <span class="num">${fmt(xi.score)}</span> after <span class="num">${esc(M.xiaomi.hoursLabel)}</span>.`;
    eSvg.setAttribute("aria-label", "Bubble chart of RoboDojo score against success rate; bubble area shows hours of embodied action pretraining. " +
      EFF.map((e) => `${plainName(e.id)}: score ${fmt(e.score)}, success rate ${fmt(e.sr)} percent, ${M[e.id].hoursLabel || "0 h"}`).join("; ") + ".");
  })();

  let EG = null, effPlotH = null;
  function renderEff() {
    const W = Math.round(eBox.clientWidth);
    if (!W) return;
    const narrow = W < 470;
    const fsT = narrow ? 11 : 12;
    const m = { l: narrow ? 38 : 46, r: 10, t: 12 };
    const rMax = clamp(W * 0.085, 24, 46), r10 = rMax * Math.sqrt(0.1);
    const rad = (id) => { const h = M[id].hours || 0; return h > 0 ? rMax * Math.sqrt(h / 100000) : M[id].ours ? 6 : 4.5; };

    // size legend: framed, in the empty bottom-right of the plot on wide cards; its own band under the axis on narrow ones
    const inPlot = W >= 400;
    const legFs = fsT - 0.5;
    const legItems = [{ lab: "0 h", r: 4.5, dot: true }, { lab: "10k h", r: r10 }, { lab: "100k h", r: rMax }];
    legItems.forEach((it) => { it.w = 2 * it.r + 6 + textW(it.lab, legFs, 450); });
    const legGap = 18;
    const itemsW = legItems.reduce((a, it) => a + it.w, 0) + legGap * (legItems.length - 1);
    const bandH = inPlot ? 0 : 2 * rMax + 28;

    const plotH = effPlotH != null ? effPlotH : Math.round(clamp(W * (narrow ? 0.78 : 0.56), 220, 320));
    const axisB = 42, bandGap = inPlot ? 0 : 18;
    const H = Math.round(m.t + plotH + axisB + bandGap + bandH + (inPlot ? 0 : 2));
    const X1 = 35, Y1 = 42;
    const x = (v) => m.l + (v / X1) * (W - m.l - m.r);
    const y = (v) => m.t + plotH - (v / Y1) * plotH;
    EG = { W, H, x, y, rMax, plotH };
    eSvg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    eSvg.setAttribute("width", W);
    eSvg.setAttribute("height", H);
    eSvg.textContent = "";
    // grid + ticks
    const gG = svg("g", { class: "rs-e-grid" }, eSvg);
    for (let v = 0; v <= 40; v += 10) {
      svg("line", { class: v === 0 ? "rs-e-axis" : "rs-e-gl", x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, gG);
      const t = svg("text", { class: "rs-e-tick", x: m.l - 8, y: y(v) + 4, "text-anchor": "end", "font-size": fsT }, gG);
      t.textContent = v;
    }
    for (let v = 0; v <= 30; v += narrow ? 10 : 5) {
      if (v > 0) svg("line", { class: "rs-e-gl", x1: x(v), x2: x(v), y1: m.t, y2: y(0) }, gG);
      const t = svg("text", { class: "rs-e-tick", x: x(v), y: y(0) + 17, "text-anchor": "middle", "font-size": fsT }, gG);
      t.textContent = v;
    }
    svg("line", { class: "rs-e-axis", x1: m.l, x2: m.l, y1: m.t, y2: y(0) }, gG);
    const xt = svg("text", { class: "rs-e-title", x: (m.l + W - m.r) / 2, y: y(0) + 36, "text-anchor": "middle", "font-size": fsT }, gG);
    xt.textContent = "RoboDojo success rate (%)";
    const yt = svg("text", { class: "rs-e-title", x: 0, y: 0, "text-anchor": "middle", "font-size": fsT, transform: `translate(${narrow ? 10 : 12} ${(m.t + y(0)) / 2}) rotate(-90)` }, gG);
    yt.textContent = "RoboDojo score";

    // legend
    const gLeg = svg("g", { class: "rs-e-leg", "aria-hidden": "true" }, eSvg);
    let legBox = null;
    if (inPlot) {
      const tw = textW("100k h", legFs, 450), head = "Action pretraining (h)";
      const bw = Math.round(Math.max(2 * rMax + tw + 52, textW(head, legFs, 550) + 26)), bh = Math.round(2 * rMax + 50);
      const bx = W - m.r - bw - 8, byy = y(0) - bh - 8;
      legBox = { x0: bx, y0: byy, x1: bx + bw, y1: byy + bh };
      svg("rect", { class: "rs-e-legbox", x: bx, y: byy, width: bw, height: bh, rx: 8 }, gLeg);
      const tt = svg("text", { class: "rs-e-legh", x: bx + 12, y: byy + 20, "font-size": legFs }, gLeg);
      tt.textContent = head;
      const ccx = bx + bw - 12 - rMax, cb = byy + bh - 10;
      [[rMax, "100k h"], [r10, "10k h"]].forEach(([r, lab]) => {
        svg("circle", { class: "rs-e-legc", cx: ccx, cy: cb - r, r }, gLeg);
        svg("line", { class: "rs-e-legtk", x1: ccx - 2, x2: ccx - rMax - 10, y1: cb - 2 * r, y2: cb - 2 * r }, gLeg);
        const t = svg("text", { class: "rs-e-legt", x: ccx - rMax - 13, y: cb - 2 * r + legFs * 0.36, "text-anchor": "end", "font-size": legFs }, gLeg);
        t.textContent = lab;
      });
      svg("circle", { class: "rs-e-legd", cx: bx + 16, cy: cb - 4.5, r: 4.5 }, gLeg);
      const t0 = svg("text", { class: "rs-e-legt", x: bx + 26, y: cb - 4.5 + legFs * 0.36, "font-size": legFs }, gLeg);
      t0.textContent = "0 h";
    } else {
      const by0 = y(0) + axisB + bandGap, base = H - 3;
      svg("line", { class: "rs-e-legsep", x1: m.l, x2: W - m.r, y1: by0 - bandGap / 2, y2: by0 - bandGap / 2 }, gLeg);
      const tt = svg("text", { class: "rs-e-legh", x: W / 2, y: by0 + 10, "text-anchor": "middle", "font-size": fsT }, gLeg);
      tt.textContent = "Bubble area: embodied action pretraining (h)";
      let lx = (W - itemsW) / 2;
      legItems.forEach((it) => {
        svg("circle", { class: it.dot ? "rs-e-legd" : "rs-e-legc", cx: lx + it.r, cy: base - it.r, r: it.r }, gLeg);
        const t = svg("text", { class: "rs-e-legt", x: lx + 2 * it.r + 6, y: base - it.r + legFs * 0.36, "font-size": legFs }, gLeg);
        t.textContent = it.lab;
        lx += it.w + legGap;
      });
    }

    // bubbles: big first so small ones stay on top
    const items = EFF.map((e) => ({ id: e.id, e, cx: x(e.sr), cy: y(e.score), r: rad(e.id) })).sort((p, q) => q.r - p.r);
    const gB = svg("g", { class: "rs-e-bubs" }, eSvg);
    const gLab = svg("g", { class: "rs-e-labs" }, eSvg);
    EG.bubs = {};
    EG.labs = {};
    items.forEach((it, k) => {
      const mm = M[it.id];
      const cls = "rs-bub" + (mm.ours ? " is-ours" : "") + (it.id === "prismwam-15b" ? " is-15b" : "") + (mm.hours ? " is-big" : " is-zero");
      const aria = `${mm.name}: RoboDojo score ${fmt(it.e.score)}, success rate ${fmt(it.e.sr)} percent, ${mm.hoursLabel || "0 h"} of embodied action pretraining`;
      const g = svg("g", { class: cls, "data-model": it.id, tabindex: 0, role: "button", "aria-label": aria, style: `--k:${k}` }, gB);
      if (mm.ours) svg("circle", { class: "rs-bub-halo", cx: it.cx, cy: it.cy, r: it.r + 6 }, g);
      svg("circle", { class: "rs-bub-c", cx: it.cx, cy: it.cy, r: it.r }, g);
      svg("circle", { class: "rs-bub-ring", cx: it.cx, cy: it.cy, r: it.r + 4 }, g);
      // small marks get a generous 12 px hit circle, except where they sit on a larger bubble: there the hit
      // area hugs the visible dot (+3 px) so a tap on the big bubble's body still reaches the big bubble
      const onBig = items.some((o) => o !== it && o.r > it.r && Math.hypot(o.cx - it.cx, o.cy - it.cy) < o.r + 12);
      svg("circle", { class: "rs-bub-hit", cx: it.cx, cy: it.cy, r: onBig ? it.r + 3 : Math.max(it.r, 12), fill: "transparent" }, g);
      EG.bubs[it.id] = g;
    });

    // labels: cost-based placement (preferred side, short distance, no leader) with hard
    // penalties for leaving the plot or touching a bubble or an earlier label
    const bounds = { x0: m.l + 3, y0: 1, x1: W - 1, y1: y(0) - 3 };
    const placed = [];
    const fsN = narrow ? 11.5 : 12.5, fsH = narrow ? 10.5 : 11.5;
    const order = LABEL_ORDER.filter((id) => items.some((i) => i.id === id));
    items.forEach((it) => { if (!order.includes(it.id)) order.push(it.id); });
    const circleHit = (bx, o, pad) => {
      const nx = clamp(o.cx, bx.x0, bx.x1), ny = clamp(o.cy, bx.y0, bx.y1);
      return Math.hypot(nx - o.cx, ny - o.cy) < o.r + pad;
    };
    const boxHit = (a, b) => a.x0 < b.x1 + 5 && a.x1 + 5 > b.x0 && a.y0 < b.y1 + 2 && a.y1 + 2 > b.y0;
    order.forEach((id) => {
      const it = items.find((i) => i.id === id), mm = M[id];
      const hrs = mm.hoursLabel || "0 h";
      const w = Math.max(textW(mm.name, fsN, 600), textW(hrs, fsH, 400)) + 2;
      const h = fsN + fsH + 6;
      const pref = LABEL_PREF[id] || [];
      const dirs = pref.concat(DIR_ALL.filter((q) => !pref.includes(q)));
      const dists = [5, 14, 26, 40, 56, 74].map((d) => it.r + d);
      let pick = null, best = Infinity;
      dirs.forEach((dir, pi) => dists.forEach((dd, di) => {
        const [ux, uy] = DIRS[dir];
        const ax = it.cx + ux * dd, ay = it.cy + uy * dd;
        const x0 = ux > 0.1 ? ax : ux < -0.1 ? ax - w : ax - w / 2;
        const y0 = uy > 0.1 ? ay : uy < -0.1 ? ay - h : ay - h / 2;
        const bx = { x0, y0, x1: x0 + w, y1: y0 + h, ux, dd };
        if (bx.x0 < bounds.x0 || bx.x1 > bounds.x1 || bx.y0 < bounds.y0 || bx.y1 > bounds.y1) return;
        let cost = pi * 7 + di * 10 + (dd > it.r + 20 ? 12 : 0);
        placed.forEach((p) => { if (boxHit(bx, p)) cost += 1000; });
        if (legBox && boxHit(bx, legBox)) cost += 1000;
        items.forEach((o) => { if (circleHit(bx, o, o === it ? 3 : 4)) cost += o === it ? 1000 : o.r > 14 ? 400 : 900; });
        if (cost < best) { best = cost; pick = bx; }
      }));
      if (!pick) { const x0 = it.cx + it.r + 5; pick = { x0, y0: it.cy - h / 2, x1: x0 + w, y1: it.cy + h / 2, ux: 1, dd: it.r + 5 }; }
      placed.push(pick);
      const anchor = pick.ux > 0.1 ? "start" : pick.ux < -0.1 ? "end" : "middle";
      const tx = anchor === "start" ? pick.x0 : anchor === "end" ? pick.x1 : (pick.x0 + pick.x1) / 2;
      const g = svg("g", { class: "rs-lab" + (mm.ours ? " is-ours" : ""), "data-model": id, "aria-hidden": "true" }, gLab);
      if (pick.dd > it.r + 20) {
        // leader line from the bubble edge to the nearest point of the label box
        const nx = clamp(it.cx, pick.x0 - 3, pick.x1 + 3), ny = clamp(it.cy, pick.y0 + 2, pick.y1 - 2);
        const vx = nx - it.cx, vy = ny - it.cy, vl = Math.hypot(vx, vy) || 1;
        svg("line", { class: "rs-lab-lead", x1: (it.cx + (vx / vl) * (it.r + 2.5)).toFixed(1), y1: (it.cy + (vy / vl) * (it.r + 2.5)).toFixed(1), x2: nx.toFixed(1), y2: ny.toFixed(1) }, g);
      }
      const t1 = svg("text", { class: "rs-lab-n", x: tx.toFixed(1), y: (pick.y0 + fsN).toFixed(1), "text-anchor": anchor, "font-size": fsN }, g);
      svgName(t1, mm.name, fsN * 0.72);
      const t2 = svg("text", { class: "rs-lab-h", x: tx.toFixed(1), y: (pick.y0 + fsN + fsH + 3).toFixed(1), "text-anchor": anchor, "font-size": fsH }, g);
      t2.textContent = hrs;
      EG.labs[id] = g;
    });
    paintEff();
  }
  // side by side, grow or shrink the bubble plot so both cards end level (no dead space under either)
  function fitEff() {
    if (!EG) return;
    const pair = eBox.closest(".rs-pair"), a = pair.children[0], b = pair.children[1];
    if (!a || !b) return;
    if (Math.abs(a.offsetTop - b.offsetTop) > 4) { if (effPlotH != null) { effPlotH = null; renderEff(); } return; }
    pair.classList.add("is-measuring");
    const diff = a.offsetHeight - b.offsetHeight;
    pair.classList.remove("is-measuring");
    // only ever grow the plot; when the radar card is the shorter one, its radar box absorbs the slack
    if (Math.abs(diff) < 2 || (diff < 0 && effPlotH == null)) return;
    const base = Math.round(clamp(EG.W * (EG.W < 470 ? 0.82 : 0.66), 230, 380));
    const next = Math.round(clamp(EG.plotH + diff, base, EG.W * 1.3));
    if (Math.abs(next - EG.plotH) >= 1) { effPlotH = next; renderEff(); }
  }
  function paintEff() {
    if (!EG) return;
    const h = hlId && EG.bubs[hlId] ? hlId : null;
    eSvg.classList.toggle("has-hl", !!h);
    Object.keys(EG.bubs).forEach((id) => {
      EG.bubs[id].classList.toggle("is-hl", id === h);
      if (EG.labs[id]) EG.labs[id].classList.toggle("is-hl", id === h);
    });
  }
  let effCur = null;
  eSvg.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const g = e.target.closest(".rs-bub");
    if (!g || g === effCur) return;
    effCur = g;
    P.hl.set(g.dataset.model, "eff");
    showCard(g.dataset.model, e.clientX, e.clientY);
  });
  eSvg.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch" || !effCur) return;
    moveCard(effCur.dataset.model, e.clientX, e.clientY);
  });
  eSvg.addEventListener("pointerout", (e) => {
    if (e.pointerType === "touch") return;
    const g = e.target.closest(".rs-bub");
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(".rs-bub") : null;
    if (g && g === effCur && to !== g) { effCur = null; if (!to && !pinned) P.hl.clear("eff"); }
  });
  eSvg.addEventListener("click", (e) => {
    const g = e.target.closest(".rs-bub");
    if (g && (lastPT === "touch" || !P.canHover)) pin(g.dataset.model, "eff", g, () => showCard(g.dataset.model, e.clientX, e.clientY));
  });
  eSvg.addEventListener("focusin", (e) => {
    const g = e.target.closest(".rs-bub");
    if (!g) return;
    if (pinned && pinned.el !== g) pinned = null;   // a pin elsewhere is stale once focus moves here
    P.hl.set(g.dataset.model, "eff");
    cardAt(g, g.dataset.model);
    focusAnchor = g.matches(":focus-visible") ? g : null;
  });
  eSvg.addEventListener("focusout", (e) => {
    const to = e.relatedTarget;
    if (to && to.closest && to.closest("#rs-eff .rs-bub")) return;
    if (pinned && pinned.src === "eff") unpin(); else if (!pinned) P.hl.clear("eff");
  });
  eSvg.addEventListener("keydown", (e) => {
    const g = e.target.closest(".rs-bub");
    if (!g) return;
    // Enter / Space show or hide the focused bubble's model card; Escape dismisses card and highlight
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (tipMine && cardId === g.dataset.model) { hideCard(); P.hl.clear("eff"); }
      else { P.hl.set(g.dataset.model, "eff"); cardAt(g, g.dataset.model); }
    } else if (e.key === "Escape") { unpin(); P.hl.clear("eff"); hideCard(); }   // focus stays on the bubble
  });

  /* ───────────────────────── global highlight ───────────────────────── */
  function applyHL(id) {
    hlId = id && M[id] ? id : null;
    board.classList.toggle("has-hl", !!hlId);
    panels.forEach((p) => p.rows.forEach((r) => r.el.classList.toggle("is-hl", r.id === hlId)));
    paintRadar();
    paintEff();
    paintInfo();
  }
  document.addEventListener("prism:hl", (e) => {
    const d = e.detail || {};
    applyHL(d.id);
    if (!d.id) { hideCard(); pinned = null; }
    else {
      if (d.id !== cardId) hideCard();   // whoever moved the highlight, a card for another model is stale
      if (pinned && pinned.id !== d.id) pinned = null;
    }
  });

  /* ───────────────────────── render + responsive ───────────────────────── */
  // The SVG charts are first drawn from the ResizeObserver's initial notification (rAF after the first layout),
  // not while the page is still parsing: measuring here would force a full-page layout on the main thread
  // before the hero becomes interactive. The section sits far below the fold, so nothing visible waits for it.
  paintInfo();
  let lastRW = 0, lastEW = 0, rq = 0;
  const rerender = () => {
    cancelAnimationFrame(rq);
    rq = requestAnimationFrame(() => {
      const rw = Math.round(rBox.clientWidth), ew = Math.round(eBox.clientWidth);
      if (rw !== lastRW) { lastRW = rw; renderRadar(); }
      if (ew !== lastEW) { lastEW = ew; renderEff(); }
      fitChips();
      const lay = axLay.mode + axLay.tracks;
      fitInfo();
      if (lay !== axLay.mode + axLay.tracks) paintInfo();
      fitEff();
    });
  };
  if ("ResizeObserver" in window) { const ro = new ResizeObserver(rerender); ro.observe(rBox); ro.observe(eBox); }
  else { window.addEventListener("resize", rerender); rerender(); }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastRW = lastEW = 0; rerender(); });

  P.onVisible(rBox, () => rSvg.classList.add("is-drawn"), { threshold: 0.3 });
  P.onVisible(eBox, () => {
    eSvg.classList.add("is-drawn");
    setTimeout(() => eSvg.classList.add("is-settled"), 1800);
  }, { threshold: 0.3 });
    /* stat strip → board: hovering or focusing a headline number lights up its benchmark below (panel + radar axis);
     a "nopre" cell, if present, lights up PrismWAM on every board. */
  $$(".rs-stat", root).forEach((li) => {
    const key = li.dataset.stat;
    const bi = BENCH.findIndex((b) => b.id === key);
    li.tabIndex = 0;
    const on = () => { if (bi >= 0) setAxis(bi, "stat"); else if (key === "nopre") P.hl.set("prismwam", "stat"); li.classList.add("is-hot"); };
    const off = () => { if (bi >= 0) setAxis(null, "stat"); else if (key === "nopre") P.hl.clear("stat"); li.classList.remove("is-hot"); };
    li.addEventListener("pointerenter", (e) => { if (e.pointerType !== "touch") on(); });
    li.addEventListener("pointerleave", off);
    li.addEventListener("focus", on);
    li.addEventListener("blur", off);
  });
if (P.hl.get()) applyHL(P.hl.get());
})();
