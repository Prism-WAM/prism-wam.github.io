/* PrismWAM — C. Method (#method).
   1) Video-synced stepper: method.mp4 drives five steps (per-step progress, click to seek, keyboard tabs).
   2) Chain-attention matrix: Training/Inference toggle, row hover/focus/tap explanations, linked to per-token
      hotspots on the architecture figure (the query's own tokens are ringed, the tokens it reads are outlined,
      the tokens it cannot read are faded). Only transform/opacity/colour change on interaction, so nothing reflows. */
(function () {
  "use strict";
  const P = window.PRISM;
  const root = document.getElementById("method");
  if (!P || !root) return;
  const { $, $$, clamp, reduced } = P;

  initTour();
  initMatrix();

  /* ───────────────────────── stepper ───────────────────────── */
  function initTour() {
    const tour = $("#mt-tour", root);
    const video = $("#mt-video", root);
    const strip = $("#mt-steps", root);
    if (!tour || !video || !strip) return;
    const playBtn = $("#mt-play", root);
    const glide = $(".mt-glide", strip);
    const caps = $$(".mt-cap-v", root);
    const scrub = $("#mt-scrub", root);
    const segs = scrub ? $$(".mt-seg i", scrub) : [];
    const hoverEl = scrub && $(".mt-hover", scrub);
    const hoverLab = scrub && $(".mt-hover-lab", scrub);
    const clockEl = $(".mt-clock-t", root);
    const narrow = window.matchMedia("(max-width: 999px)");
    const S = $$(".mt-step", strip).map((el) => ({
      el,
      title: $(".mt-title", el).textContent,
      start: parseFloat(el.dataset.start),
      end: parseFloat(el.dataset.end),
      still: parseFloat(el.dataset.still),
      fill: $(".mt-bar i", el),
    }));
    if (!S.length) return;
    const DUR = S[S.length - 1].end;

    let active = -1;
    let userPaused = reduced;     // reduced motion: never start on our own
    let inView = false;
    let raf = 0;
    let pending = null;           // step shown while a seek is in flight
    let pendingT = null;          // its target time (for the bars and the clock)
    let queuedTime = null;        // seek requested before it could be applied
    let wantPlay = false;         // resume after a deferred seek
    let stripHold = 0;            // pause strip auto-scroll while the user swipes it
    let lastClock = "";
    let blob = null, blobState = 0;   // 0 none · 1 loading · 2 ready
    let lastTarget = null;        // last seek we issued, verified on "seeked"
    let forceBlob = false;        // the stream claimed to be seekable but was not

    const mmss = (t) => { t = Math.max(0, Math.floor(t + 1e-3)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
    const stepAt = (t) => {
      for (let i = S.length - 1; i >= 0; i--) if (t >= S[i].start - 0.04) return i;
      return 0;
    };

    function placeGlide(animate) {
      if (!glide || active < 0 || narrow.matches) return;
      const el = S[active].el;
      if (!animate) glide.classList.add("no-anim");
      glide.style.height = el.offsetHeight + "px";
      glide.style.transform = `translate3d(0, ${el.offsetTop}px, 0)`;
      if (!animate) { void glide.offsetWidth; glide.classList.remove("no-anim"); }
    }

    function scrollStrip(i) {
      if (!narrow.matches || Date.now() < stripHold) return;
      const el = S[i].el;
      const left = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
      const max = strip.scrollWidth - strip.clientWidth;
      strip.scrollTo({ left: clamp(left, 0, Math.max(0, max)), behavior: reduced ? "auto" : "smooth" });
    }

    function setActive(i) {
      if (i === active) return;
      const first = active < 0;
      active = i;
      S.forEach((s, k) => {
        const on = k === i;
        s.el.setAttribute("aria-selected", on ? "true" : "false");
        s.el.tabIndex = on ? 0 : -1;
        s.el.classList.toggle("is-done", k < i);
      });
      caps.forEach((c, k) => c.classList.toggle("is-on", k === i));
      placeGlide(!first);
      scrollStrip(i);
    }

    function render() {
      const t = pendingT != null ? pendingT : video.currentTime || 0;
      const i = pending != null ? pending : stepAt(t);
      setActive(i);
      for (let k = 0; k < S.length; k++) {
        const s = S[k];
        const p = k < i ? 1 : k > i ? 0 : clamp((t - s.start) / (s.end - s.start), 0, 1);
        const tf = `scaleX(${p.toFixed(4)})`;
        s.fill.style.transform = tf;
        if (segs[k]) segs[k].style.transform = tf;
      }
      const c = mmss(t);
      if (c !== lastClock) {
        lastClock = c;
        if (clockEl) clockEl.textContent = c;
        if (scrub) {
          scrub.setAttribute("aria-valuenow", t.toFixed(1));
          scrub.setAttribute("aria-valuetext", `${c}, ${S[i].title}`);
        }
      }
    }

    function loop() {
      render();
      raf = video.paused ? 0 : requestAnimationFrame(loop);
    }
    const startLoop = () => { if (!raf) raf = requestAnimationFrame(loop); };

    function syncButton() {
      if (!playBtn) return;
      const playing = !video.paused;
      playBtn.dataset.state = playing ? "playing" : "paused";
      playBtn.setAttribute("aria-label", playing ? "Pause walkthrough" : "Play walkthrough");
    }

    function play() {
      if (queuedTime != null) { wantPlay = true; return; }  // resume once the seek lands
      if (video.readyState === 0) video.preload = "auto";
      const pr = video.play();
      if (pr && pr.catch) pr.catch(() => {});
    }

    const usingBlob = () => (video.currentSrc || "").startsWith("blob:");
    const canSeek = (t) => {
      if (forceBlob && !usingBlob()) return false;
      const r = video.seekable;
      for (let i = 0; i < r.length; i++) if (t >= r.start(i) - 0.01 && t <= r.end(i) + 0.01) return true;
      return false;
    };

    /* Some static servers (python -m http.server, used for staging and the current live site) ignore byte-range
       requests, and Chrome then cannot seek the stream at all. In that case fetch the clip once as a Blob
       (usually straight from the HTTP cache) and play from an object URL, which is always seekable. */
    function fetchBlob() {
      if (blobState) return;
      blobState = 1;
      const src = video.currentSrc || ($("source", video) || {}).src;
      fetch(src).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then((b) => { blob = URL.createObjectURL(b); blobState = 2; if (queuedTime != null) swapToBlob(); })
        .catch(() => { blobState = 0; tour.classList.remove("is-busy"); queuedTime = null; pending = pendingT = null; render(); });
    }
    function swapToBlob() {
      wantPlay = wantPlay || !video.paused;
      video.src = blob;   // re-runs the load algorithm; loadedmetadata applies queuedTime
    }

    function applyQueued() {
      if (queuedTime == null) return;
      if (canSeek(queuedTime)) {
        const t = queuedTime; queuedTime = null;
        tour.classList.remove("is-busy");
        if (Math.abs(video.currentTime - t) < 0.03) { pending = pendingT = null; render(); }
        else { lastTarget = t; video.currentTime = t; }
        if (wantPlay) { wantPlay = false; play(); }
      } else if (video.readyState >= 1) {
        tour.classList.add("is-busy");
        if (!video.paused) { wantPlay = true; video.pause(); }
        if (blobState === 2) swapToBlob(); else fetchBlob();
      }
    }

    function seek(t, showStep) {
      t = clamp(t, 0, DUR - 0.05);
      pending = showStep != null ? showStep : stepAt(t);
      pendingT = t;
      render();
      queuedTime = t;
      if (video.readyState >= 1) applyQueued();
      else if (video.preload !== "auto" || video.networkState === 3) { video.preload = "auto"; video.load(); }
    }

    // Jump to a step: seek to its start and play. Reduced motion: if the user has started playback, keep playing
    // from the step's start; otherwise show the step's representative frame and stay paused.
    function go(i) {
      const s = S[i];
      stripHold = 0;              // an explicit choice always centres its pill
      if (reduced) {
        if (!video.paused || wantPlay) { wantPlay = true; seek(s.start + 0.02, i); }
        else seek(s.still, i);
      } else {
        userPaused = false;
        wantPlay = true;
        seek(s.start + 0.02, i);
      }
      scrollStrip(i);             // also when the tapped pill was already the active one
    }

    video.addEventListener("loadedmetadata", applyQueued);
    video.addEventListener("progress", () => {
      // prefetch the seekable copy once the stream is fully buffered (then it comes from cache)
      const b = video.buffered;
      if (!blobState && b.length && b.end(b.length - 1) >= (video.duration || DUR) - 0.5 && !canSeek(DUR / 2)) fetchBlob();
    });
    video.addEventListener("seeked", () => {
      // A cached copy can make Chrome report the stream as seekable even though the server ignores ranges;
      // the seek then snaps back to the start. Detect that and switch to the Blob copy.
      if (lastTarget != null && queuedTime == null) {
        const missed = Math.abs(video.currentTime - lastTarget) > 0.75 && !usingBlob();
        const t = lastTarget;
        lastTarget = null;
        if (missed) { forceBlob = true; queuedTime = t; wantPlay = wantPlay || !video.paused; applyQueued(); return; }
      }
      if (queuedTime == null) pending = pendingT = null;
      render();
    });
    video.addEventListener("timeupdate", () => { if (!raf) render(); });
    video.addEventListener("play", () => { syncButton(); startLoop(); });
    video.addEventListener("pause", () => { syncButton(); render(); });
    video.addEventListener("click", () => toggle());

    function toggle() {
      if (video.paused && !wantPlay) { userPaused = false; play(); }
      else { userPaused = true; wantPlay = false; video.pause(); syncButton(); }
    }
    if (playBtn) playBtn.addEventListener("click", toggle);

    // steps: click to seek; arrow keys move between tabs (roving tabindex)
    S.forEach((s, i) => s.el.addEventListener("click", () => go(i)));
    strip.addEventListener("keydown", (e) => {
      const i = S.findIndex((s) => s.el === document.activeElement);
      if (i < 0) return;
      let j = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") j = (i + 1) % S.length;
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") j = (i - 1 + S.length) % S.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = S.length - 1;
      if (j == null) return;
      e.preventDefault();
      S[j].el.focus({ preventScroll: true });
      go(j);
    });
    // hold auto-centring only while the user is actually swiping or wheeling the strip (a tap is not a swipe)
    ["touchmove", "wheel"].forEach((ev) =>
      strip.addEventListener(ev, () => { stripHold = Date.now() + 4000; }, { passive: true }));

    // scrubber: click or drag to any moment; keeps the current play/pause state
    if (scrub) {
      const timeAt = (x) => {
        const r = scrub.getBoundingClientRect();
        return clamp((x - r.left) / r.width, 0, 1) * DUR;
      };
      const showHover = (x) => {
        if (!hoverEl) return;
        const r = scrub.getBoundingClientRect();
        const px = clamp(x - r.left, 0, r.width);
        const t = (px / r.width) * DUR;
        hoverEl.style.transform = `translate3d(${px.toFixed(1)}px, 0, 0)`;
        hoverLab.innerHTML = `<b>${mmss(t)}</b>${S[stepAt(t)].title}`;
        // keep the label inside the scrubber
        const w = hoverLab.offsetWidth;
        const lx = clamp(-w / 2, -px, r.width - px - w);
        hoverLab.style.setProperty("--lx", `${lx.toFixed(1)}px`);
        scrub.classList.add("is-hover");
      };
      let dragging = false, resumeAfter = false;
      scrub.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        dragging = true;
        resumeAfter = !video.paused || wantPlay;
        scrub.setPointerCapture(e.pointerId);
        if (resumeAfter) wantPlay = true;
        seek(timeAt(e.clientX));
      });
      scrub.addEventListener("pointermove", (e) => {
        if (e.pointerType === "mouse") showHover(e.clientX);
        if (dragging) seek(timeAt(e.clientX));
      });
      const end = () => { dragging = false; };
      scrub.addEventListener("pointerup", end);
      scrub.addEventListener("pointercancel", end);
      scrub.addEventListener("pointerleave", () => scrub.classList.remove("is-hover"));
      scrub.addEventListener("keydown", (e) => {
        const t = pendingT != null ? pendingT : video.currentTime;
        const i = stepAt(t);
        let n = null;
        if (e.key === "ArrowRight" || e.key === "ArrowUp") n = t + 2;
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") n = t - 2;
        else if (e.key === "PageDown") n = S[Math.min(i + 1, S.length - 1)].start + 0.02;
        else if (e.key === "PageUp") n = S[Math.max(i - 1, 0)].start + 0.02;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = S[S.length - 1].start + 0.02;
        else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(); return; }
        if (n == null) return;
        e.preventDefault();
        if (!video.paused) wantPlay = true;
        seek(n);
      });
    }

    // play only while the panel is on screen, and never against the user's own pause
    let filmOpen = false;         // the full film is playing in its modal: step aside
    let filmResume = false;       // we were playing when it opened
    const mayAutoplay = () => inView && !userPaused && !reduced && !filmOpen;
    if ("IntersectionObserver" in window) {
      new IntersectionObserver((es) => {
        es.forEach((e) => {
          inView = e.isIntersecting;
          if (mayAutoplay()) play();
          else if (!inView && !video.paused) video.pause();
        });
      }, { threshold: 0.35 }).observe(tour);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && !video.paused) video.pause();
      else if (!document.hidden && mayAutoplay()) play();
    });
    // the film modal announces itself on document ("prism:film" {open}); pause without counting as a user pause
    document.addEventListener("prism:film", (e) => {
      const open = !!(e.detail && e.detail.open);
      if (open === filmOpen) return;
      filmOpen = open;
      if (open) {
        filmResume = !video.paused || wantPlay;
        wantPlay = false;
        if (!video.paused) video.pause();
      } else {
        if (filmResume && mayAutoplay()) play();
        filmResume = false;
      }
    });

    const relayout = () => {
      strip.setAttribute("aria-orientation", narrow.matches ? "horizontal" : "vertical");
      placeGlide(false);
    };
    if (narrow.addEventListener) narrow.addEventListener("change", relayout);
    let rz = 0;
    window.addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => placeGlide(false)); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => placeGlide(false));

    relayout();
    render();
    syncButton();
  }

  /* ───────────────────────── chain-attention matrix ───────────────────────── */
  function initMatrix() {
    const mx = $("#mt-mx", root);
    const ex = $("#mt-ex", root);
    const crop = $("#mt-crop", root);
    if (!mx || !ex) return;

    const MOD = { rgb: "m-rgb", dep: "m-dep", act: "m-act" };
    // matrix token -> its hotspot key on the figure (the figure draws the action chunk a_{0..H} as one block)
    const HKEY = { r0: "r0", rF: "rF", d0: "d0", d1: "d1", dF: "dF", a1: "a", aH: "a" };
    const TOK = [
      { id: "r0", l: "r", s: "≤0", m: "rgb", plain: "r≤0" },
      { id: "rF", l: "r", s: "F", m: "rgb", plain: "rF" },
      { id: "d0", l: "d", s: "0", m: "dep", plain: "d0" },
      { id: "d1", l: "d", s: "1", m: "dep", plain: "d1" },
      { id: "dF", l: "d", s: "F", m: "dep", plain: "dF" },
      { id: "a1", l: "a", s: "1", m: "act", plain: "a1" },
      { id: "aH", l: "a", s: "H", m: "act", plain: "aH" },
    ];
    const T = Object.fromEntries(TOK.map((t, i) => [t.id, Object.assign(t, { i })]));
    const READS = {
      r0: ["r0"],
      rF: ["r0", "rF"],
      d0: ["r0", "d0"],
      d1: ["r0", "d0", "d1", "dF"],
      dF: ["r0", "d0", "d1", "dF"],
      a1: ["d0", "d1", "dF", "a1", "aH"],
      aH: ["d0", "d1", "dF", "a1", "aH"],
    };
    // one explanation per token group (d1/dF and a1/aH share theirs)
    const GROUP = { r0: "r0", rF: "rF", d0: "d0", d1: "d1", dF: "d1", a1: "a1", aH: "a1" };
    const EXPL = {
      r0: { toks: ["r0"], name: "Observed RGB", text: "History and current frames; reads only itself. Depth reads it for semantic context." },
      rF: { toks: ["rF"], name: "Future RGB goal", text: "Predicted in training only; learning it shapes the observed-RGB features that depth reads, so it is dropped at inference." },
      d0: { toks: ["d0"], name: "Current depth", text: "The initial physical state; also reads observed RGB for semantic guidance. The robot needs this depth image at test time." },
      d1: { toks: ["d1", "dF"], name: "Future depth", text: "The physical rollout; reads observed RGB, current depth and itself, but never the RGB goal." },
      a1: { toks: ["a1", "aH"], name: "Action chunk", text: "Reads depth and itself; no direct access to RGB." },
    };
    // inference: lanes after the RGB goal slide over by one cell (the whole grid then re-centres by half a cell)
    const shift = (i) => (i < 2 ? 0 : -1);
    const tokHTML = (t) => `<span class="tok"><i>${t.l}</i><sub>${t.s}</sub></span>`;

    /* build the grid */
    let html = `<div class="mt-mx-groups" aria-hidden="true"><span></span>` +
      `<span class="mt-g g-rgb">RGB</span><span class="mt-g g-dep">Depth</span><span class="mt-g g-act">Action</span></div>`;
    const COLNAME = { r0: "observed RGB", rF: "future RGB goal", d0: "current depth", d1: "future depth, first step", dF: "future depth, last step", a1: "action, first step", aH: "action, last step" };
    html += `<div class="mt-mx-head" aria-hidden="true"><span class="mt-corner" title="Each row (query, Q) attends to the filled columns (keys, K)"><i class="mt-k">K</i><i class="mt-q">Q</i></span>` +
      TOK.map((t) => `<span class="mt-ch ${MOD[t.m]} k-${t.id}" data-k="${t.id}" style="--sx:${shift(t.i)}" title="${t.plain}: ${COLNAME[t.id]}">${tokHTML(t)}</span>`).join("") +
      `</div>`;
    const ends = { rF: 1, dF: 1, aH: 1 };
    TOK.forEach((q) => {
      const reads = READS[q.id];
      const names = reads.map((k) => T[k].plain).join(", ");
      html += `<button type="button" class="mt-row ${MOD[q.m]} q-${q.id}${ends[q.id] ? " is-gend" : ""}" data-q="${q.id}"` +
        ` style="--sy:${shift(q.i)}" aria-pressed="false" aria-describedby="mt-ex-${GROUP[q.id]}"` +
        ` aria-label="Query ${q.plain} attends to ${names}">` +
        `<span class="mt-rl" aria-hidden="true">${tokHTML(q)}</span>` +
        TOK.map((k) => {
          const on = reads.includes(k.id);
          return `<span class="mt-c ${MOD[k.m]} k-${k.id}${on ? " on" : ""}" style="--sx:${shift(k.i)};--d:${q.i + k.i}" aria-hidden="true"><i></i></span>`;
        }).join("") +
        `</button>`;
    });
    mx.innerHTML = html;

    /* explanation states, stacked */
    const chip = (id) => `<span class="mt-tk ${MOD[T[id].m]}">${tokHTML(T[id])}</span>`;
    // notation: one compact line that spells out the matrix symbols (each item stays whole when it wraps)
    // a small two-row legend: token letters in matching chips, then what the subscripts mean
    const L = (m, l, label) => `<span class="mt-ni"><i class="mt-nl ${MOD[m]}">${l}</i>${label}</span>`;
    const S = (sub, label) => `<span class="mt-ni"><i class="mt-ns">${sub}</i>${label}</span>`;
    const notation = `<span class="mt-nrow"><span class="mt-nk">Tokens</span><span class="mt-nitems">${L("rgb", "r", "RGB")}${L("dep", "d", "depth")}${L("act", "a", "action")}</span></span>` +
      `<span class="mt-nrow"><span class="mt-nk">Subscripts</span><span class="mt-nitems">${S("≤0", "observed")}${S("1…F", "future steps")}${S("H", "action horizon")}</span></span>`;
    let exHTML =
      `<div class="mt-ex-v v-def is-on" data-v="def-train"><p class="mt-ex-name">Training</p>` +
      `<p class="mt-ex-txt">Each row is a group of tokens; a filled cell means that row can read that column.</p>` +
      `<p class="mt-ex-note">${notation}</p></div>` +
      `<div class="mt-ex-v v-def" data-v="def-inf"><p class="mt-ex-name">Inference</p>` +
      `<p class="mt-ex-txt">No future RGB is generated; the depth rollout and the actions are denoised together.</p>` +
      `<p class="mt-ex-note">${notation}</p></div>`;
    Object.keys(EXPL).forEach((g) => {
      const e = EXPL[g];
      const m = MOD[T[e.toks[0]].m];
      exHTML += `<div class="mt-ex-v ${m}" data-v="${g}" id="mt-ex-${g}">` +
        `<p class="mt-ex-name">${e.toks.map(chip).join("")}<span>${e.name}</span></p>` +
        `<p class="mt-ex-txt">${e.text}</p>` +
        `<p class="mt-ex-reads"><span>Reads</span>${READS[e.toks[0]].map(chip).join("")}</p></div>`;
    });
    ex.innerHTML = exHTML;

    const rows = $$(".mt-row", mx);
    const heads = $$(".mt-ch", mx);
    const views = $$(".mt-ex-v", ex);
    const segBtns = $$(".mt-mode button", root);
    const spots = crop ? $$(".mt-hs", crop) : [];

    let mode = "train";
    let hover = null, focus = null, pinned = null;
    let clearT = 0;
    // one tab stop for the whole grid; arrow keys move between rows (roving tabindex)
    let rove = "r0";
    const setRove = (id) => { rove = id; rows.forEach((r) => { r.tabIndex = r.dataset.q === id ? 0 : -1; }); };
    setRove("r0");

    function apply() {
      let q = hover || focus || pinned;
      if (mode === "inf" && q === "rF") q = null;
      mx.dataset.mode = mode;
      mx.classList.toggle("has-q", !!q);
      const reads = q ? READS[q] : [];
      rows.forEach((r) => {
        const id = r.dataset.q;
        r.classList.toggle("is-q", id === q);
        r.classList.toggle("is-pin", id === pinned);
        r.setAttribute("aria-pressed", id === pinned ? "true" : "false");
      });
      heads.forEach((h) => h.classList.toggle("is-read", reads.includes(h.dataset.k)));
      const v = q ? GROUP[q] : mode === "train" ? "def-train" : "def-inf";
      views.forEach((el) => el.classList.toggle("is-on", el.dataset.v === v));
      if (crop) {
        crop.dataset.mode = mode;
        // exactly READS[q] on the figure: q's own token(s) ringed, the rest of what it reads outlined, the rest faded
        const own = q ? HKEY[q] : null;
        const lit = new Set(reads.map((k) => HKEY[k]));
        spots.forEach((el) => {
          const k = el.dataset.t;
          el.classList.toggle("is-q", k === own);
          el.classList.toggle("is-read", !!q && k !== own && lit.has(k));
          el.classList.toggle("is-off", !!q && !lit.has(k));
        });
      }
    }

    function setMode(m) {
      if (m === mode) return;
      mode = m;
      segBtns.forEach((b) => {
        const on = b.dataset.mode === m;
        b.setAttribute("aria-selected", on ? "true" : "false");
        b.tabIndex = on ? 0 : -1;
      });
      const rF = rows.find((r) => r.dataset.q === "rF");
      if (rF) {
        if (m === "inf") rF.setAttribute("aria-hidden", "true"); else rF.removeAttribute("aria-hidden");
        if (m === "inf" && rove === "rF") setRove("r0");
        if (m === "inf" && document.activeElement === rF) rows[0].focus();
      }
      if (m === "inf" && pinned === "rF") pinned = null;
      apply();
    }

    segBtns.forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    const seg = $(".mt-mode", root);
    P.autoSeg(seg);
    if (seg) seg.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const next = mode === "train" ? "inf" : "train";
      const m = e.key === "Home" ? "train" : e.key === "End" ? "inf" : next;
      setMode(m);
      const b = segBtns.find((x) => x.dataset.mode === m);
      if (b) b.focus();
    });

    rows.forEach((r) => {
      const id = r.dataset.q;
      r.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch") return;
        clearTimeout(clearT); hover = id; apply();
      });
      r.addEventListener("pointerleave", (e) => {
        if (e.pointerType === "touch") return;
        clearTimeout(clearT);
        clearT = setTimeout(() => { hover = null; apply(); }, 90);
      });
      r.addEventListener("focus", () => { setRove(id); if (r.matches(":focus-visible")) { focus = id; apply(); } });
      r.addEventListener("blur", () => { if (focus === id) { focus = null; apply(); } });
      r.addEventListener("click", (e) => {
        e.stopPropagation();
        pinned = pinned === id ? null : id;
        if (!pinned && focus === id && e.detail > 0) focus = null; // mouse/tap un-pin clears it fully
        apply();
      });
    });
    // a click elsewhere un-pins, except inside the matrix card (e.g. the Training/Inference toggle), the figure or the readout
    document.addEventListener("click", (e) => {
      if (pinned && !e.target.closest("#mt-attn, #mt-crop, #mt-ex")) { pinned = null; apply(); }
    });
    mx.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && pinned) { pinned = null; apply(); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
      const live = rows.filter((r) => !(mode === "inf" && r.dataset.q === "rF"));
      const i = live.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      const j = e.key === "Home" ? 0 : e.key === "End" ? live.length - 1 : clamp(i + (e.key === "ArrowDown" ? 1 : -1), 0, live.length - 1);
      live[j].focus();
    });

    // figure: a transparent button over the image opens the shared lightbox. The <img> keeps its alt text for screen
    // readers; the button forwards the click to it (core's lightbox handles clicks on [data-zoom]) and gets focus
    // back when the lightbox closes.
    const img = crop && $("img", crop);
    const zoom = crop && $("#mt-zoom", crop);
    const lb = document.getElementById("lightbox");
    let opener = null;
    if (img && zoom) zoom.addEventListener("click", () => { opener = zoom; img.click(); });
    if (lb && "MutationObserver" in window) {
      new MutationObserver(() => {
        if (lb.hidden && opener) { const o = opener; opener = null; o.focus({ preventScroll: true }); }
      }).observe(lb, { attributes: true, attributeFilter: ["hidden"] });
    }

    // entrance: cells pop in along the diagonal the first time the matrix is seen
    if (!reduced && "IntersectionObserver" in window) {
      mx.classList.add("is-pre");
      P.onVisible(mx, () => {
        mx.classList.remove("is-pre");
        mx.classList.add("is-in");
        setTimeout(() => mx.classList.remove("is-in"), 1600);
      }, { threshold: 0.35 });
    }

    apply();
  }
})();
