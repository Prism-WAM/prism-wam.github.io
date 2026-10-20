/* PrismWAM — component A: floating nav (scroll-spy + sliding indicator), film hero, overview film card, film modal.
   Public hook: PRISM.film.open(t = 0) / PRISM.film.close(). Any element with [data-film="seconds"] also opens the film.
   Fires document event "prism:film" with detail {open: true|false} so other components can pause their media. */
(function () {
  "use strict";
  const P = window.PRISM;
  if (!P) return;
  const D = window.PRISM_DATA || {};
  const { $, $$, clamp, reduced, canHover } = P;

  const CHAPTERS = (D.CHAPTERS || []).slice().sort((a, b) => a.t - b.t);
  let filmDur = 133.2; // seconds; refined from the film's metadata once it loads

  const mmss = (s) => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const chEnd = (i) => (i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].t : filmDur);
  const chapterAt = (t) => { let k = 0; for (let i = 0; i < CHAPTERS.length; i++) if (t >= CHAPTERS[i].t - 0.2) k = i; return k; };
  const make = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const focusNoScroll = (el) => { if (!el) return; try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } };
  const scrollStripTo = (strip, item) => {
    const max = strip.scrollWidth - strip.clientWidth;
    if (max <= 1) return;
    const r = item.getBoundingClientRect(), b = strip.getBoundingClientRect();
    const left = strip.scrollLeft + (r.left - b.left) - (b.width - r.width) / 2;
    strip.scrollTo({ left: clamp(left, 0, max), behavior: reduced ? "auto" : "smooth" });
  };

  /* ═════════ film modal ═════════ */
  const film = (function () {
    const root = $("#film");
    if (!root) return { open() {}, close() {}, isOpen: () => false };
    const vid = $("#film-video", root);
    const closeBtn = $(".film-close", root);
    const strip = $(".film-chapters", root);
    const durEl = $(".film-dur", root);
    const seekHint = $(".film-seek", root), seekHintL = seekHint && $(".film-seek-l", seekHint), seekHintT = seekHint && $("b", seekHint);
    const failBox = $(".film-fail", root);
    let open = false, opener = null, hideTimer = 0, wantT = null, raf = 0, inerted = [], downOnScrim = false, activeI = -1;
    let pendingFallback = false, stallTimer = 0;
    const hint = (label, val) => { if (seekHintL) seekHintL.textContent = label; if (seekHintT) seekHintT.textContent = val; };

    const btns = CHAPTERS.map((c, i) => {
      const b = make("button", "film-ch");
      b.type = "button";
      b.dataset.i = i;
      b.setAttribute("aria-label", `${mmss(c.t)}, ${c.label}`);
      b.innerHTML = `<span class="film-ch-bar" aria-hidden="true"><i></i></span><span class="film-ch-t" aria-hidden="true">${mmss(c.t)}</span><span class="film-ch-l" aria-hidden="true">${esc(c.label)}</span>`;
      strip.appendChild(b);
      return b;
    });
    const fills = btns.map((b) => $(".film-ch-bar i", b));
    const setCols = () => {
      strip.style.setProperty("--cols", CHAPTERS.map((c, i) => `minmax(104px, ${Math.max(chEnd(i) - c.t, 1).toFixed(2)}fr)`).join(" "));
      if (durEl) durEl.textContent = mmss(filmDur);
    };
    setCols();

    function paint(tOverride) {
      if (!CHAPTERS.length) return;
      const t = tOverride != null ? tOverride : wantT != null ? wantT : vid.currentTime || 0;
      const k = chapterAt(t);
      if (k !== activeI) {
        activeI = k;
        btns.forEach((b, i) => {
          b.classList.toggle("is-active", i === k);
          b.classList.toggle("is-past", i < k);
          if (i === k) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
          if (i !== k) fills[i].style.transform = "";
        });
        if (open) scrollStripTo(strip, btns[k]);
      }
      const span = Math.max(chEnd(k) - CHAPTERS[k].t, 0.01);
      fills[k].style.transform = `scaleX(${clamp((t - CHAPTERS[k].t) / span, 0, 1).toFixed(4)})`;
    }
    const loop = () => { paint(); raf = requestAnimationFrame(loop); };
    vid.addEventListener("play", () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); });
    vid.addEventListener("pause", () => { cancelAnimationFrame(raf); paint(); });
    vid.addEventListener("seeked", () => paint());
    vid.addEventListener("loadedmetadata", () => {
      if (isFinite(vid.duration) && vid.duration > 0) { filmDur = vid.duration; setCols(); }
      trySeek();
      paint();
    });
    // Seek as soon as the target time is seekable. With HTTP Range support that is immediate; a server without it
    // (python -m http.server) only allows seeking into what has streamed so far, so we wait and jump when it arrives.
    // Safari refuses to stream at all without Range support: the element errors, and we play an in-memory copy instead.
    let blobState = 0; // 0 streaming, 1 fetching the whole film, 2 playing from a Blob, 3 fallback failed
    function trySeek() {
      if (wantT == null || vid.readyState < 1) return false;
      const s = vid.seekable;
      // Chrome reports [0, 0] when the server ignores Range: fetch the film once as a Blob (always seekable)
      if (blobState === 0 && wantT > 1 && (!s.length || s.end(s.length - 1) <= 1)) { blobFallback(); return false; }
      for (let i = 0; i < s.length; i++) {
        if (s.start(i) <= wantT + 0.05 && s.end(i) >= Math.min(wantT + 0.5, vid.duration || Infinity)) {
          try { vid.currentTime = wantT; } catch (e) { return false; }
          wantT = null;
          root.classList.remove("is-seeking");
          return true;
        }
      }
      return false;
    }
    function blobFallback() {
      blobState = 1;
      pendingFallback = false;
      const src = vid.currentSrc || ($("source", vid) || {}).src;
      if (!(wantT > 1)) hint("Loading the film", "0%");
      if (open) root.classList.add("is-seeking");
      vid.pause();
      // stop the element's own (unseekable) download while the Blob loads
      const sources = $$("source", vid);
      sources.forEach((n) => n.remove());
      vid.removeAttribute("src");
      vid.load();
      const restore = () => { sources.forEach((n) => vid.appendChild(n)); vid.load(); };
      fetch(src).then((r) => {
        if (!r.ok) throw new Error(r.status);
        const total = +r.headers.get("Content-Length") || 0;
        if (!r.body || !total || !window.ReadableStream) return r.blob();
        const reader = r.body.getReader(), parts = [];
        let got = 0;
        const pump = () => reader.read().then(({ done, value }) => {
          if (done) return new Blob(parts, { type: "video/mp4" });
          parts.push(value);
          got += value.length;
          const pct = Math.min(100, Math.round((100 * got) / total));
          if (wantT > 1) hint("Jumping to", `${mmss(wantT)} · ${pct}%`); else hint("Loading the film", `${pct}%`);
          if (open) root.classList.add("is-seeking");
          return pump();
        });
        return pump();
      }).then((blob) => {
        blobState = 2;
        if (!(wantT > 1)) root.classList.remove("is-seeking");
        vid.src = URL.createObjectURL(blob);
        vid.load();
        if (open) { const p = vid.play(); if (p && p.catch) p.catch(() => {}); }
      }).catch(() => {
        blobState = 3;
        wantT = null;
        root.classList.remove("is-seeking");
        restore();
        if (open) playIt();
      });
    }
    ["progress", "timeupdate", "canplay", "durationchange"].forEach((ev) => vid.addEventListener(ev, () => { if (wantT != null) trySeek(); if (vid.paused) paint(); }));

    // the film cannot play here at all: offer the file instead of a dead player
    function showFail() {
      wantT = null;
      root.classList.remove("is-seeking");
      root.classList.add("has-failed");
      try { vid.pause(); } catch (e) { /* ignore */ }
      vid.removeAttribute("controls");
      if (failBox) failBox.hidden = false;
    }
    // <source> errors don't bubble, so listen in the capture phase; decide once the element has settled
    function onMediaError() {
      setTimeout(() => {
        if (!(vid.error || vid.networkState === 3)) return; // a <source> failed but the element is still trying
        if (blobState === 1) return; // the in-memory copy is on its way
        if (blobState === 0) { if (open) blobFallback(); else pendingFallback = true; return; }
        showFail();
      }, 0);
    }
    vid.addEventListener("error", onMediaError, true);
    const playIt = () => {
      const p = vid.play();
      if (p && p.catch) p.catch((err) => { if (err && err.name === "NotSupportedError") onMediaError(); });
    };

    function seek(t, play) {
      t = clamp(Number(t) || 0, 0, Math.max(filmDur - 0.5, 0));
      wantT = t;
      vid.preload = "auto";
      if (!trySeek() && Math.abs(t - (vid.currentTime || 0)) > 1) {
        hint("Jumping to", mmss(t));
        root.classList.add("is-seeking");
      }
      if (play && !root.classList.contains("has-failed")) {
        vid.muted = false;
        playIt();
      }
      paint(t);
    }

    function lock(on) {
      const de = document.documentElement;
      if (on) {
        de.style.setProperty("--sbw", Math.max(0, window.innerWidth - de.clientWidth) + "px");
        de.classList.add("film-lock");
        inerted = Array.from(document.body.children).filter((n) => n !== root && !n.inert && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(n.tagName) && !n.classList.contains("tip"));
        inerted.forEach((n) => { n.inert = true; });
      } else {
        de.classList.remove("film-lock");
        de.style.removeProperty("--sbw");
        inerted.forEach((n) => { n.inert = false; });
        inerted = [];
      }
    }

    function openFilm(t = 0) {
      clearTimeout(hideTimer);
      if (!open) {
        open = true;
        const a = document.activeElement;
        opener = a && a !== document.body && !root.contains(a) ? a : null;
        lock(true);
        if (!vid.getAttribute("poster") && vid.dataset.poster) vid.poster = vid.dataset.poster;
        root.hidden = false;
        void root.offsetWidth; // start the enter transition from the hidden state
        root.classList.add("is-open");
        focusNoScroll(closeBtn);
        document.dispatchEvent(new CustomEvent("prism:film", { detail: { open: true } }));
      }
      if (pendingFallback && blobState === 0) blobFallback();
      else if (blobState === 1) root.classList.add("is-seeking");
      seek(t, true);
      // a browser that neither errors nor gets past "no data" after 8 s is stuck streaming: use the in-memory copy
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        if (open && blobState === 0 && vid.readyState === 0 && !root.classList.contains("has-failed")) blobFallback();
      }, 8000);
      requestAnimationFrame(() => { if (activeI >= 0) scrollStripTo(strip, btns[activeI]); });
    }

    function closeFilm() {
      if (!open) return;
      open = false;
      clearTimeout(stallTimer);
      vid.pause();
      wantT = null;
      root.classList.remove("is-seeking");
      root.classList.remove("is-open");
      lock(false);
      hideTimer = setTimeout(() => { root.hidden = true; }, reduced ? 0 : 400);
      if (opener && document.contains(opener)) focusNoScroll(opener);
      opener = null;
      document.dispatchEvent(new CustomEvent("prism:film", { detail: { open: false } }));
    }

    // backdrop click closes (only when the press also started on the backdrop, so drags out of the panel don't)
    root.addEventListener("pointerdown", (e) => { downOnScrim = e.target === root; });
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-film-close]")) { closeFilm(); return; }
      if (e.target === root && downOnScrim) { closeFilm(); return; }
      const b = e.target.closest(".film-ch");
      if (b) seek(CHAPTERS[+b.dataset.i].t, true);
    });
    document.addEventListener("keydown", (e) => {
      if (!open) return;
      if (e.key === "Escape") { e.preventDefault(); closeFilm(); return; }
      if (e.key !== "Tab") return;
      // focus trap (inert does most of the work; this covers browsers without it)
      const f = $$('button, [href], video[controls], [tabindex]:not([tabindex="-1"])', root).filter((n) => !n.disabled && n.getClientRects().length);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (!root.contains(cur)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    });

    return { open: openFilm, close: closeFilm, isOpen: () => open };
  })();

  P.film = { open: (t = 0) => film.open(t), close: () => film.close(), isOpen: () => film.isOpen() };

  // [data-film="seconds"] anywhere on the page opens the film (links keep the MP4 as a no-JS fallback)
  document.addEventListener("click", (e) => {
    const t = e.target.closest ? e.target.closest("[data-film]") : null;
    if (!t || t.closest("#film") || t.getAttribute("aria-disabled") === "true") return;
    if (e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    film.open(parseFloat(t.dataset.film) || 0);
  });

  /* ═════════ hero film: plays once (muted), holds the title frame; sound on demand ═════════ */
  (function hero() {
    const v = $("#hero-video");
    if (!v) return;
    const ctrl = $("#hero-ctrl");
    const btn = $("#hero-replay");
    const snd = $("#hero-sound");
    const ring = btn && $(".hero-ring-fg", btn);
    const C = 2 * Math.PI * 20;
    const END = "static/video/hero_end.jpg";
    const LABEL = { playing: "Pause the opening animation", paused: "Play the opening animation", ended: "Replay the opening animation" };
    let raf = 0, started = false;

    const setState = (s) => { if (!btn) return; btn.dataset.state = s; btn.setAttribute("aria-label", LABEL[s]); btn.title = LABEL[s].replace(" the opening animation", ""); };
    const ringTo = (p) => { if (ring) ring.style.strokeDashoffset = (C * (1 - clamp(p, 0, 1))).toFixed(2); };
    const tick = () => { if (v.duration) ringTo(v.currentTime / v.duration); raf = requestAnimationFrame(tick); };
    // not played (reduced motion, autoplay blocked, or unplayable): the title frame as a still, ring empty, "Play"
    const showStill = () => { v.poster = END; ringTo(0); setState("paused"); };
    const hideCtrl = () => { if (ctrl) ctrl.hidden = true; };
    const syncSound = () => {
      if (!snd) return;
      const on = !v.muted;
      snd.setAttribute("aria-pressed", String(on));
      snd.setAttribute("aria-label", on ? "Turn sound off" : "Turn sound on");
    };
    const play = (onFail) => { const p = v.play(); if (p && p.catch) p.catch(onFail || (() => {})); };

    const TOP = 24;
    const atTop = () => window.scrollY <= TOP;
    let autoPaused = false, foldDue = false;
    const canPlay = !!(v.canPlayType && v.canPlayType('video/mp4; codecs="avc1.640028"'));
    v.muted = true; // autoplay is always muted; sound only ever starts from the sound button
    syncSound();
    if (reduced || !canPlay) {
      // the markup has no autoplay attribute, so nothing can start before this runs
      try { v.pause(); } catch (e) { /* ignore */ }
      showStill();
      if (!canPlay) hideCtrl();
    } else {
      // the markup says preload="none" so reduced-motion visitors never download the clip
      v.preload = "auto";
      setState("playing");
      play(() => {
        if (!(v.paused && v.currentTime < 0.1)) return;
        showStill();
        // autoplay refused (phone low-power / data-saver modes, some in-app browsers): start on the first tap instead
        const kick = (e) => {
          if (started || (e && e.target && e.target.closest && e.target.closest(".hero-ctrl"))) return;
          v.poster = "static/video/hero_start.jpg";
          if (!atTop()) { autoPaused = true; return; }        // the tap ended a scroll: start once back at the top
          setState("playing"); play(() => showStill());
        };
        ["touchend", "pointerup", "keydown"].forEach((t) => document.addEventListener(t, kick, { once: true, passive: true }));
      });
      // WeChat's in-app browser only lets media start from its own bridge
      const wx = () => { if (!started) play(); };
      if (window.WeixinJSBridge && window.WeixinJSBridge.invoke) window.WeixinJSBridge.invoke("getNetworkType", {}, wx);
      else document.addEventListener("WeixinJSBridgeReady", () => { try { window.WeixinJSBridge.invoke("getNetworkType", {}, wx); } catch (e) { wx(); } }, { once: true });
    }

    // the film plays only while the reader stays at the top: scrolling on pauses it, coming back resumes it. So it can
    // only end (and fold) in front of the reader, never while they read further down.

    // portrait phones: the 16:9 film floats in a tall black screen; once it has played, the hero folds up to the film's
    // own height so the paper title below comes into view. Only ever at the top; otherwise it waits for the return.
    const heroEl = $("#top");
    const mqFold = window.matchMedia("(max-aspect-ratio: 6/5) and (max-width: 899.98px)");
    // status-bar tint (see .hero-tint in nav-hero.css): dark while the hero still covers the top of a phone screen
    const syncTint = () => {
      if (!heroEl) return;
      document.documentElement.classList.toggle("hero-tint", mqFold.matches && heroEl.getBoundingClientRect().bottom > 80);
    };
    addEventListener("scroll", syncTint, { passive: true });
    addEventListener("resize", syncTint);
    syncTint();
    const fold = () => {
      if (!heroEl || heroEl.classList.contains("is-folded") || !mqFold.matches) return;
      if (!atTop()) { foldDue = true; return; }
      if (reduced) { heroEl.classList.add("no-anim", "is-folded"); void heroEl.offsetWidth; heroEl.classList.remove("no-anim"); }
      else heroEl.classList.add("is-folded");
    };
    // wider screens: once the opening has played, glide down to the paper title (first time only, and only if the
    // reader is still at the top; a replay never pulls them away again)
    let revealed = false;
    const reveal = () => {
      if (revealed || !atTop()) return;
      revealed = true;
      const ov = document.getElementById("overview");
      if (ov) ov.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    };
    v.addEventListener("ended", () => setTimeout(() => (mqFold.matches ? fold() : reveal()), 700));

    let sraf = 0;
    window.addEventListener("scroll", () => {
      if (sraf) return;
      sraf = requestAnimationFrame(() => {
        sraf = 0;
        if (!atTop()) { if (!v.paused && !v.ended) { autoPaused = true; v.pause(); } return; }
        if (autoPaused) { autoPaused = false; play(); }
        if (foldDue) { foldDue = false; setTimeout(fold, 400); }
      });
    }, { passive: true });

    v.addEventListener("playing", () => { started = true; setState("playing"); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); });
    v.addEventListener("pause", () => { cancelAnimationFrame(raf); if (!v.ended) setState("paused"); });
    v.addEventListener("ended", () => { cancelAnimationFrame(raf); ringTo(1); setState("ended"); });
    v.addEventListener("volumechange", syncSound);
    // <source> errors don't bubble: listen in the capture phase and fall back to the title frame
    v.addEventListener("error", () => setTimeout(() => { if (v.networkState === 3 || v.error) { v.muted = true; showStill(); hideCtrl(); } }, 0), true);

    // step aside (paused and muted) while the full film plays, then carry on silently
    let resume = false;
    document.addEventListener("prism:film", (e) => {
      if (e.detail && e.detail.open) { resume = !v.paused && !v.ended; if (resume) v.pause(); v.muted = true; }
      else if (resume) { resume = false; play(); }
    });

    if (btn) btn.addEventListener("click", () => {
      const s = btn.dataset.state;
      v.preload = "auto";
      autoPaused = false;                                    // the reader's own choice wins over scroll pausing
      if (s === "playing") { v.pause(); return; }
      if (s === "ended") { try { v.currentTime = 0; } catch (e) { /* ignore */ } ringTo(0); }
      play();
    });

    // sound on: unmute; if the excerpt already ended (title frame held) or never played (reduced motion, blocked
    // autoplay), start it again from the beginning with sound; if paused midway, carry on. Sound off just mutes.
    if (snd) snd.addEventListener("click", () => {
      if (!v.muted) { v.muted = true; return; }
      v.muted = false;
      if (v.volume < 0.05) v.volume = 1;
      v.preload = "auto";
      if (v.ended || !started) { try { v.currentTime = 0; } catch (e) { /* ignore */ } ringTo(0); }
      if (v.paused) play((err) => { if (err && err.name === "NotAllowedError") v.muted = true; });
    });
  })();

  /* ═════════ overview stat chips + facts: computed from PRISM_DATA ═════════ */
  (function stats() {
    const M = D.MODELS || {}, B = D.BENCHMARKS || [];
    const ours = Object.keys(M).filter((id) => M[id].ours);
    const bestOf = (b) => Math.max(...ours.map((id) => (b.scores[id] != null ? b.scores[id] : -Infinity)));
    const f2 = (v) => Number(v).toFixed(2);
    const list = (a) => (a.length > 1 ? a.slice(0, -1).join(", ") + " and " + a[a.length - 1] : a[0] || "");
    // "#1 overall": benchmarks where PrismWAM's best beats every compared method, pretrained or not
    const top = B.filter((b) => { const best = bestOf(b); return Object.keys(b.scores).every((id) => (M[id] && M[id].ours) || b.scores[id] < best); });
    const topEl = $('.ov-stats [data-stat="top1"]');
    if (topEl && top.length) {
      // the label names its benchmarks in markup; fall back to plain computed names if the data no longer backs one of them
      const claimed = [...topEl.querySelectorAll("[data-bm]")].map((e) => e.dataset.bm);
      if (!claimed.length || claimed.some((id) => !top.some((b) => b.id === id))) topEl.textContent = `Overall on ${list(top.map((b) => b.short || b.name))}`;
      // the remaining benchmarks, claimed only where PrismWAM really leads the models without embodied action pretraining
      const rest = B.filter((b) => !top.includes(b) && Object.keys(b.scores).every((id) => (M[id] && (M[id].ours || M[id].pre)) || b.scores[id] < bestOf(b)));
      const lead = (b) => { const id = ours.filter((k) => b.scores[k] != null).sort((x, y) => b.scores[y] - b.scores[x])[0]; return `${b.name} ${f2(b.scores[id])}${id !== "prismwam" && M[id] ? ` (${M[id].name})` : ""}`; };
      topEl.closest("li").title = `Highest score of every compared method, including those with embodied action pretraining: ${top.map(lead).join("; ")}.` +
        (rest.length ? ` On ${list(rest.map((b) => b.name))} it is best among methods without embodied action pretraining.` : "");
    }

    const R = D.REAL_POOLED;
    let ood = null;
    if (R && R.prismwam && R.openwam) {
      const pct = (a) => (100 * a[0]) / a[1];
      const d = pct(R.prismwam.ood) - pct(R.openwam.ood);
      ood = $('.ov-stats [data-stat="ood"]');
      if (ood) {
        ood.textContent = `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
        ood.parentNode.title = `Pooled out-of-distribution success on the real robots: ${pct(R.prismwam.ood).toFixed(1)}% vs ${pct(R.openwam.ood).toFixed(1)}% (PrismWAM vs OpenWAM)`;
      }
    }
    if (!reduced && ood) P.onVisible(ood, () => P.countUp(ood, { duration: 1100 }), { threshold: 0.6 });
  })();

  /* ═════════ overview: hovering a stat card turns the film card into that stat's numbers; leaving brings the film back ═════════ */
  (function statPeek() {
    const card = $("#ov-film"), list = $(".ov-stats");
    if (!card || !list || !canHover) return;
    const M = D.MODELS || {}, B = D.BENCHMARKS || [];
    const nm = (id) => (M[id] ? M[id].name : id);
    const f2 = (v) => Number(v).toFixed(2);
    const panel = make("div", "ov-sp");
    panel.setAttribute("aria-live", "polite");
    card.appendChild(panel);
    const bm = (id) => B.find((b) => b.id === id);
    const bars = (rows, max, fmt) => `<ol class="ov-sp-rows">` + rows.map((r, i) =>
      `<li class="${r.cls || ""}" style="--w:${Math.max(1.5, (100 * r.v) / max).toFixed(1)}%;--i:${i}">` +
      `<span class="ov-sp-n">${esc(r.n)}</span><span class="ov-sp-bar"><i></i></span><b class="num">${fmt ? fmt(r) : f2(r.v)}</b></li>`).join("") + `</ol>`;
    const rowCls = (id) => (M[id] && M[id].ours ? "is-ours" : M[id] && M[id].pre ? "is-pre" : "");
    const legend = `<p class="ov-sp-key"><span class="is-ours"><i></i>PrismWAM</span><span><i></i>Other methods</span><span class="is-pre"><i></i>Embodied action pretraining</span></p>`;
    // a benchmark ladder: the top six, PrismWAM's rank among every compared method, and how it stands against the pretrained ones
    function ladder(id, sub) {
      const b = bm(id); if (!b) return "";
      const all = Object.entries(b.scores).sort((p, q) => q[1] - p[1]);
      const oursTop = all.findIndex(([k]) => M[k] && M[k].ours);
      const preBest = all.find(([k]) => M[k] && M[k].pre);
      const top = all.slice(0, 6).map(([k, v]) => ({ n: nm(k), v, cls: rowCls(k) }));
      const lead = oursTop >= 0 && preBest && all[oursTop][1] > preBest[1]
        ? `${nm(all[oursTop][0])} is ahead of every model with embodied action pretraining (best: ${nm(preBest[0])}, ${f2(preBest[1])}).` : "";
      return `<header class="ov-sp-h"><span><b>${esc(b.short || b.name)}</b><small>${esc(sub || b.metric + (b.unit === "%" ? " (%)" : ""))}</small></span>` +
        `<span class="ov-sp-rank">#${oursTop + 1} <small>of ${all.length}</small></span></header>` +
        bars(top, Math.max(b.hi || 0, all[0][1])) + legend + (lead ? `<p class="ov-sp-foot">${esc(lead)}</p>` : "");
    }
    function noPre() {
      const dojo = bm("dojo") || { scores: {} };
      const ids = Object.keys(M).filter((k) => M[k].hours != null && dojo.scores[k] != null && (M[k].pre || M[k].ours))
        .sort((p, q) => (M[q].hours - M[p].hours) || (dojo.scores[q] - dojo.scores[p]));
      const lg = (h) => Math.log10(1 + h) / 5.2;
      return `<header class="ov-sp-h"><span><b>Embodied action pretraining</b><small>Hours of robot-action data, and the RoboDojo score</small></span></header>` +
        `<ol class="ov-sp-rows ov-sp-hours">` + ids.map((k, i) =>
          `<li class="${rowCls(k)}" style="--w:${Math.max(1.5, 100 * lg(M[k].hours)).toFixed(1)}%;--i:${i}"><span class="ov-sp-n">${esc(nm(k))}</span>` +
          `<span class="ov-sp-bar"><i></i><em>${esc(M[k].hoursLabel || M[k].hours + " h")}</em></span><b class="num">${f2(dojo.scores[k])}</b></li>`).join("") + `</ol>` +
        `<p class="ov-sp-foot">PrismWAM is trained without any robot-action pretraining data.</p>`;
    }
    function real() {
      const R = D.REAL_POOLED; if (!R || !R.prismwam || !R.openwam) return "";
      const pct = (a) => (100 * a[0]) / a[1];
      const grp = (key, label) => {
        const o = R.openwam[key], q = R.prismwam[key], d = pct(q) - pct(o);
        return `<div class="ov-sp-grp"><p class="ov-sp-gh"><span>${label}</span><b class="num">${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}</b></p>` +
          bars([{ n: nm("openwam").replace("-α", ""), v: pct(o), t: o, cls: "is-pre" }, { n: "PrismWAM", v: pct(q), t: q, cls: "is-ours" }], 100,
            (r) => `${r.v.toFixed(1)}%<small>${r.t[0]}/${r.t[1]}</small>`) + `</div>`;
      };
      return `<header class="ov-sp-h"><span><b>Real-world success</b><small>Three tasks on physical arms, same trials for both</small></span></header>` +
        grp("id", "In distribution") + grp("ood", "Out of distribution") +
        `<p class="ov-sp-foot">Out-of-distribution trials change the lighting, add distractors, or alter object appearance.</p>`;
    }
    const VIEWS = [() => ladder("c2r", "Avg. success (%), clean and randomized scenes"), () => ladder("dojo", "Overall score, without the Agent track"), noPre, real];
    const items = [...list.children];
    let cur = -1, hideT = 0;
    function show(i) {
      clearTimeout(hideT);
      if (i === cur) return;
      cur = i;
      panel.innerHTML = VIEWS[i] ? VIEWS[i]() : "";
      panel.classList.remove("is-in"); void panel.offsetWidth;
      card.classList.add("is-peek"); panel.classList.add("is-in");
      items.forEach((li, k) => li.classList.toggle("is-peek", k === i));
    }
    function hide() {
      clearTimeout(hideT);
      hideT = setTimeout(() => { cur = -1; card.classList.remove("is-peek"); panel.classList.remove("is-in"); items.forEach((li) => li.classList.remove("is-peek")); }, 140);
    }
    items.forEach((li, i) => {
      li.tabIndex = 0;
      li.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") show(i); });
      li.addEventListener("focus", () => show(i));
    });
    list.addEventListener("pointerleave", hide);
    list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) hide(); });
  })();

  /* ═════════ overview: film card chapters ═════════ */
  (function filmCard() {
    const card = $("#ov-film");
    if (!card) return;
    const list = $(".ov-chapters", card), track = $(".ov-track", card);
    const peekT = $(".ov-peek-t", card), peekL = $(".ov-peek-l", card), dur = $(".ov-dur", card);
    if (dur) dur.textContent = mmss(filmDur);
    const rows = [], segs = [];
    // phones list only the four core chapters (the poster plays from 0:00; the player lists all of them)
    const KEY = ["The insight", "Three roles", "How it works", "Results"];
    const keyed = CHAPTERS.filter((c) => KEY.includes(c.label)).length >= 3;
    if (keyed) list.classList.add("is-keyed");
    CHAPTERS.forEach((c, i) => {
      const d = Math.max(chEnd(i) - c.t, 0.5);
      const seg = make("span", "ov-seg");
      seg.style.flex = `${d.toFixed(2)} 1 0`;
      track.appendChild(seg);
      segs.push(seg);
      const li = make("li", keyed && KEY.includes(c.label) ? "is-key" : "");
      const b = make("button", "ov-ch");
      b.type = "button";
      b.dataset.film = String(c.t);
      b.dataset.i = i;
      b.setAttribute("aria-haspopup", "dialog");
      b.setAttribute("aria-label", `Play from ${mmss(c.t)}, ${c.label}`);
      b.innerHTML = `<span class="ov-ch-t" aria-hidden="true">${mmss(c.t)}</span><span class="ov-ch-l" aria-hidden="true">${esc(c.label)}</span>` +
        `<span class="ov-ch-span" aria-hidden="true"><i style="--a:${((100 * c.t) / filmDur).toFixed(2)}%;--w:${((100 * d) / filmDur).toFixed(2)}%"></i></span>`;
      li.appendChild(b);
      list.appendChild(li);
      rows.push(b);
    });

    let hot = -1;
    function setHot(i) {
      if (i === hot) return;
      if (hot >= 0) { rows[hot].classList.remove("is-hot"); segs[hot].classList.remove("is-hot"); }
      hot = i;
      card.classList.toggle("has-hot", i >= 0);
      if (i < 0) return;
      rows[i].classList.add("is-hot");
      segs[i].classList.add("is-hot");
      peekT.textContent = mmss(CHAPTERS[i].t);
      peekL.textContent = CHAPTERS[i].label;
    }
    const rowOf = (n) => (n && n.closest ? n.closest(".ov-ch") : null);
    if (canHover) {
      list.addEventListener("pointerover", (e) => { const b = rowOf(e.target); if (b) setHot(+b.dataset.i); });
      list.addEventListener("pointerleave", () => { const f = rowOf(document.activeElement); setHot(f && list.contains(f) && f.matches(":focus-visible") ? +f.dataset.i : -1); });
    }
    list.addEventListener("focusin", (e) => { const b = rowOf(e.target); if (b && b.matches(":focus-visible")) setHot(+b.dataset.i); });
    list.addEventListener("focusout", (e) => { if (!list.contains(e.relatedTarget)) setHot(-1); });
  })();

  /* ═════════ nav: hero/solid state, scroll-spy, sliding indicator ═════════ */
  (function nav() {
    const nav = $("#nav");
    if (!nav) return;
    const tabsBox = $(".nav-tabs", nav), ind = $(".nav-ind", nav), ghost = $(".nav-ghost", nav);
    const tabs = $$(".nav-tab", nav);
    const hero = $("#top");
    const brand = $(".nav-brand", nav);
    const mqMobile = window.matchMedia("(max-width: 899.98px)");
    const items = tabs.map((tab) => ({ tab, id: decodeURIComponent(tab.hash.slice(1)), sec: null }));
    let darkSecs = [], active = -1, ghostOn = -1, locked = false, lockTimer = 0, ticking = false, threshold = 110;

    function refresh() {
      items.forEach((it) => { it.sec = document.getElementById(it.id); });
      darkSecs = $$(".sec-dark, #method .mt-tour, #decoupling .lab-vid, .ov-film");
      // a tab is active once its section's top passes the nav (+40px) — and never later than where an anchor jump
      // lands it (scroll-padding on <html> plus scroll-margin on the section), so a clicked tab stays active
      const navB = nav.getBoundingClientRect().bottom;
      const sp = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const sm = items.reduce((m, it) => (it.sec ? Math.max(m, parseFloat(getComputedStyle(it.sec).scrollMarginTop) || 0) : m), 0);
      threshold = Math.max(navB + 40, sp + sm + 8);
    }

    function place(el, tab, instant) {
      const r = tab.getBoundingClientRect(), b = tabsBox.getBoundingClientRect();
      const x = r.left - b.left + tabsBox.scrollLeft;
      if (instant) el.classList.add("no-anim");
      el.style.width = r.width.toFixed(1) + "px";
      el.style.transform = `translateX(${x.toFixed(1)}px)`;
      if (instant) { void el.offsetWidth; el.classList.remove("no-anim"); }
    }
    function paintInd(instant) {
      if (active < 0) { ind.classList.remove("is-on"); return; }
      place(ind, tabs[active], instant || !ind.classList.contains("is-on"));
      ind.classList.add("is-on");
    }
    function hideGhost() { ghost.classList.remove("is-on"); ghostOn = -1; }
    function showGhost(i) {
      if (i === active) { hideGhost(); return; }
      place(ghost, tabs[i], !ghost.classList.contains("is-on"));
      ghost.classList.add("is-on");
      ghostOn = i;
    }
    // mobile strip: centre the active tab, but never leave a sliver of the previous label at the left edge
    // (a few pixels of its last letter read as a stray stroke beside the logo); push that label fully under the fade
    function scrollNav(tab) {
      const max = tabsBox.scrollWidth - tabsBox.clientWidth;
      if (max <= 1) return;
      const b = tabsBox.getBoundingClientRect(), r = tab.getBoundingClientRect();
      let left = clamp(tabsBox.scrollLeft + (r.left - b.left) - (b.width - r.width) / 2, 0, max);
      tabs.forEach((t) => {
        const q = t.getBoundingClientRect();
        const textR = q.right - b.left + tabsBox.scrollLeft - (parseFloat(getComputedStyle(t).paddingRight) || 0);
        if (textR > left && textR - left < 40) left = Math.min(max, textR + 1);
      });
      tabsBox.scrollTo({ left, behavior: reduced ? "auto" : "smooth" });
    }
    function setActive(i) {
      if (i === active) return;
      active = i;
      tabs.forEach((t, k) => { if (k === i) t.setAttribute("aria-current", "location"); else t.removeAttribute("aria-current"); });
      paintInd(false);
      if (ghostOn === i) hideGhost();
      if (i >= 0 && mqMobile.matches) scrollNav(tabs[i]);
    }

    function update() {
      ticking = false;
      const nr = nav.getBoundingClientRect();
      // transparent only while the film sits untouched under the nav; once anything scrolls beneath it the pill
      // frosts (night-tinted over the hero and dark sections, white elsewhere), so text never overlaps text
      const pastHero = hero ? hero.getBoundingClientRect().bottom <= nr.bottom : true;
      const solid = pastHero || window.scrollY > 8;
      const state = solid ? "solid" : "hero";
      if (nav.dataset.state !== state) nav.dataset.state = state;
      // share of the bar's width that sits over dark surfaces (along its midline); most of it dark → night glass. A
      // mixed backdrop gets extra tint on top (--lg-mix), so one text colour stays readable across both halves
      let f = pastHero ? 0 : 1;
      if (solid && pastHero) {
        const y = nr.top + nr.height / 2, iv = [];
        darkSecs.forEach((s) => {
          const r = s.getBoundingClientRect();
          if (r.top > y || r.bottom <= y) return;
          const l = Math.max(r.left, nr.left), rt = Math.min(r.right, nr.right);
          if (rt > l) iv.push([l, rt]);
        });
        iv.sort((p, q) => p[0] - q[0]);
        let cov = 0, end = -Infinity;
        for (const [l, rt] of iv) { if (rt <= end) continue; cov += rt - Math.max(l, end); end = rt; }
        f = cov / nr.width;
      }
      const dark = f >= 0.65;
      const mix = (Math.round(Math.min(0.7, (dark ? 1 - f : f) * 1.8) * 50) / 50).toFixed(2);
      if (nav.style.getPropertyValue("--lg-mix") !== mix) nav.style.setProperty("--lg-mix", mix);
      const tone = dark ? "dark" : "light";
      if (nav.dataset.tone !== tone) nav.dataset.tone = tone;
      if (locked) return;
      let idx = -1;
      for (let k = 0; k < items.length; k++) { const s = items[k].sec; if (s && s.getBoundingClientRect().top <= threshold) idx = k; }
      // at the very bottom the last (short) section wins
      if (idx >= 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        for (let k = items.length - 1; k >= 0; k--) if (items[k].sec) { idx = k; break; }
      }
      setActive(idx);
    }

    // clicking a tab activates it at once and pauses the spy until the scroll settles
    function lockSpy() { locked = true; clearTimeout(lockTimer); lockTimer = setTimeout(unlock, 800); }
    function unlock() { locked = false; update(); }
    window.addEventListener("scroll", () => {
      if (locked) { clearTimeout(lockTimer); lockTimer = setTimeout(unlock, 200); }
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });

    tabs.forEach((t, k) => {
      t.addEventListener("click", () => { lockSpy(); setActive(k); hideGhost(); });
      if (canHover) t.addEventListener("pointerenter", () => showGhost(k));
      t.addEventListener("focus", () => { if (t.matches(":focus-visible")) showGhost(k); });
      t.addEventListener("blur", hideGhost);
    });
    if (canHover) tabsBox.addEventListener("pointerleave", hideGhost);
    if (brand) brand.addEventListener("click", () => { lockSpy(); setActive(-1); });

    // mobile strip: edge fades follow the scroll position
    function edges() {
      const max = tabsBox.scrollWidth - tabsBox.clientWidth;
      tabsBox.classList.toggle("is-scrolled", tabsBox.scrollLeft > 2);
      tabsBox.classList.toggle("at-end", max <= 2 || tabsBox.scrollLeft >= max - 2);
    }
    tabsBox.addEventListener("scroll", edges, { passive: true });

    let rz = 0;
    function relayout() {
      refresh();
      if (active >= 0) place(ind, tabs[active], true);
      hideGhost();
      edges();
      update();
      if (active >= 0 && mqMobile.matches) scrollNav(tabs[active]);
    }
    window.addEventListener("resize", () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(relayout); });
    if ("ResizeObserver" in window) {
      new ResizeObserver(() => { if (active >= 0) place(ind, tabs[active], true); edges(); }).observe($(".nav-list", nav));
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout);
    window.addEventListener("load", relayout);
    refresh();
    update();
    edges();
  })();
})();

