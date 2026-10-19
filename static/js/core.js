/* PrismWAM — shared runtime. Loaded after data.js and before every component script.
   Exposes window.PRISM with small helpers, a global model-highlight bus and a shared floating card. */
window.PRISM = (function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (v, d = 2) => (v == null ? "–" : Number(v).toFixed(d));
  // "π0.5" -> "π<sub>0.5</sub>" for HTML contexts
  const nameHTML = (n) => String(n).replace(/π(0\.5|0)/, "π<sub>$1</sub>");
  const SVGNS = "http://www.w3.org/2000/svg";
  const svg = (tag, attrs = {}, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Run fn once when el scrolls into view (immediately under reduced motion or without IO support).
  function onVisible(el, fn, { threshold = 0.2, rootMargin = "0px" } = {}) {
    if (!el) return;
    if (!("IntersectionObserver" in window)) return fn();
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { threshold, rootMargin });
    io.observe(el);
  }

  // Count a number up from 0 to its final text; the element is pre-sized to the final string so nothing shifts.
  function countUp(el, { duration = 900 } = {}) {
    const final = el.textContent.trim();
    const m = final.match(/^([^\d−-]*)([−-]?[\d,]*\.?\d+)(.*)$/);
    if (!m || reduced) return;
    const [, pre, numStr, post] = m;
    const target = parseFloat(numStr.replace(/,/g, "").replace("−", "-"));
    const decimals = (numStr.split(".")[1] || "").length;
    const comma = numStr.includes(",");
    el.style.display = "inline-block";
    el.style.minWidth = el.getBoundingClientRect().width + "px";
    const t0 = performance.now();
    const step = (t) => {
      const p = clamp((t - t0) / duration, 0, 1);
      const e = 1 - Math.pow(1 - p, 3);
      let v = (target * e).toFixed(decimals);
      if (comma) v = Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      el.textContent = pre + v + post;
      if (p < 1) requestAnimationFrame(step); else el.textContent = final;
    };
    el.textContent = pre + (0).toFixed(decimals) + post;
    requestAnimationFrame(step);
  }

  /* ── global model highlight bus ──
     PRISM.hl.set(id, source) highlights a model everywhere; PRISM.hl.clear() schedules a clear after 120 ms
     so sweeping the pointer between panels does not flicker. Sets <html data-hl="id"> for CSS, and fires a
     "prism:hl" CustomEvent with detail {id, source} for JS listeners. */
  const hl = (function () {
    let cur = null, timer = 0;
    const apply = (id, source) => {
      if (id === cur) return;
      cur = id;
      if (id) document.documentElement.dataset.hl = id; else delete document.documentElement.dataset.hl;
      document.dispatchEvent(new CustomEvent("prism:hl", { detail: { id, source } }));
    };
    return {
      set(id, source) { clearTimeout(timer); apply(id, source); },
      clear(source) { clearTimeout(timer); timer = setTimeout(() => apply(null, source), 120); },
      get: () => cur,
    };
  })();

  /* ── shared floating card ──
     PRISM.tip.show(html, x, y) positions a fixed card near the pointer, flipped to stay on screen.
     Only transform/opacity change, so the page never reflows. */
  const tip = (function () {
    let el = null;
    const ensure = () => {
      if (!el) { el = document.createElement("div"); el.className = "tip"; el.setAttribute("role", "tooltip"); document.body.appendChild(el); }
      return el;
    };
    return {
      show(html, x, y) {
        const t = ensure();
        if (html != null && t.__html !== html) { t.innerHTML = html; t.__html = html; }
        const w = t.offsetWidth, h = t.offsetHeight, pad = 14;
        let left = x + 18, top = y + 18;
        if (left + w > innerWidth - pad) left = x - w - 18;
        if (top + h > innerHeight - pad) top = innerHeight - h - pad;
        left = clamp(left, pad, innerWidth - w - pad);
        top = clamp(top, pad, innerHeight - h - pad);
        t.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
        t.classList.add("is-on");
      },
      hide() { if (el) el.classList.remove("is-on"); },
      el: ensure,
    };
  })();

  /* ── autoplay videos only while visible ──
     <video data-autoplay muted playsinline loop preload="none" poster=...> plays when ≥ 15% visible. */
  function initAutoplay(root = document) {
    const vids = $$("video[data-autoplay]", root);
    if (!vids.length) return;
    if (reduced || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => {
        const v = e.target;
        if (e.isIntersecting) { const p = v.play(); if (p) p.catch(() => {}); } else v.pause();
      });
    }, { threshold: 0.15 });
    vids.forEach((v) => io.observe(v));
  }

  function initReveal() {
    clearTimeout(window.__prismRevealFS); // template.html's failsafe: reveal everything if this never runs
    const els = $$(".reveal");
    if (reduced || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((es) => {
      es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    els.forEach((e) => io.observe(e));
  }

  function initCountUps() { $$("[data-countup]").forEach((el) => onVisible(el, () => countUp(el), { threshold: 0.6 })); }

  /* ── shared lightbox ──
     A modal dialog: while open, everything else in <body> is inert (as in the film modal), so Tab stays on its
     only control, the close button; Esc, a click anywhere or the button closes it and focus returns to the opener. */
  function initLightbox() {
    const lb = $("#lightbox");
    if (!lb) return;
    const img = $("img", lb), closeBtn = $(".lightbox-close", lb);
    let opener = null, inerted = [];
    const focusNoScroll = (el) => { try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); } };
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-zoom]");
      if (!t || !lb.hidden) return;
      const inner = t.tagName === "IMG" ? t : $("img", t);
      const src = t.dataset.zoom || (inner && (inner.currentSrc || inner.src));
      if (!src) return;
      opener = document.activeElement;
      img.src = src;
      img.alt = (inner && inner.alt) || t.getAttribute("aria-label") || "";
      inerted = Array.from(document.body.children).filter((n) => n !== lb && !n.inert && !/^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(n.tagName) && !n.classList.contains("tip"));
      inerted.forEach((n) => { n.inert = true; });
      lb.hidden = false;
      document.body.style.overflow = "hidden";
      focusNoScroll(closeBtn);
    });
    const close = () => {
      inerted.forEach((n) => { n.inert = false; });
      inerted = [];
      lb.hidden = true; document.body.style.overflow = "";
      if (opener && document.contains(opener) && opener.focus) focusNoScroll(opener);
      opener = null;
    };
    lb.addEventListener("click", close);
    document.addEventListener("keydown", (e) => {
      if (lb.hidden) return;
      if (e.key === "Escape") close();
      // focus trap for browsers without inert: the close button is the dialog's only control
      else if (e.key === "Tab") { e.preventDefault(); focusNoScroll(closeBtn); }
    });
  }

  function initBibCopy() {
    // cite the page wherever it is hosted: fill the URL from the address bar (no hash or query)
    const u = $("#bib-url");
    if (u && /^https?:$/.test(location.protocol)) u.textContent = location.origin + location.pathname;
    const btn = $("#bib-copy"), code = $("#bib-code");
    if (!btn || !code) return;
    btn.addEventListener("click", () => {
      const done = () => {
        btn.textContent = "Copied";
        btn.classList.add("is-done");
        setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("is-done"); }, 1600);
      };
      const text = code.textContent;
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(done, () => fallback(text, done));
      else fallback(text, done);
    });
    function fallback(text, done) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* ignore */ }
      ta.remove();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    initAutoplay();
    initReveal();
    initCountUps();
    initLightbox();
    initBibCopy();
  });

  /* auto-advancing segmented control: a ring traces the selected segment for `ms`, then the next segment is chosen
     (a synthetic click, so the control's own handlers run). The reader's first real click or key press on it stops the
     rotation for good. Paused while the control is off-screen or the tab is hidden; never with reduced motion. */
  function autoSeg(seg, { ms = 10000 } = {}) {
    if (!seg || reduced) return;
    const btns = [...seg.querySelectorAll("button")];
    if (btns.length < 2) return;
    const NS = "http://www.w3.org/2000/svg";
    btns.forEach((b) => {
      const s = document.createElementNS(NS, "svg");
      s.setAttribute("class", "seg-ring"); s.setAttribute("aria-hidden", "true");
      const r = document.createElementNS(NS, "rect"); r.setAttribute("pathLength", "100");
      s.appendChild(r); b.appendChild(s);
    });
    const fit = () => btns.forEach((b) => {
      const w = b.offsetWidth, h = b.offsetHeight, s = b.querySelector(".seg-ring"), r = s.firstChild;
      if (!w || !h) return;
      s.setAttribute("viewBox", `0 0 ${w} ${h}`);
      r.setAttribute("x", ".75"); r.setAttribute("y", ".75");
      r.setAttribute("width", String(w - 1.5)); r.setAttribute("height", String(h - 1.5)); r.setAttribute("rx", "6.25");
    });
    fit();
    if ("ResizeObserver" in window) new ResizeObserver(fit).observe(seg);
    seg.style.setProperty("--seg-ms", ms + "ms");
    let on = true, vis = false;
    const cur = () => btns.findIndex((b) => b.getAttribute("aria-selected") === "true" || b.getAttribute("aria-pressed") === "true");
    const run = () => {
      btns.forEach((b) => b.classList.remove("is-run"));
      const i = cur();
      if (!on || i < 0) return;
      void btns[i].offsetWidth; btns[i].classList.add("is-run");
    };
    const sync = () => seg.classList.toggle("is-paused", !vis || document.hidden);
    const stop = (e) => {
      if (!e.isTrusted || !on) return;
      on = false; seg.classList.remove("is-auto"); btns.forEach((b) => b.classList.remove("is-run"));
    };
    seg.addEventListener("pointerdown", stop, true);
    seg.addEventListener("keydown", stop, true);
    seg.addEventListener("click", (e) => { if (e.isTrusted) stop(e); else setTimeout(run, 0); }, true);
    seg.addEventListener("animationend", (e) => {
      if (!on || !e.target.closest || !e.target.closest(".is-run")) return;
      btns[(cur() + 1) % btns.length].click();
    });
    if ("IntersectionObserver" in window) new IntersectionObserver((es) => { vis = es[0].isIntersecting; sync(); }, { threshold: 0.6 }).observe(seg);
    else vis = true;
    document.addEventListener("visibilitychange", sync);
    seg.classList.add("is-auto");
    sync(); run();
  }

  return { $, $$, clamp, fmt, nameHTML, svg, reduced, canHover, onVisible, countUp, hl, tip, initAutoplay, autoSeg };
})();
