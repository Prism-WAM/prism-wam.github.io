/* PrismWAM — E. Real world (#real).
   1. Pooled ID/OOD comparison: bars grow and values count up once on view.
   2. Evidence browser: task tabs, a large video viewer that plays one successful PrismWAM trial per case (2× speed,
      6× during inference pauses; a short case badge, a thin progress line for the clip), a thumbnail rail (the in-distribution case, then the
      out-of-distribution cases) and per-task bars. While the viewer is on screen the selected clip plays; when it ends
      the next case of the same task follows (a gentle tour). All numbers come from PRISM_DATA.
   3. Global model highlight: hovering an OpenWAM / PrismWAM bar sets PRISM.hl, and the bars here respond
      to html[data-hl] from any chart on the page (real.css). */
(function () {
  "use strict";
  const P = window.PRISM, D = window.PRISM_DATA;
  const root = document.getElementById("real");
  if (!root || !P || !D || !D.REAL) return;
  const { $, $$, clamp, reduced, canHover } = P;

  const MINUS = "−";

  // One successful PrismWAM trial per case: robot motion at 2×, the inference pauses between action chunks at 6×
  // (uniform: true = a flat 2×, no pause sped up; the corner badge says which). static/video/real/<task>_<key>.mp4, poster <…>.jpg.
  // The first case of each task is the in-distribution one, the rest are out of distribution.
  // short = rail label and viewer badge; desc = what the clip shows (accessible name, announcement, tooltip).
  // Open Microwave had no successful tablecloth trial, so that case has no clip and is left out.
  const CASES = {
    plate: [
      { key: "id", kind: "id", short: "Original setup", desc: "in distribution" }, // trial 10
      { key: "ood_lights", kind: "ood", short: "Disco Light", desc: "the room lights off and flickering colored lights", uniform: true }, // trial 17 (room lights off; 2× throughout, no pause speed-up in the dark)
      { key: "ood_distractors", kind: "ood", short: "Distractors", desc: "a carrot, tape and a plastic bottle on the table" }, // trial 22
      { key: "ood_platecolor", kind: "ood", short: "Changed Plate Color", desc: "green, yellow and orange plates in the rack" }, // trial 23
    ],
    ranking: [
      { key: "id", kind: "id", short: "Original setup", desc: "in distribution" }, // trial 1
      { key: "ood_lights", kind: "ood", short: "Disco Light", desc: "the room lights off, a hand-held flickering colored light, and a carrot and tape on the table", uniform: true }, // trial 18 (room lights off; no pause certifiable in the dark, so 2× throughout)
      { key: "ood_distractors", kind: "ood", short: "Distractors", desc: "dimmed room light, a flickering colored light, a glass beaker and a flask" }, // trial 17
      { key: "ood_tablecloth", kind: "ood", short: "Tablecloth", desc: "a checkered tablecloth, dimmed light and a hand-held flickering colored light" }, // trial 19
    ],
    microwave: [
      { key: "id", kind: "id", short: "Original setup", desc: "in distribution" }, // trial 6
      { key: "ood_lights", kind: "ood", short: "Disco Light", desc: "flickering colored lights" }, // trial 16
      { key: "ood_distractors", kind: "ood", short: "Distractors", desc: "a yellow toy pepper and a small toy basketball" }, // trial 13
      { key: "ood_blocks", kind: "ood", short: "Block Distractors", desc: "three small colored blocks on the table", uniform: true }, // trial 15 (the pause detector certified no inference pause, so 2× throughout)
    ],
  };

  // Representative instructions (Pick Up Plate and Ranking Block Size worded to match the trials shown here;
  // Open Microwave: paper, Table 16)
  const INSTR = {
    plate: "Bimanually pick up the flat plate and slot it upright into the rack’s robot-nearest slot.",
    ranking: "Arrange cubes along the arm’s reach: largest nearest the robot base, medium centered, smallest farthest.",
    microwave: "Open the microwave; put the inside basket to microwave’s right; leave door open.",
  };

  // Evaluation conditions per task (paper, Sec. 4.4 and Appendix A.3)
  const COND = {
    plate: { id: "The plate starts flat on the table, with three white plates already in the rack.", ood: "Changed lighting, distractors, rack contents or plate colors." },
    ranking: { id: "All six initial size orderings.", ood: "Changed lighting, distractors, tablecloth or initial placement." },
    microwave: { id: "Original setup and arrangement.", ood: "Flickering lights at normal, low or no room light; distractors; a changed tablecloth." },
  };

  const TASKS = D.REAL;
  const SPLITS = [
    { id: "id", name: "In distribution", short: "ID" },
    { id: "ood", name: "Out of distribution", short: "OOD" },
  ];
  const MODELS = [
    { id: "openwam", name: "OpenWAM" },
    { id: "prismwam", name: "PrismWAM" },
  ];

  // keep hyphenated compounds whole, so balanced wrapping never splits "face-up" at the hyphen
  const keepCompounds = (txt) => txt.replace(/[^\s-]+(?:-[^\s-]+)+/g, (w) => `<span class="nowrap">${w}</span>`);
  const rate = ([s, t]) => (s / t) * 100;
  const pctTxt = (v) => v.toFixed(1) + "%";
  const signed = (v) => {
    const r = Math.round(v * 10) / 10;
    return (r < 0 ? MINUS : "+") + Math.abs(r).toFixed(1);
  };
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  /* ───────── headline claim (kept in sync with data) ───────── */
  const pooled = D.REAL_POOLED;
  const claim = $("[data-real-claim]", root);
  if (claim && pooled) claim.textContent = signed(rate(pooled.prismwam.ood) - rate(pooled.openwam.ood));

  /* ───────── shared bar row ───────── */
  function barRow(model, sv) {
    const row = el("div", "real-bar" + (model.id === "prismwam" ? " is-ours" : ""));
    row.dataset.model = model.id; // same id as PRISM_DATA.MODELS, so the page-wide highlight finds it
    row.innerHTML =
      `<span class="real-bar-name">${model.name}</span>` +
      `<span class="real-bar-track"><span class="real-bar-fill"></span></span>` +
      `<span class="real-bar-val num"></span>` +
      `<span class="real-bar-frac num"></span>`;
    setBar(row, sv, false);
    return row;
  }
  function setBar(row, sv, tween) {
    const v = rate(sv);
    row.style.setProperty("--v", (v / 100).toFixed(4));
    const val = $(".real-bar-val", row), frac = $(".real-bar-frac", row);
    frac.textContent = `${sv[0]}/${sv[1]}`;
    const from = parseFloat(val.dataset.v);
    val.dataset.v = v;
    if (tween && !reduced && !isNaN(from) && from !== v) tweenNum(val, from, v, (x) => pctTxt(x));
    else val.textContent = pctTxt(v);
  }
  function tweenNum(node, a, b, f, dur = 520) {
    const t0 = performance.now();
    const id = (node.__tw = (node.__tw || 0) + 1);
    const step = (t) => {
      if (node.__tw !== id) return;
      const p = clamp((t - t0) / dur, 0, 1), e = 1 - Math.pow(1 - p, 3);
      node.textContent = f(a + (b - a) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // big gain readout for the pooled rows: the number on one line, "points" under it
  function gainEl(d) {
    const c = el("span", "real-delta num" + (d < 0 ? " is-neg" : ""));
    c.innerHTML = `<b>${signed(d)}</b> <span>points</span>`;
    c.dataset.v = d;
    return c;
  }

  /* ───────── 1. pooled comparison ───────── */
  const pooledBox = $("#real-pooled", root);
  const pooledRows = $("#real-pooled-rows", root);
  if (pooledRows && pooled) {
    SPLITS.forEach((sp) => {
      const o = pooled.openwam[sp.id], p = pooled.prismwam[sp.id];
      const d = rate(p) - rate(o);
      const row = el("div", "real-prow");
      row.dataset.split = sp.id;
      const lab = el("div", "real-prow-label", `<span class="real-prow-name">${sp.name}</span>`);
      const bars = el("div", "real-prow-bars");
      bars.setAttribute("role", "img");
      bars.setAttribute("aria-label",
        `${sp.name}: OpenWAM ${pctTxt(rate(o))} (${o[0]} of ${o[1]}), PrismWAM ${pctTxt(rate(p))} (${p[0]} of ${p[1]}), ${signed(d)} points for PrismWAM.`);
      MODELS.forEach((m) => bars.appendChild(barRow(m, pooled[m.id][sp.id])));
      $$(".real-bar > *", bars).forEach((n) => n.setAttribute("aria-hidden", "true"));
      const dl = el("div", "real-prow-delta");
      dl.appendChild(gainEl(d));
      row.append(lab, bars, dl);
      pooledRows.appendChild(row);
    });
    if (reduced) pooledBox.classList.add("is-grown"); // final state at once
    else {
      // values start at 0.0% (and stay faded) so the card never shows final numbers beside empty bars;
      // the value column has a fixed width, so counting never moves anything
      const vals = $$(".real-bar-val", pooledBox);
      vals.forEach((n) => { n.textContent = pctTxt(0); });
      P.onVisible(pooledBox, () => {
        pooledBox.classList.add("is-grown");
        vals.forEach((n, i) => setTimeout(() => tweenNum(n, 0, +n.dataset.v, pctTxt, 1100), 120 + i * 90));
      }, { threshold: 0.45 });
    }
  }

  /* ───────── 2. evidence browser ───────── */
  const browser = $("#real-browser", root);
  const tabsEl = $("#real-tabs", root);
  const panel = $("#real-panel", root);
  const viewer = $("#real-viewer", root);
  const stage = $("#real-stage", root);
  const rail = $("#real-rail", root);
  const stepFill = $("#real-steps .real-step i", root);
  const playBtn = $("#real-play", root);
  const modeBadge = $("#real-badge-mode", root);
  const modeL = $(".real-mode-l", modeBadge), modeS = $(".real-mode-s", modeBadge);
  const speedBadge = $(".real-badge-speed", root);
  const live = $("#real-live", root);
  if (!browser || !tabsEl || !stage || !viewer || !playBtn) return;

  // clip URLs: listed in the partial's inert <template> so build.py can cache-bust them; plain paths as a fallback
  const URLS = {};
  const clipTpl = $("#real-clips", root);
  if (clipTpl && clipTpl.content) {
    $$("video", clipTpl.content).forEach((v) => {
      const src = v.getAttribute("src") || "";
      URLS[src.replace(/^.*\/|\.mp4.*$/g, "")] = { src, poster: v.getAttribute("poster") };
    });
  }
  const clip = (t, c) => {
    const name = `${t.id}_${c.key}`;
    return URLS[name] || { src: `static/video/real/${name}.mp4`, poster: `static/video/real/${name}.jpg` };
  };
  const trialName = (t, c) => `${t.name}, ${c.desc}: successful PrismWAM trial, ${c.uniform ? "2× speed" : "2× (6× during inference pauses)"}`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  const S = {
    task: 0, idx: 0,
    userPaused: reduced, visible: false, lbOpen: false, filmOpen: false, started: false,
  };
  const casesOf = (ti) => CASES[TASKS[ti].id] || [];

  // posters of a task's cases, fetched ahead (when its tab is pointed at, and in idle time once a clip plays),
  // so the cover is already there the moment the task is chosen
  const fetched = new Set();
  let fetchedAll = false;
  function prefetchTask(ti) {
    const t = TASKS[ti];
    casesOf(ti).forEach((c) => {
      const src = clip(t, c).poster;
      if (!src || fetched.has(src)) return;
      fetched.add(src);
      const im = new Image();
      im.decoding = "async";
      if ("fetchPriority" in im) im.fetchPriority = "low";
      im.src = src;
    });
  }

  // tabs
  const tabs = TASKS.map((t, i) => {
    const b = el("button", null, `<span>${t.name}</span>`);
    b.type = "button";
    b.id = `real-tab-${t.id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-controls", "real-panel");
    b.setAttribute("aria-selected", i === 0 ? "true" : "false");
    b.tabIndex = i === 0 ? 0 : -1;
    b.addEventListener("click", () => setTask(i, true));
    ["pointerenter", "focus", "touchstart"].forEach((ev) => b.addEventListener(ev, () => prefetchTask(i), { passive: true }));
    tabsEl.appendChild(b);
    return b;
  });
  const ind = $(".real-tabs-ind", tabsEl);
  function placeInd() {
    const b = tabs[S.task];
    if (!b || !ind) return;
    ind.style.width = b.offsetWidth + "px";
    ind.style.transform = `translateX(${b.offsetLeft}px)`;
    // on very narrow screens the strip may scroll: keep the active tab in view (strip only, never the page)
    if (tabsEl.scrollWidth > tabsEl.clientWidth + 1) {
      const l = b.offsetLeft - (tabsEl.clientWidth - b.offsetWidth) / 2;
      tabsEl.scrollTo({ left: Math.max(0, l), behavior: reduced ? "auto" : "smooth" });
    }
  }
  tabsEl.addEventListener("keydown", (e) => {
    const k = e.key;
    let i = S.task;
    if (k === "ArrowRight") i = (i + 1) % tabs.length;
    else if (k === "ArrowLeft") i = (i - 1 + tabs.length) % tabs.length;
    else if (k === "Home") i = 0;
    else if (k === "End") i = tabs.length - 1;
    else return;
    e.preventDefault();
    setTask(i, true);
    tabs[i].focus();
  });

  // rail: the in-distribution case, then the out-of-distribution cases. One button per slot, repainted per task;
  // a task with fewer cases hides its spare slot (the grid keeps its columns, so nothing moves)
  const NSLOT = Math.max(...TASKS.map((_, i) => casesOf(i).length));
  const thumbs = [];
  [["id", "In distribution", "ID"], ["ood", "Out of distribution", "OOD"]].forEach(([kind, label, short]) => {
    const g = el("div", "real-group real-group-" + kind);
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", label);
    const gl = el("p", "real-group-label", `<i></i><span class="real-gl-l">${label}</span><span class="real-gl-s">${short}</span>`);
    gl.setAttribute("aria-hidden", "true");
    g.appendChild(gl);
    const row = el("div", "real-thumbs");
    for (let i = 0; i < NSLOT; i++) {
      if ((i === 0) !== (kind === "id")) continue;
      const b = el("button", "real-thumb");
      b.type = "button";
      b.innerHTML = `<span class="real-thumb-img"><img alt="" width="960" height="540" loading="lazy" decoding="async" draggable="false"></span><span class="real-thumb-label"></span>`;
      b.addEventListener("click", () => setCase(i, { user: true }));
      row.appendChild(b);
      thumbs[i] = b;
    }
    g.appendChild(row);
    rail.appendChild(g);
  });
  rail.addEventListener("keydown", (e) => {
    const vis = thumbs.filter((b) => !b.hidden);
    const i = vis.indexOf(document.activeElement);
    if (i < 0) return;
    let j;
    if (e.key === "ArrowRight") j = (i + 1) % vis.length;
    else if (e.key === "ArrowLeft") j = (i - 1 + vis.length) % vis.length;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = vis.length - 1;
    else return;
    e.preventDefault();
    setCase(thumbs.indexOf(vis[j]), { user: true });
    vis[j].focus();
  });
  let thumbTok = 0;
  function paintThumbs(ti, animate) {
    const tok = ++thumbTok;
    const t = TASKS[ti], list = casesOf(ti);
    thumbs.forEach((b, i) => {
      const c = list[i];
      b.hidden = !c;
      if (!c) { b.tabIndex = -1; return; }
      if (canHover && c.kind === "ood") b.title = cap(c.desc); else b.removeAttribute("title");
      $(".real-thumb-label", b).textContent = c.short;
      const im = $("img", b);
      const src = clip(t, c).poster;
      if (im.getAttribute("src") === src) return;
      if (!animate || reduced) { im.src = src; return; }
      setTimeout(() => {
        if (tok !== thumbTok) return;
        im.classList.add("is-out");
        setTimeout(() => {
          if (tok !== thumbTok) return;
          im.src = src;
          const fin = () => { if (tok === thumbTok) im.classList.remove("is-out"); };
          if (im.complete) requestAnimationFrame(fin); else { im.addEventListener("load", fin, { once: true }); im.addEventListener("error", fin, { once: true }); }
        }, 170);
      }, i * 40);
    });
  }

  // info column: stacked per-task blocks (the cell is as tall as the tallest, so switching never reflows)
  const swapTitle = $("#real-swap-title", root), swapInstr = $("#real-swap-instr", root), swapCond = $("#real-swap-cond", root);
  TASKS.forEach((t, i) => {
    swapTitle.appendChild(el("div", "real-swap-item" + (i === 0 ? " is-on" : ""),
      `<h3 class="real-task-name">${t.name}</h3><p class="real-task-meta">${t.meta}</p>`));
    swapInstr.appendChild(el("blockquote", "real-swap-item real-quote" + (i === 0 ? " is-on" : ""),
      `<p>“${keepCompounds(INSTR[t.id] || "")}”</p>`));
    const c = COND[t.id] || {};
    swapCond.appendChild(el("dl", "real-swap-item real-cond-list" + (i === 0 ? " is-on" : ""),
      `<div><dt>ID</dt><dd>${keepCompounds(c.id || "")}</dd></div><div><dt>OOD</dt><dd>${keepCompounds(c.ood || "")}</dd></div>`));
  });
  $$(".real-swap-item", root).forEach((n) => { if (!n.classList.contains("is-on")) n.setAttribute("aria-hidden", "true"); });

  // per-task bars: one group per split (ID, OOD); the bars, percentages and k/n fractions carry the result.
  // The group that matches the clip on screen (ID or OOD case) is raised with a soft backdrop;
  // nothing dims, nothing moves.
  const taskBars = $("#real-task-bars", root);
  const tb = { head: el("div", "real-tb-head", `<p class="real-label">Success rate</p>`) };
  taskBars.appendChild(tb.head);
  tb.groups = SPLITS.map((sp) => {
    const g = el("div", "real-tb-group real-tb-group-" + sp.id);
    g.setAttribute("role", "img");
    const head = el("div", "real-tb-ghead", `<span class="real-tb-name"><i></i>${sp.name}</span>`);
    const rows = MODELS.map((m) => barRow(m, TASKS[0][m.id][sp.id]));
    g.append(head, ...rows);
    $$("*", g).forEach((n) => n.setAttribute("aria-hidden", "true"));
    taskBars.appendChild(g);
    return { sp, g, rows };
  });
  function paintTaskBars(ti, tween) {
    const t = TASKS[ti];
    tb.groups.forEach(({ sp, g, rows }) => {
      const o = t.openwam[sp.id], p = t.prismwam[sp.id];
      rows.forEach((r, k) => setBar(r, t[MODELS[k].id][sp.id], tween));
      g.setAttribute("aria-label",
        `${t.name}, ${sp.name.toLowerCase()}: OpenWAM ${o[0]} of ${o[1]} (${pctTxt(rate(o))}), PrismWAM ${p[0]} of ${p[1]} (${pctTxt(rate(p))}).`);
    });
  }

  /* ── the video ──
     Only the selected case has a <video> (and so a src and a preload). Choosing a case puts its poster up at once
     (the cover), so the choice answers immediately however slow the network is; the clip loads underneath and the
     cover lifts on its first frame. A clip that is still loading after a moment, or stalls, shows a small ring.
     Under reduced motion nothing plays by itself: the clip shows its own poster with the play button. */
  let cur = null, zTop = 1, showTok = 0, sweepT = 0, loadT = 0;
  const cover = $("#real-cover", viewer), coverImg = cover && $("img", cover);
  // a poster still on its way after a moment (a slow network): hide the previous case's picture until it arrives
  // (the plain cover and the ring show meanwhile), so a case's badge never sits over another case's frame;
  // a cached poster arrives within the grace and the switch looks as it always did
  let coverT = 0;
  if (coverImg) coverImg.addEventListener("load", () => { clearTimeout(coverT); coverImg.style.visibility = ""; });
  function coverOn(src) {
    if (!cover) return;
    if (coverImg.getAttribute("src") !== src) {
      coverImg.src = src;
      clearTimeout(coverT);
      if (coverImg.complete) coverImg.style.visibility = "";
      else coverT = setTimeout(() => { if (!coverImg.complete) coverImg.style.visibility = "hidden"; }, 120);
    }
    cover.classList.add("is-on");
  }
  function coverOff() { if (cover) cover.classList.remove("is-on"); }
  function settle() { clearTimeout(loadT); viewer.classList.remove("is-loading"); }
  // the clip should be playing but is not yet: the ring comes after a short grace, so a quick load never flashes it
  function pend(v) {
    clearTimeout(loadT);
    loadT = setTimeout(() => {
      if (v === cur && shouldPlay() && (!v.dataset.shown || v.readyState < 3)) viewer.classList.add("is-loading");
    }, 350);
  }
  function makeVideo(t, c) {
    const u = clip(t, c);
    const v = document.createElement("video");
    v.className = "real-vid";
    v.muted = true; v.defaultMuted = true; v.setAttribute("muted", "");
    v.playsInline = true; v.setAttribute("playsinline", "");
    v.setAttribute("disablepictureinpicture", "");
    v.width = 960; v.height = 540;
    v.preload = reduced ? "metadata" : "auto";
    if (reduced) v.poster = u.poster; // a representative frame; while touring the clip opens on its own first frame
    v.dataset.key = `${t.id}_${c.key}`;
    v.setAttribute("aria-label", trialName(t, c));
    v.addEventListener("ended", () => { if (v === cur) onEnded(); });
    v.addEventListener("playing", () => {
      v.dataset.shown = "1";
      if (v === cur) { settle(); loop(); }
      if (!fetchedAll) { fetchedAll = true; setTimeout(() => TASKS.forEach((_, i) => prefetchTask(i)), 2500); }
    });
    v.addEventListener("waiting", () => { if (v === cur) pend(v); });
    v.addEventListener("error", () => { if (v === cur) settle(); }); // the poster stays up
    ["loadedmetadata", "seeked", "pause", "timeupdate"].forEach((ev) => v.addEventListener(ev, () => { if (v === cur && !raf) paintProgress(); }));
    v.src = u.src;
    return v;
  }
  function release(v) {
    v.pause();
    v.removeAttribute("src");
    try { v.load(); } catch (err) { /* already gone */ }
    v.remove();
  }
  function show(restart) {
    const t = TASKS[S.task], c = casesOf(S.task)[S.idx];
    if (!c) return;
    if (cur && cur.dataset.key === `${t.id}_${c.key}`) {
      if (restart) { try { cur.currentTime = 0; } catch (err) { /* not seekable yet */ } }
      sync();
      return;
    }
    const u = clip(t, c);
    const tok = ++showTok;
    const old = $$(".real-vid", stage);
    old.forEach((x) => x.pause());
    const v = makeVideo(t, c);
    v.style.zIndex = ++zTop;
    v.classList.add("is-on");
    stage.appendChild(v);
    cur = v;
    clearTimeout(sweepT);
    if (reduced) old.forEach(release);
    else {
      coverOn(u.poster);
      sweepT = setTimeout(() => { if (tok === showTok) old.forEach(release); }, 200); // once the cover hides them
      const lift = () => { if (tok === showTok) coverOff(); };
      v.addEventListener("playing", () => {
        if ("requestVideoFrameCallback" in v) v.requestVideoFrameCallback(lift);
        setTimeout(lift, "requestVideoFrameCallback" in v ? 400 : 0); // in case no frame callback comes
      }, { once: true });
    }
    settle();
    paintProgress();
    sync();
  }

  function shouldPlay() {
    return !!cur && !S.userPaused && S.visible && !document.hidden && !S.lbOpen && !S.filmOpen;
  }
  function sync() {
    if (cur) {
      if (shouldPlay()) {
        if (cur.paused) {
          if (cur.ended) { try { cur.currentTime = 0; } catch (err) { /* ignore */ } }
          const p = cur.play();
          const v = cur;
          if (p && p.catch) p.catch((err) => {
            // autoplay refused (no user gesture yet): show the play button instead of a stuck pause button
            if (err && err.name === "NotAllowedError" && v === cur) { S.userPaused = true; paintPlay(); }
          });
        }
      } else if (!cur.paused) cur.pause();
    }
    loop();
    paintPlay();
    if (cur && shouldPlay() && (!cur.dataset.shown || cur.readyState < 3)) pend(cur); else settle();
  }

  // the clip's progress line: painted every frame while it plays, on events otherwise
  let raf = 0;
  function loop() {
    if (!raf && cur && !cur.paused) raf = requestAnimationFrame(frameTick);
  }
  function frameTick() {
    raf = 0;
    paintProgress();
    if (cur && !cur.paused && !document.hidden) raf = requestAnimationFrame(frameTick);
  }
  function paintProgress() {
    if (!stepFill) return;
    const d = cur ? cur.duration : 0;
    const p = d && isFinite(d) ? clamp(cur.currentTime / d, 0, 1) : 0;
    stepFill.style.transform = `scaleX(${p.toFixed(4)})`;
  }

  function onEnded() {
    // reduced motion: stop on the last frame (the play button replays it); otherwise the tour moves on
    if (reduced) { S.userPaused = true; paintPlay(); paintProgress(); return; }
    setCase(S.idx + 1, { restart: true });
  }

  /* ── state changes ── */
  function paintChrome() {
    const t = TASKS[S.task], c = casesOf(S.task)[S.idx];
    const isId = c.kind === "id";
    modeBadge.classList.toggle("is-ood", !isId);
    // clips cut at a flat 2× (the dark Disco Light trials, and Open Microwave's Block Distractors, which has no
    // inference pause long enough to speed up) say so; the others carry the 2× / 6× pair
    if (speedBadge) speedBadge.classList.toggle("is-uniform", !!c.uniform);
    modeL.textContent = isId ? "In distribution" : `Out of distribution · ${c.short}`;
    modeS.textContent = isId ? "In distribution" : `OOD · ${c.short}`;
    fitBadge();
    tb.groups.forEach(({ sp, g }) => g.classList.toggle("is-active", sp.id === c.kind));
    thumbs.forEach((b, i) => {
      const on = i === S.idx;
      b.classList.toggle("is-on", on);
      b.tabIndex = on ? 0 : -1; // one tab stop for the rail (roving, as the task tabs); arrow keys walk the cases
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    stage.dataset.case = `${t.id}_${c.key}`;
    paintProgress();
    paintPlay();
  }

  // The badge label must never lose its tail: when the long label would overflow, use the short one.
  // Measured in one task, so nothing paints in between.
  // Phones always use the short label, so the badge stays light over the frame.
  function fitBadge() {
    modeBadge.classList.remove("is-short");
    if (modeL.offsetParent !== null && (viewer.clientWidth < 480 || modeL.scrollWidth > modeL.clientWidth + 1)) modeBadge.classList.add("is-short");
  }

  function paintPlay() {
    const playing = !S.userPaused;
    playBtn.classList.toggle("is-paused", !playing);
    playBtn.setAttribute("aria-label", playing ? "Pause video" : "Play video");
  }

  // a user's choice of a case plays it (under reduced motion it is shown, and the play button plays it);
  // choosing the case already on screen resumes it rather than restarting it
  function setCase(ci, { user = false, restart = false } = {}) {
    const list = casesOf(S.task);
    ci = ((ci % list.length) + list.length) % list.length;
    const changed = ci !== S.idx;
    S.idx = ci;
    if (user && !reduced) S.userPaused = false;
    paintChrome();
    if (S.started) show(changed || restart); else sync();
    if (user && changed) announce();
  }

  function setTask(ti, user) {
    if (ti === S.task) return;
    const was = casesOf(S.task)[S.idx];
    S.task = ti;
    tabs.forEach((b, i) => {
      const on = i === ti;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    panel.setAttribute("aria-labelledby", tabs[ti].id);
    placeInd();
    // keep the out-of-distribution condition when the next task has it (comparing tasks); else start at its ID case
    const keep = was && was.kind === "ood" ? casesOf(ti).findIndex((c) => c.key === was.key) : -1;
    S.idx = Math.max(0, keep);
    if (user && !reduced) S.userPaused = false; // choosing a task chooses its case, which then plays (as a thumbnail does)
    paintThumbs(ti, true);
    $$(".real-swap", root).forEach((sw) => {
      $$(".real-swap-item", sw).forEach((n, i) => {
        const on = i === ti;
        n.classList.toggle("is-on", on);
        if (on) n.removeAttribute("aria-hidden"); else n.setAttribute("aria-hidden", "true");
      });
    });
    paintTaskBars(ti, true);
    paintChrome();
    if (S.started) show(true);
    if (user) announce();
  }

  function announce() {
    const t = TASKS[S.task], c = casesOf(S.task)[S.idx];
    live.textContent = `${t.name}, ${c.desc}.`;
  }

  function start() {
    if (S.started) return;
    S.started = true;
    show(false);
  }

  function togglePlay() {
    S.userPaused = !S.userPaused;
    if (!S.started) start();
    sync();
  }
  playBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePlay(); });

  // touch: a horizontal swipe steps through the task's cases; a tap (mouse click too) plays or pauses
  let sx = null, sy = null, swiped = false, swipeT = 0;
  stage.addEventListener("pointerdown", (e) => {
    swiped = false; // every gesture starts clean: a swipe never swallows the next real tap
    if (e.pointerType !== "mouse") { sx = e.clientX; sy = e.clientY; }
  });
  stage.addEventListener("pointerup", (e) => {
    if (sx == null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    sx = sy = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) {
      swiped = true;
      clearTimeout(swipeT);
      swipeT = setTimeout(() => { swiped = false; }, 400);
      setCase(S.idx + (dx < 0 ? 1 : -1), { user: true });
    }
  });
  stage.addEventListener("pointercancel", () => { sx = sy = null; });
  stage.addEventListener("click", () => {
    if (swiped) { swiped = false; return; }
    togglePlay();
  });

  // hold the clip while the shared lightbox (core.js) or the film modal (nav-hero.js) covers the page,
  // and while the tab is hidden
  const lb = document.getElementById("lightbox");
  if (lb && "MutationObserver" in window) {
    new MutationObserver(() => {
      const open = !lb.hidden;
      if (open === S.lbOpen) return;
      S.lbOpen = open;
      sync();
    }).observe(lb, { attributes: true, attributeFilter: ["hidden"] });
  }
  document.addEventListener("prism:film", (e) => { S.filmOpen = !!(e.detail && e.detail.open); sync(); });
  document.addEventListener("visibilitychange", sync);

  // page-wide model highlight: hovering a bar row lights that model up on every chart
  const HL_SEL = ".real-bar[data-model]";
  let hlCur = null;
  root.addEventListener("pointerover", (e) => {
    if (e.pointerType !== "mouse") return;
    const n = e.target.closest(HL_SEL);
    if (!n || n === hlCur) return;
    hlCur = n;
    P.hl.set(n.dataset.model, "real");
  });
  root.addEventListener("pointerout", (e) => {
    if (e.pointerType !== "mouse" || !hlCur) return;
    const to = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest(HL_SEL) : null;
    if (to === hlCur || (to && root.contains(to))) return; // the next pointerover takes over
    if (e.target.closest(HL_SEL) !== hlCur) return;
    hlCur = null;
    P.hl.clear("real");
  });

  // visibility: the clip plays only while the viewer is on screen; the first clip loads once the browser is near
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => {
      es.forEach((en) => { S.visible = en.isIntersecting; });
      if (S.visible) start();
      sync();
    }, { threshold: 0.35 }).observe(viewer);
    const near = new IntersectionObserver((es) => {
      if (!es.some((en) => en.isIntersecting)) return;
      near.disconnect();
      start();
    }, { rootMargin: "600px 0px" });
    near.observe(browser);
  } else {
    S.visible = true;
    start();
  }

  // initial paint
  paintThumbs(0, false);
  paintTaskBars(0, false);
  panel.setAttribute("aria-labelledby", tabs[0].id);
  paintChrome();
  placeInd();
  requestAnimationFrame(() => tabsEl.classList.add("is-ready"));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { placeInd(); fitBadge(); });
  let rzT = 0;
  window.addEventListener("resize", () => { clearTimeout(rzT); rzT = setTimeout(() => { placeInd(); fitBadge(); }, 60); });
  sync();
})();

/* PrismWAM — E. Real world, part 3: the real-robot pipeline (#real-pipe).
   The stages are an <ol> laid out by CSS grid. This script draws the wires in an SVG overlay from the stages'
   boxes, frames PrismWAM's nodes, and runs one loop (LOOP seconds): a glowing pulse travels each wire in pipeline
   order (the wire fills with soft light behind it, which fades once the signal lands), each stage lights as its signal
   arrives, the refined-depth tile fades to raw and wipes back to refined, and the rollout ticks fill. The three tiles
   play the whole recorded episode in step, independent of the loop. The loop and the clips run only on screen with the
   tab visible; hovering or focusing a stage holds the loop, lights that stage and its wires, and shows its one line in
   a small tip beside it (the same line is the stage's accessible name). The pause button in the card head holds everything (loop and clips) until pressed again. Stages
   are one tab stop (roving tabindex, arrow keys).
   Reduced motion: a static diagram (wires and ticks lit) on still images. Timings are a pure function of the loop clock. */
(function () {
  "use strict";
  const P = window.PRISM;
  const root = document.getElementById("real-pipe");
  if (!P || !root) return;
  const { $, $$, reduced } = P;
  const stage = $("#rp-stage", root), wires = $("#rp-wires", root), frame = $(".rp-model", root);
  const wipe = $("#rp-wipe", root);
  if (!stage || !wires || !frame) return;
  const NS = "http://www.w3.org/2000/svg";
  const STACK = window.matchMedia("(max-width: 1000px)"); // = real.css: two columns, top to bottom

  const nodes = {};
  $$(".rp-node", root).forEach((n) => { nodes[n.dataset.k] = n; });
  const MODEL = ["rgbs", "goal", "depths", "act"];

  // action-chunk comb: one tick per command, t+1 … t+32
  const comb = $('[data-ticks="cmd"]', root);
  if (comb && !comb.children.length) comb.innerHTML = "<b></b>".repeat(32);
  const ticks = {
    rgb: $$('[data-ticks="rgb"] b', root),
    depth: $$('[data-ticks="depth"] b', root),
    cmd: comb ? $$("b", comb) : [],
  };

  /* ── timeline (seconds within the loop) ── */
  const LOOP = 7.8;
  // wire: from → to, colour, pulse [start, duration] (none for the training-only goal). The two camera wires share a
  // short stub before they split (split: their glow starts past the split, and the depth pulse leaves 0.15 s after the
  // RGB one), so an orange and a blue glow never stack into a pale one there
  const WIRES = [
    { a: "cam", b: "rgb", c: "warm", p: [0.5, 0.6], split: true },
    { a: "cam", b: "raw", c: "cool", p: [0.65, 0.6], split: true },
    { a: "raw", b: "refine", c: "cool", p: [1.6, 0.5] },
    { a: "refine", b: "refined", c: "cool", p: [2.55, 0.5] },
    { a: "rgb", b: "rgbs", c: "warm", p: [2.75, 1.15] },
    { a: "refined", b: "depths", c: "cool", p: [3.45, 0.45] },
    { a: "rgbs", b: "goal", c: "warm", dash: true },
    { a: "rgbs", b: "depths", c: "warm", p: [4.3, 0.45] },
    { a: "depths", b: "act", c: "cool", p: [5.45, 0.45] },
    { a: "act", b: "cmd", c: "acc", p: [6.05, 0.4] },
    { a: "cmd", b: "robot", c: "acc", p: [6.75, 0.4] },
  ];
  // when each stage is lit
  const LIT = {
    cam: [0, 1.0], rgb: [1.05, 2.6], raw: [1.2, 2.2], refine: [2.05, 3.2], refined: [3.0, 4.2],
    rgbs: [3.85, 5.0], depths: [3.85, 6.0], act: [5.85, 6.85], cmd: [6.4, 7.5], robot: [7.1, LOOP], model: [3.85, 6.85],
  };
  const T_RGB = [3.9, 0.07, 5.0];   // history ticks light one by one from 3.9 s, 70 ms apart, until 5.0 s
  const T_DEPTH = [4.75, 0.085];    // predicted depth ticks fill from 4.75 s (stay until the loop restarts)
  const T_CMD = [6.4, 0.5];         // the 32-command comb fills over 0.5 s
  const T_FADE = [1.85, 0.3];       // refined tile fades to raw…
  const T_WIPE = [3.0, 0.8];        // …and wipes back to refined as the refined signal lands
  // the pulse: dash layers ending at the head (px), a glowing head, and how long the glow lingers after landing (s)
  const LAYERS = [["p-halo", 42], ["p-tail", 64], ["p-core", 18]];
  const HEAD_R = 14, HEAD_OUT = 0.3, FILL_OUT = 0.6;

  const inWin = (t, w) => t >= w[0] && t < w[1];
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  /* ── SVG wires ── */
  const el = (tag, attrs) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  if (!reduced) {
    // one radial glow per colour for the pulse heads (stop colours come from real.css)
    const defs = el("defs", {});
    ["warm", "cool", "acc"].forEach((c) => {
      const g = el("radialGradient", { id: `rp-glow-${c}`, class: `rp-gr w-${c}` });
      [[0, 1, "s-0"], [0.2, 1], [0.46, 0.42], [1, 0]].forEach(([o, a, k]) => g.appendChild(el("stop", { offset: o, "stop-opacity": a, ...(k ? { class: k } : {}) })));
      defs.appendChild(g);
    });
    wires.appendChild(defs);
  }
  WIRES.forEach((w) => {
    w.base = el("path", { class: `rp-wire w-${w.c}` + (w.dash ? " is-dash" : "") });
    w.arrow = el("path", { class: `rp-arrow w-${w.c}` });
    wires.append(w.base, w.arrow);
  });
  // pulses above every wire, so a glow never sits under a neighbouring line
  WIRES.forEach((w) => {
    if (!w.p || reduced) return;
    w.pulse = el("g", { class: `rp-pulse w-${w.c}` });
    w.bloom = el("path", { class: "p-bloom" });
    w.fill = el("path", { class: "p-fill" });
    w.layers = LAYERS.map(([c, n]) => ({ n, el: el("path", { class: c }) }));
    w.head = el("circle", { class: "p-head", r: HEAD_R, fill: `url(#rp-glow-${w.c})` });
    w.headAt = -1;
    w.pulse.append(w.bloom, w.fill, ...w.layers.map((q) => q.el), w.head);
    wires.appendChild(w.pulse);
  });

  // boxes relative to the stage (both share any reveal transform, so differences stay exact)
  function boxes() {
    const s = stage.getBoundingClientRect(), R = {};
    for (const k in nodes) {
      const r = nodes[k].getBoundingClientRect();
      const l = r.left - s.left, t = r.top - s.top;
      R[k] = { l, t, r: l + r.width, b: t + r.height, w: r.width, h: r.height, cx: l + r.width / 2, cy: t + r.height / 2 };
    }
    return R;
  }
  const mid = (v, lo, hi) => v >= lo + (hi - lo) * 0.2 && v <= hi - (hi - lo) * 0.2;
  const GAP0 = 3, GAP1 = 4, RAD = 9, AH = 6, AW = 3.6;

  // orthogonal route from A to B: straight when the two overlap across the flow, else one rounded elbow
  function route(A, B) {
    let dir;
    if (B.l >= A.r - 1) dir = "r"; else if (B.r <= A.l + 1) dir = "l";
    else if (B.t >= A.b - 1) dir = "d"; else dir = "u";
    const hz = dir === "r" || dir === "l";
    const sg = dir === "r" || dir === "d" ? 1 : -1;
    let p0, p1, q0, q1; // along-flow start/end, cross-flow start/end
    if (hz) {
      p0 = dir === "r" ? A.r + GAP0 : A.l - GAP0; p1 = dir === "r" ? B.l - GAP1 : B.r + GAP1;
      if (mid(A.cy, B.t, B.b)) q0 = q1 = A.cy; else if (mid(B.cy, A.t, A.b)) q0 = q1 = B.cy; else { q0 = A.cy; q1 = B.cy; }
    } else {
      p0 = dir === "d" ? A.b + GAP0 : A.t - GAP0; p1 = dir === "d" ? B.t - GAP1 : B.b + GAP1;
      if (mid(A.cx, B.l, B.r)) q0 = q1 = A.cx; else if (mid(B.cx, A.l, A.r)) q0 = q1 = B.cx; else { q0 = A.cx; q1 = B.cx; }
    }
    const pt = (p, q) => (hz ? `${p.toFixed(1)} ${q.toFixed(1)}` : `${q.toFixed(1)} ${p.toFixed(1)}`);
    let d, stub = 0; // stub: the run before the first bend, plus most of the bend (until two splitting wires part)
    if (Math.abs(q1 - q0) < 1) {
      d = `M${pt(p0, q0)} L${pt(p1, q0)}`;
    } else {
      const pm = (p0 + p1) / 2, s2 = q1 > q0 ? 1 : -1;
      const r = Math.min(RAD, Math.abs(q1 - q0) / 2, Math.abs(p1 - p0) / 2);
      d = `M${pt(p0, q0)} L${pt(pm - sg * r, q0)} Q${pt(pm, q0)} ${pt(pm, q0 + s2 * r)} L${pt(pm, q1 - s2 * r)} Q${pt(pm, q1)} ${pt(pm + sg * r, q1)} L${pt(p1, q1)}`;
      stub = Math.abs(pm - sg * r - p0) + 1.2 * r;
    }
    // arrowhead: tip just short of B, pointing along the flow
    const tip = p1 + sg * GAP1 * 0.5;
    const a = `M${pt(tip, q1)} L${pt(tip - sg * AH, q1 - AW)} L${pt(tip - sg * AH, q1 + AW)} Z`;
    return { d, a, stub };
  }

  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    if (!W || !H) return;
    wires.setAttribute("width", W); wires.setAttribute("height", H);
    wires.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const R = boxes();
    // PrismWAM frame around its four nodes
    const pad = STACK.matches ? 9 : 12;
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    MODEL.forEach((k) => { const q = R[k]; l = Math.min(l, q.l); t = Math.min(t, q.t); r = Math.max(r, q.r); b = Math.max(b, q.b); });
    Object.assign(frame.style, { left: `${l - pad}px`, top: `${t - pad}px`, width: `${r - l + 2 * pad}px`, height: `${b - t + 2 * pad}px` });
    frame.classList.toggle("is-bottom", STACK.matches);
    WIRES.forEach((w) => {
      const { d, a, stub } = route(R[w.a], R[w.b]);
      w.base.setAttribute("d", d);
      w.arrow.setAttribute("d", a);
      if (w.pulse) {
        w.len = w.base.getTotalLength();
        w.lo = w.split ? Math.min(stub, w.len / 2) : 0; // glow starts here
        // every layer is one dash that ends at the head h: dash n at offset n − h covers [h − n, h]
        [w.bloom, w.fill].forEach((n) => { n.setAttribute("d", d); n.style.strokeDasharray = `${w.len} ${2 * w.len + 10}`; });
        w.layers.forEach((q) => { q.el.setAttribute("d", d); q.el.style.strokeDasharray = `${q.n} ${w.len + q.n + 10}`; });
        w.headAt = -1; // re-place the head on the next frame
      }
    });
    placeTip();
  }

  /* ── state painting (only touches what changed) ── */
  const cls = (el, c, on) => { if (el && el.classList.contains(c) !== on) el.classList.toggle(c, on); };
  let wipeW = -1, wipeO = -1, wipeS = -1;
  function setWipe(w, o, s) {
    if (!wipe) return;
    if (Math.abs(w - wipeW) > 0.001) { wipe.style.setProperty("--w", w.toFixed(4)); wipeW = w; }
    if (Math.abs(o - wipeO) > 0.001) { wipe.style.setProperty("--o", o.toFixed(3)); wipeO = o; }
    if (Math.abs(s - wipeS) > 0.001) { wipe.style.setProperty("--scan", s.toFixed(3)); wipeS = s; }
  }
  function paintTicks(fnRgb, fnDepth, fnCmd) {
    ticks.rgb.forEach((b, i) => cls(b, "is-on", fnRgb(i)));
    ticks.depth.forEach((b, i) => cls(b, "is-on", fnDepth(i)));
    ticks.cmd.forEach((b, i) => cls(b, "is-on", fnCmd(i)));
  }

  const setOp = (n, a) => { const v = a.toFixed(3); if (n._op !== v) { n.style.opacity = v; n._op = v; } };
  function hidePulse(w) { if (w.pulse && w.pulseOn) { w.pulse.style.opacity = "0"; w.pulseOn = false; } }

  // one frame of the loop at time t
  function render(t) {
    for (const k in nodes) cls(nodes[k], "is-lit", !!LIT[k] && inWin(t, LIT[k]));
    cls(frame, "is-lit", inWin(t, LIT.model));
    WIRES.forEach((w) => {
      if (!w.p) return;
      const x = (t - w.p[0]) / w.p[1];
      cls(w.base, "is-hot", x >= 0 && x < 1.6);
      cls(w.arrow, "is-hot", x >= 0.9 && x < 1.9);
      if (!w.pulse) return;
      const u = t - w.p[0] - w.p[1]; // time since the signal landed
      if (x < 0 || u >= FILL_OUT) { hidePulse(w); return; }
      const h = ease(Math.min(1, x)) * w.len;
      const aIn = clamp01(x / 0.08);
      const aHead = u <= 0 ? aIn : 1 - clamp01(u / HEAD_OUT);
      const aFill = u <= 0 ? aIn : 1 - ease(clamp01(u / FILL_OUT));
      if (Math.abs(h - w.headAt) > 0.05) {
        if (w.lo) {
          // past the split only: each layer is one dash over [max(lo, h − n), h] (none while the head is on the stub)
          const clip = (n, len) => {
            const D = h - Math.max(w.lo, h - len);
            n._on = D > 0.5;
            if (n._on) { n.style.strokeDasharray = `${D.toFixed(1)} ${2 * w.len + 10}`; n.style.strokeDashoffset = (D - h).toFixed(1); }
          };
          clip(w.fill, w.len); clip(w.bloom, w.len);
          w.layers.forEach((q) => clip(q.el, q.n));
        } else {
          w.fill.style.strokeDashoffset = w.bloom.style.strokeDashoffset = (w.len - h).toFixed(1);
          w.layers.forEach((q) => { q.el.style.strokeDashoffset = (q.n - h).toFixed(1); });
        }
        const pt = w.base.getPointAtLength(h);
        w.head.setAttribute("cx", pt.x.toFixed(1)); w.head.setAttribute("cy", pt.y.toFixed(1));
        w.headAt = h;
      }
      const on = (n, a) => (w.lo && !n._on ? 0 : a);
      setOp(w.fill, on(w.fill, aFill)); setOp(w.bloom, on(w.bloom, aFill));
      w.layers.forEach((q) => setOp(q.el, on(q.el, aHead)));
      setOp(w.head, aHead);
      if (!w.pulseOn) { w.pulse.style.opacity = "1"; w.pulseOn = true; }
    });
    paintTicks(
      (i) => t >= T_RGB[0] + i * T_RGB[1] && t < T_RGB[2],
      (i) => i > 0 && t >= T_DEPTH[0] + (i - 1) * T_DEPTH[1],
      (i) => t >= T_CMD[0] + (i / ticks.cmd.length) * T_CMD[1],
    );
    // refined tile: refined → (fade) raw → (wipe) refined — first loop only; afterwards it simply shows the refined clip
    let w = 1, o = 1, s = 0;
    if (S.refinedShown) { setWipe(1, 1, 0); return; }
    if (t >= T_FADE[0] && t < T_FADE[0] + T_FADE[1]) o = 1 - clamp01((t - T_FADE[0]) / T_FADE[1]);
    else if (t >= T_FADE[0] + T_FADE[1] && t < T_WIPE[0]) { w = 0; o = 1; }
    else if (t >= T_WIPE[0] && t < T_WIPE[0] + T_WIPE[1]) {
      const x = (t - T_WIPE[0]) / T_WIPE[1];
      w = ease(x); s = Math.min(1, x * 10, (1 - x) * 10);
    }
    if (w > 0.998) w = 1;
    setWipe(w, o, s);
    if (t >= T_FADE[0] - 0.05 && t < T_WIPE[0] + T_WIPE[1] + 0.05) drawRaw();
  }

  // the static diagram: reduced motion, paused, and the backdrop while one stage is inspected. Without a focused stage
  // the wires and ticks are lit and the stage outlines stay quiet (all ten lit at once is too busy)
  function renderStatic(focusK) {
    for (const k in nodes) cls(nodes[k], "is-lit", focusK ? k === focusK : false);
    cls(frame, "is-lit", !focusK);
    WIRES.forEach((w) => {
      const hot = focusK ? w.a === focusK || w.b === focusK : !w.dash;
      cls(w.base, "is-hot", hot); cls(w.arrow, "is-hot", hot);
      hidePulse(w);
    });
    paintTicks(() => true, () => true, () => true);
    setWipe(1, 1, 0);
  }
  // the quiet state before the loop first starts
  function renderRest() {
    for (const k in nodes) cls(nodes[k], "is-lit", false);
    cls(frame, "is-lit", false);
    WIRES.forEach((w) => { cls(w.base, "is-hot", false); cls(w.arrow, "is-hot", false); hidePulse(w); });
    paintTicks(() => false, () => false, () => false);
    setWipe(1, 1, 0);
  }

  /* ── raw copy under the refined tile (drawn from the raw clip, so the two never drift) ── */
  const canvas = $(".rp-under", root), ctx = canvas && canvas.getContext ? canvas.getContext("2d") : null;
  const rawV = $("#rp-v-raw", root);
  function drawRaw() {
    if (!ctx || !rawV || rawV.readyState < 2) return;
    try { ctx.drawImage(rawV, 0, 0, canvas.width, canvas.height); } catch (err) { /* not decodable yet */ }
  }
  if (ctx && rawV && rawV.poster) {
    const im = new Image();
    im.onload = () => { if (rawV.readyState < 2) ctx.drawImage(im, 0, 0, canvas.width, canvas.height); };
    im.src = rawV.poster;
  }

  /* ── clips: play together while visible, kept in step with the first one ── */
  const vids = $$("video.rp-v", root);
  if (reduced) {
    vids.forEach((v) => { if (v.dataset.still) v.poster = v.dataset.still; });
    if (ctx && rawV && rawV.dataset.still) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, canvas.width, canvas.height); im.src = rawV.dataset.still; }
  }
  const S = { vis: false, vidVis: false, hover: null, focus: null, film: false, started: false, user: false };
  function vidsShouldPlay() { return !reduced && !S.user && S.vidVis && !document.hidden && !S.film; }
  function syncVids() {
    if (vidsShouldPlay()) vids.forEach((v) => { if (v.paused) { const p = v.play(); if (p) p.catch(() => {}); } });
    else vids.forEach((v) => { if (!v.paused) v.pause(); });
  }
  // The clips (the whole 14.4 s episode, same length) follow the RGB clip: a large offset is fixed with one seek, a
  // small one by easing the follower's playback rate (seeking every few frames would stutter), so all three show the
  // same frame. Checked on every presented RGB frame where supported, else on timeupdate.
  const master = vids[0];
  if (master && !reduced) {
    const SEEK = 0.25, SNAP = 0.005, GAIN = 2.5, MAXR = 0.12;
    const align = () => {
      const D = master.duration;
      if (!D || !isFinite(D) || master.paused || master.seeking) return;
      vids.forEach((v) => {
        if (v === master || v.readyState < 2 || v.seeking || v.paused) return;
        const d = ((v.currentTime - master.currentTime + D * 1.5) % D) - D / 2; // > 0: v runs ahead
        if (Math.abs(d) > SEEK) { v.playbackRate = 1; v.currentTime = master.currentTime; return; }
        const r = Math.abs(d) < SNAP ? 1 : 1 - Math.max(-MAXR, Math.min(MAXR, d * GAIN));
        if (Math.abs(v.playbackRate - r) > 0.004) v.playbackRate = r;
      });
    };
    if ("requestVideoFrameCallback" in master) {
      const onFrame = () => { align(); master.requestVideoFrameCallback(onFrame); };
      master.requestVideoFrameCallback(onFrame);
    } else master.addEventListener("timeupdate", align);
    vids.forEach((v) => v.addEventListener("playing", align));
  }

  /* ── loop clock ── */
  let clock = 0, last = 0, raf = 0;
  const inspected = () => S.hover || S.focus;
  function running() { return !reduced && !S.user && S.vis && !document.hidden && !S.film && !inspected(); }
  function tick(now) {
    raf = 0;
    if (!running()) { last = 0; return; }
    if (last) {
      const next = clock + Math.min(0.1, (now - last) / 1000);
      if (next >= LOOP) S.refinedShown = true;   // the raw → refined reveal plays on the first loop only
      clock = next % LOOP;
    }
    last = now;
    render(clock);
    raf = requestAnimationFrame(tick);
  }
  function kick() {
    syncVids();
    if (!raf && running()) { S.started = true; last = 0; raf = requestAnimationFrame(tick); }
  }

  /* ── inspect: hover (mouse) or focus (keyboard, tap) on a stage ── */
  // the inspected stage's line in a tip beside it: below the stage (and its hanging caption) when that fits inside the
  // diagram, else above; left edge flush with the stage's, clamped inside the diagram, caret pointing at the stage
  const tip = $("#rp-tip", root);
  let tipK = null;
  function placeTip() {
    if (!tip) return;
    const k = inspected(), n = k && nodes[k];
    if (!n) { cls(tip, "is-on", false); return; }
    if (tipK !== k) {
      const src = document.getElementById(`rp-d-${k}`);
      tip.innerHTML = src ? src.innerHTML : "";
      tip.style.setProperty("--c", getComputedStyle(n).getPropertyValue("--c"));
      tipK = k;
    }
    const s = stage.getBoundingClientRect(), W = stage.clientWidth, H = stage.clientHeight;
    const r = n.getBoundingClientRect();
    let l = r.left, t = r.top, rt = r.right, b = r.bottom;
    $$(".rp-cap, .rp-name", n).forEach((c) => {
      const q = c.getBoundingClientRect();
      l = Math.min(l, q.left); t = Math.min(t, q.top); rt = Math.max(rt, q.right); b = Math.max(b, q.bottom);
    });
    l -= s.left; rt -= s.left; t -= s.top; b -= s.top;
    const tw = tip.offsetWidth, th = tip.offsetHeight, G = 11, M = 4;
    const down = b + G + th <= H - M || (t - G - th < M && H - b >= t);
    const y = Math.max(M, Math.min(H - th - M, down ? b + G : t - G - th));
    const cx = (l + rt) / 2, x = Math.max(M, Math.min(W - tw - M, l)); // flush with the stage's left edge
    tip.style.left = `${Math.round(x)}px`; tip.style.top = `${Math.round(y)}px`;
    tip.style.setProperty("--ax", `${Math.round(Math.max(14, Math.min(tw - 14, cx - x)))}px`);
    cls(tip, "is-below", down); cls(tip, "is-above", !down);
    cls(tip, "is-on", true);
  }
  function applyInspect() {
    const k = inspected();
    cls(stage, "is-inspect", !!k);
    placeTip();
    if (k) renderStatic(k);
    else if (reduced || S.user) renderStatic(null);
    else if (S.started) render(clock);
    else renderRest();
    kick();
  }
  // a mouse click also focuses the stage; hover already covers the mouse, so that focus must not pin the stage
  // after the pointer leaves (keyboard focus and touch taps do inspect)
  let ptr = "", ptrT = -1e9;
  root.addEventListener("pointerdown", (e) => { ptr = e.pointerType; ptrT = performance.now(); }, true);
  document.addEventListener("keydown", () => { ptr = ""; }, true);
  // roving tabindex: the stages are one tab stop; arrow keys walk them in pipeline (DOM) order, Home / End jump
  const order = $$(".rp-node", root);
  const rove = (n) => order.forEach((m) => { m.tabIndex = m === n ? 0 : -1; });
  Object.values(nodes).forEach((n) => {
    const k = n.dataset.k;
    n.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") { S.hover = k; applyInspect(); } });
    n.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse" && S.hover === k) { S.hover = null; applyInspect(); } });
    n.addEventListener("focus", () => {
      rove(n);
      if (ptr === "mouse" && performance.now() - ptrT < 800) return;
      S.focus = k; applyInspect();
    });
    n.addEventListener("blur", () => { if (S.focus === k) { S.focus = null; applyInspect(); } });
    n.addEventListener("keydown", (e) => {
      const i = order.indexOf(n);
      let j = -1;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") j = Math.min(order.length - 1, i + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = Math.max(0, i - 1);
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = order.length - 1;
      if (j < 0) return;
      e.preventDefault();
      if (j !== i) order[j].focus();
    });
  });

  /* ── pause / play (WCAG 2.2.2): holds the loop and the clips; nothing moves under reduced motion, so no button ── */
  const playBtn = $("#rp-play", root);
  if (playBtn) {
    if (reduced) playBtn.hidden = true;
    else playBtn.addEventListener("click", () => {
      S.user = !S.user;
      playBtn.classList.toggle("is-paused", S.user);
      playBtn.setAttribute("aria-label", S.user ? "Play animation" : "Pause animation");
      applyInspect();
    });
  }

  /* ── visibility, resize, film modal ── */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((es) => { es.forEach((e) => { S.vis = e.isIntersecting; }); kick(); }, { threshold: 0.3 }).observe(stage);
    new IntersectionObserver((es) => { es.forEach((e) => { S.vidVis = e.isIntersecting; }); syncVids(); }, { threshold: 0.15 }).observe(stage);
  } else { S.vis = S.vidVis = true; }
  document.addEventListener("visibilitychange", kick);
  document.addEventListener("prism:film", (e) => { S.film = !!(e.detail && e.detail.open); kick(); });

  let rzRaf = 0;
  const relayout = () => { cancelAnimationFrame(rzRaf); rzRaf = requestAnimationFrame(layout); };
  if ("ResizeObserver" in window) new ResizeObserver(relayout).observe(stage);
  window.addEventListener("resize", relayout);
  if (STACK.addEventListener) STACK.addEventListener("change", relayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);

  layout();
  if (reduced) renderStatic(null); else renderRest();
  kick();
})();