/* ═════════ liquid glass nav ═════════
   Optics ported from Liquid Glass Studio (github.com/iyinchao/liquid-glass-studio, MIT, © Charles Yin), whose WebGL
   shader needs the backdrop as a texture; here the same model runs as an SVG filter used by backdrop-filter, so live
   page content refracts. Per pixel of a rounded-rect SDF:
   · refraction: inside the bezel the glass surface tilts; with x = 1 − d/T, θi = asin(x²), θt = asin(sin θi / n),
     the backdrop is sampled tan(θi − θt)·dist further inward along the normal, a sharp bend right at the rim;
   · dispersion: R / G / B bend by slightly different amounts (three displacement passes);
   · Fresnel: a thin white rim, (1 + h − d/1500·(500/range)²)⁵;
   · glare: the same band, strongest on the corner facing the light and weaker opposite, coloured by the refracted
     backdrop itself (saturated, lifted) rather than a flat white line. The dark bar uses a much fainter rim.
   Add ?tune to the URL for a parameter panel (bottom right). Chromium only; Safari / Firefox keep the plain frosted bar of the base styles. */
(function liquidGlass() {
  "use strict";
  const nav = document.getElementById("nav");
  const pill = nav && nav.querySelector(".nav-pill");
  if (!pill) return;
  const ua = navigator.userAgent;
  const chromium = /Chrome\/\d+/.test(ua) && !/Firefox|FxiOS/.test(ua);
  const PARAMS = [
    // key, label, min, max, step, default, geometry (needs the maps rebuilt)
    ["radius", "Corner radius", 4, 32, 1, 14, 1],
    ["T", "Bezel width", 2, 32, 1, 12, 1],
    ["n", "Refractive index", 1, 3, 0.05, 1.65, 1],
    ["dist", "Refraction distance", 0, 120, 1, 47, 1],
    ["chroma", "Dispersion", 0, 0.5, 0.01, 0.11, 0],
    ["blur", "Frost blur", 0, 12, 0.2, 1.6, 0],
    ["sat", "Saturation", 1, 2.5, 0.05, 1.5, 0],
    ["tintL", "Light tint", 0, 0.9, 0.01, 0.34, 0],
    ["tintD", "Dark tint", 0, 0.9, 0.01, 0.3, 0],
    ["fresnel", "Fresnel", 0, 1, 0.01, 0.2, 1],
    ["fresRange", "Fresnel width", 1, 100, 1, 30, 1],
    ["glare", "Glare", 0, 1.2, 0.01, 1.09, 1],
    ["glareRange", "Glare width", 1, 100, 1, 70, 1],
    ["glareAngle", "Glare angle", -180, 180, 1, -53, 1],
    ["conv", "Glare convergence", 0, 1, 0.01, 0.4, 1],
    ["opp", "Opposite glare", 0, 1, 0.01, 0.44, 1],
    ["rimD", "Dark-bar rim", 0, 1, 0.01, 0.15, 0],
  ];
  const DEF = Object.fromEntries(PARAMS.map((q) => [q[0], q[5]]));
  const GEO = new Set(PARAMS.filter((q) => q[6]).map((q) => q[0]));
  const tune = /[?&]tune\b/.test(location.search) || location.hash === "#tune";
  const KEY = "prism-lg";
  const P = { ...DEF };
  if (tune) { try { Object.assign(P, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) { /* storage off */ } }

  const spec = document.createElement("span");
  spec.className = "nav-spec"; spec.setAttribute("aria-hidden", "true");
  pill.appendChild(spec);

  const mkSvg = () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    document.body.appendChild(el);
    return el;
  };
  const svgEl = chromium ? mkSvg() : null;
  let maps = null;
  const KEEP = ["1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0", "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"];
  const lin = (sl, ic) => `<feFuncR type="linear" slope="${sl}" intercept="${ic}"/><feFuncG type="linear" slope="${sl}" intercept="${ic}"/><feFuncB type="linear" slope="${sl}" intercept="${ic}"/>`;
  // one glass filter: refraction (+ dispersion) → tint → Fresnel rim → backdrop-coloured glare
  function filter(id, m, o, tint, ta, rim, softGlare) {
    const img = (u, r) => `<feImage href="${u}" x="0" y="0" width="${m.w}" height="${m.h}" preserveAspectRatio="none" result="${r}"/>`;
    return `<filter id="${id}" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox" primitiveUnits="userSpaceOnUse" color-interpolation-filters="sRGB">` +
      img(m.mapU, "map") + img(m.fxU, "fx") +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="${o.blur}" result="soft"/>` +
      `<feColorMatrix in="soft" type="saturate" values="${o.sat}" result="src"/>` +
      [1 + o.chroma, 1, 1 - o.chroma].map((k, c) =>
        `<feDisplacementMap in="src" in2="map" scale="${(m.half * 2 * k).toFixed(2)}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/>` +
        `<feColorMatrix in="d${c}" type="matrix" values="${KEEP[c]}" result="c${c}"/>`).join("") +
      '<feBlend in="c0" in2="c1" mode="screen" result="c01"/><feBlend in="c01" in2="c2" mode="screen" result="refr"/>' +
      `<feFlood flood-color="${tint}" flood-opacity="${ta}" result="tint"/>` +
      '<feComposite in="tint" in2="refr" operator="over" result="glass"/>' +
      '<feColorMatrix in="refr" type="saturate" values="1.8" result="gsat"/>' +
      // glare colour: the backdrop lifted toward white (gently on the dark bar, so it never reads as a white outline)
      `<feComponentTransfer in="gsat" result="gcol">${softGlare ? lin(0.9, 0.12) : lin(0.4, 0.64)}</feComponentTransfer>` +
      `<feColorMatrix in="fx" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${rim} 0 0 0 0" result="gmask"/>` +
      '<feComposite in="gcol" in2="gmask" operator="in" result="glare"/>' +
      `<feColorMatrix in="fx" type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 ${rim} 0 0 0" result="fres"/>` +
      '<feMerge><feMergeNode in="glass"/><feMergeNode in="fres"/><feMergeNode in="glare"/></feMerge>' +
      "</filter>";
  }

  // displacement map (R, G) + rim masks (R glare, G Fresnel) for a w × h rounded rect with optics o
  function computeMaps(w, h, o, withSpec) {
    const r = Math.min(o.radius, h / 2);
    const T = Math.max(1, Math.min(o.T, h / 2 - 1));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const sw = Math.round(w * dpr), sh = Math.round(h * dpr);
    const offs = new Float32Array(sw * sh), nxs = new Float32Array(sw * sh), nys = new Float32Array(sw * sh);
    const mk = () => { const c = document.createElement("canvas"); c.width = sw; c.height = sh; return c; };
    const mapC = mk(), fxC = mk(), spC = withSpec ? mk() : null;
    const mapD = mapC.getContext("2d").createImageData(sw, sh), fxD = fxC.getContext("2d").createImageData(sw, sh);
    const spD = spC ? spC.getContext("2d").createImageData(sw, sh) : null;
    const hw = w / 2, hh = h / 2;
    const band = (d, range) => Math.min(1, Math.max(0, Math.pow(Math.max(0, 1.2 - (d / 1500) * Math.pow(500 / range, 2)), 5)));
    const A = (o.glareAngle * Math.PI) / 180;
    let maxOff = 0;
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const px = (x + 0.5) / dpr - hw, py = (y + 0.5) / dpr - hh;
      const qx = Math.abs(px) - (hw - r), qy = Math.abs(py) - (hh - r);
      const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;   // < 0 inside
      let nx = 0, ny = 0;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = qx / l; ny = qy / l; } else if (qx > qy) nx = 1; else ny = 1;
      nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;                                             // outward normal
      const d = Math.max(0, -sd), k = y * sw + x, i = k * 4;
      let off = 0;
      if (d < T) {
        const xr = 1 - d / T, ti = Math.asin(Math.min(1, xr * xr)), tt = Math.asin(Math.sin(ti) / o.n);
        off = o.dist * Math.tan(ti - tt);
        // never sample past the far side (the widest channel bends by 1 + dispersion)
        const room = Math.min(Math.abs(ny) > 1e-3 ? (h - d - 3) / Math.abs(ny) : 1e9, Math.abs(nx) > 1e-3 ? (w - d - 3) / Math.abs(nx) : 1e9);
        off = Math.max(0, Math.min(off, room / (1 + o.chroma)));
      }
      offs[k] = off; nxs[k] = nx; nys[k] = ny; if (off > maxOff) maxOff = off;
      const geoF = band(d, o.fresRange), geoG = band(d, o.glareRange);
      let g = 0;
      if (geoG > 0) {
        // Liquid Glass Studio's glare lobe, in its y-up angle convention
        let th = Math.atan2(-ny, nx); if (th < 0) th += 2 * Math.PI;
        const ga = (th - Math.PI / 4 + A) * 2;
        const far = (ga > Math.PI * 1.5 && ga < Math.PI * 3.5) || ga < -Math.PI * 0.5;
        g = (0.5 + Math.sin(ga) * 0.5) * (far ? 1.2 * o.opp : 1.2) * o.glare;
        g = Math.min(1, Math.pow(Math.max(0, g), 0.1 + o.conv * 2)) * geoG;
      }
      const f = geoF * o.fresnel;
      fxD.data[i] = Math.round(g * 255); fxD.data[i + 1] = Math.round(Math.min(1, f) * 255); fxD.data[i + 3] = 255;
      if (spD) { spD.data[i] = spD.data[i + 1] = spD.data[i + 2] = 255; spD.data[i + 3] = Math.round(Math.min(1, g + f) * 255); }
    }
    const half = Math.max(4, Math.ceil(maxOff));
    for (let k = 0, i = 0; k < sw * sh; k++, i += 4) {        // sample inward: P' = P + scale·(C − ½)
      mapD.data[i] = 128 - (nxs[k] * offs[k] / half) * 127; mapD.data[i + 1] = 128 - (nys[k] * offs[k] / half) * 127;
      mapD.data[i + 2] = 128; mapD.data[i + 3] = 255;
    }
    mapC.getContext("2d").putImageData(mapD, 0, 0); fxC.getContext("2d").putImageData(fxD, 0, 0);
    if (spC) spC.getContext("2d").putImageData(spD, 0, 0);
    return { w, h, half, mapU: chromium ? mapC.toDataURL() : "", fxU: chromium ? fxC.toDataURL() : "", specU: spC ? spC.toDataURL() : "" };
  }
  function buildMaps() {
    const w = Math.round(pill.offsetWidth), h = Math.round(pill.offsetHeight);
    if (!w || !h) return false;
    maps = computeMaps(w, h, P, true);
    spec.style.backgroundImage = `url(${maps.specU})`;
    return true;
  }
  function apply(geo) {
    pill.style.borderRadius = P.radius === DEF.radius ? "" : P.radius + "px";
    // Safari / Firefox cannot run SVG filters inside backdrop-filter: they keep the plain frosted bar from the base
    // styles (blur, tint, hairline). A painted rim on top looked smudged there, so they get no glass extras at all.
    if (!svgEl) return;
    if ((geo || !maps) && !buildMaps()) return;
    svgEl.innerHTML = filter("nav-lg-l", maps, P, "#ffffff", P.tintL, 1, false) + filter("nav-lg-d", maps, P, "#12141d", P.tintD, P.rimD, true);
    nav.classList.add("lg", "lg-spec");
  }
  let raf = 0, geoDirty = true;
  const schedule = (geo = true) => { geoDirty = geoDirty || geo; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { apply(geoDirty); geoDirty = false; }); };
  if ("ResizeObserver" in window) new ResizeObserver(() => schedule(true)).observe(pill); else window.addEventListener("resize", () => schedule(true));
  schedule(true);

  /* ?tune: a small parameter panel, bottom right; values persist in this browser and can be copied */
  if (!tune) return;
  const css = document.createElement("style");
  css.textContent = `
.lg-tune { position: fixed; right: 16px; bottom: 16px; z-index: 200; width: 290px; max-height: min(78vh, 720px); display: flex; flex-direction: column;
  font: 500 12px/1.3 var(--sans, system-ui); color: #1d1d24; background: rgba(255,255,255,.94); border: 1px solid rgba(0,0,0,.08);
  border-radius: 12px; box-shadow: 0 18px 50px -18px rgba(20,16,40,.35); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }
.lg-tune header { display: flex; align-items: center; gap: 6px; padding: 10px 12px; border-bottom: 1px solid rgba(0,0,0,.07); }
.lg-tune header b { flex: 1; font-size: 13px; font-weight: 650; white-space: nowrap; }
.lg-tune button { font: inherit; font-weight: 600; padding: 4px 8px; white-space: nowrap; border-radius: 7px; border: 1px solid rgba(0,0,0,.1); background: #fff; color: inherit; cursor: pointer; }
.lg-tune button:hover { background: #f3f0fc; }
.lg-tune .lg-body { overflow: auto; padding: 6px 12px 12px; }
.lg-tune.is-min .lg-body { display: none; }
.lg-tune label { display: grid; grid-template-columns: 1fr auto; gap: 2px 8px; padding: 6px 0 2px; }
.lg-tune label output { font-variant-numeric: tabular-nums; color: #6a5cc0; font-weight: 650; }
.lg-tune input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: #8577d4; margin: 2px 0 0; }
.lg-tune .lg-note { margin: 8px 0 0; color: #74747e; font-weight: 450; }`;
  document.head.appendChild(css);
  const box = document.createElement("section");
  box.className = "lg-tune"; box.setAttribute("aria-label", "Liquid glass parameters");
  box.innerHTML = `<header><b>Liquid glass</b><button type="button" data-a="copy">Copy values</button><button type="button" data-a="reset">Reset</button><button type="button" data-a="min" aria-label="Collapse panel">–</button></header>` +
    `<div class="lg-body">` + PARAMS.map(([k, label, mn, mx, st]) =>
      `<label>${label}<output data-o="${k}"></output><input type="range" min="${mn}" max="${mx}" step="${st}" data-k="${k}"></label>`).join("") +
    `<p class="lg-note">${chromium ? "Scroll over light and dark sections to compare. Values stay in this browser; Copy values gives the JSON to send back." : "Refraction needs Chrome or Edge; this browser shows the frosted fallback."}</p></div>`;
  document.body.appendChild(box);
  const fmt = (k, v) => { const st = PARAMS.find((q) => q[0] === k)[4]; return st >= 1 ? String(Math.round(v)) : (+v).toFixed(st < 0.1 ? 2 : 1); };
  const sync = () => box.querySelectorAll("input[data-k]").forEach((el) => { el.value = P[el.dataset.k]; box.querySelector(`[data-o="${el.dataset.k}"]`).textContent = fmt(el.dataset.k, P[el.dataset.k]); });
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) { /* storage off */ } };
  sync();
  box.addEventListener("input", (e) => {
    const k = e.target.dataset && e.target.dataset.k; if (!k) return;
    P[k] = parseFloat(e.target.value);
    box.querySelector(`[data-o="${k}"]`).textContent = fmt(k, P[k]);
    save(); schedule(GEO.has(k));
  });
  box.addEventListener("click", (e) => {
    const a = e.target.closest("button") && e.target.closest("button").dataset.a;
    if (a === "reset") { Object.assign(P, DEF); sync(); save(); schedule(true); }
    else if (a === "min") { box.classList.toggle("is-min"); e.target.textContent = box.classList.contains("is-min") ? "+" : "–"; }
    else if (a === "copy") {
      const txt = JSON.stringify(Object.fromEntries(PARAMS.map((q) => [q[0], +fmt(q[0], P[q[0]])])));
      const btn = e.target.closest("button");
      const done = () => { btn.textContent = "Copied"; setTimeout(() => { btn.textContent = "Copy values"; }, 1400); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(done, () => { window.prompt("Copy these values:", txt); });
      else window.prompt("Copy these values:", txt);
    }
  });
})();
