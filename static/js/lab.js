/* PrismWAM — B. Decoupling lab (#decoupling).
   "What changes when a robot acts?" on real RoboTwin renders (static/img/sim, task Grab Roller, head camera):
   32 frames of one episode, RGB + depth, plus appearance variants re-rendered at the same physical state.
   The timeline moves both views; an appearance choice swaps only the RGB frames (their depth is identical).
   One state object { t, look, last } drives every pixel; status pills, summary and readouts are stacked text
   slots, so state changes never reflow the page. Frames load progressively once the lab nears the viewport. */
(function () {
  "use strict";
  const P = window.PRISM;
  const sec = document.getElementById("decoupling");
  const root = document.getElementById("lab");
  if (!P || !sec || !root) return;

  const $ = (s, el = root) => el.querySelector(s);
  const $$ = (s, el = root) => Array.from(el.querySelectorAll(s));
  const reduced = P.reduced;

  /* ── the episode ── */
  const N = 32, LAST = N - 1;
  const DIR = "static/img/sim/";
  const pad = (t) => (t < 10 ? "0" : "") + t;
  const rgbURL = (v, t) => `${DIR}rgb_${v}_t${pad(t)}.webp`;
  const depthURL = (t) => `${DIR}depth_t${pad(t)}.webp`;
  const VARIANTS = ["light", "texture", "lighttex", "random1", "random2"];
  const LOOK_NAME = { clean: "default", light: "changed lighting", texture: "changed textures", lighttex: "changed lighting and textures", random1: "random lighting and textures", random2: "random lighting and textures" };
  const LOOK_SUM = { clean: "look-clean", light: "look-light", texture: "look-tex", lighttex: "look-both", random1: "look-both", random2: "look-both" };
  // phases of the episode (frame index where each starts): reach (incl. the descent), grasp, lift
  const PHASES = [["reach", 0], ["grasp", 18], ["lift", 27]];
  // chapter edges on the track, halfway between the last frame of one phase and the first of the next
  const EDGES = PHASES.map((p) => (p[1] === 0 ? 0 : (p[1] - 0.5) / LAST)).concat(1);
  const phaseOf = (t) => PHASES.reduce((a, p) => (t >= p[1] ? p : a), PHASES[0])[0];
  const FRAME_MS = 110;                       // 31 steps ≈ 3.4 s for the whole episode

  const stage = $(".lab-stage");
  const frameRGB = $(".lab-frame--rgb"), frameD = $(".lab-frame--depth");
  const imgRGB = $(".lab-frame--rgb .lab-img:not(.lab-img--fade)"), imgFade = $(".lab-img--fade");
  const imgD = $(".lab-frame--depth .lab-img");
  const opts = $$("[data-look]");
  const playBtn = $(".lab-play"), slider = $(".lab-slider");
  const phaseEls = $$(".lab-phase"), phaseLbls = $$(".lab-phaselbl"), readout = $(".lab-readout b"); // may be absent
  const live = $("[data-live]");
  const stacks = {};
  $$("[data-stack]").forEach((el) => { stacks[el.dataset.stack] = el; });
  const pulses = { w: $(".lab-beam--w .lab-pulse"), c: $(".lab-beam--c .lab-pulse") };
  const pulseTarget = { w: frameRGB, c: frameD };
  const demoBtn = $("[data-demo]");

  // last: what the most recent change was ("none" | "look" | "act"); recap: the takeaway line after the demo
  const state = { t: 0, look: "clean", last: "none", playing: false, recap: false };
  let seenLook = false;      // an appearance change has been seen (by the user or in the demo)
  let randNext = 0;
  const ovText = root.querySelector(".lab-ov-t");
  const OV_TEXT = { light: "Lighting changed", texture: "Texture changed", lighttex: "Lighting + texture changed", random1: "Random appearance", random2: "Random appearance" };          // the Random button alternates random1 / random2
  const shown = {};          // current key per stacked slot
  let touched = false;       // user has interacted: never auto-run the demo after that

  /* ── progressive frame loader: a small priority queue of decoded Image objects ── */
  const cache = new Map();   // url -> { img, ok, done: Promise }
  const queue = [];
  let active = 0;
  const MAXC = 6;
  function load(url) {
    let e = cache.get(url);
    if (e) return e;
    const img = new Image();
    img.decoding = "async";
    e = { img, ok: false, done: null };
    e.done = new Promise((res) => {
      img.onload = () => {
        e.ok = true;
        const d = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
        d.then(() => { active--; pump(); res(); });
      };
      img.onerror = () => { active--; pump(); res(); };
    });
    cache.set(url, e);
    active++;
    img.src = url;
    return e;
  }
  function pump() {
    while (active < MAXC && queue.length) {
      const url = queue.shift();
      if (!cache.has(url)) load(url);
    }
  }
  // urls in priority order; front = ahead of everything already queued
  function want(urls, front) {
    const fresh = urls.filter((u) => !cache.has(u));
    if (front) queue.unshift(...fresh); else queue.push(...fresh);
    pump();
  }
  const ready = (url) => { const e = cache.get(url); return !!(e && e.ok); };
  // frame order starting at t (then wrapping), so what is on screen next loads first
  const order = (t) => Array.from({ length: N }, (_, k) => (t + k) % N);
  const lookURL = (look, t) => rgbURL(look, t);

  let started = false, coreDone = null;
  function startPreload() {
    if (started) return;
    started = true;
    const urls = [];
    order(state.t).forEach((t) => { urls.push(lookURL(state.look, t), depthURL(t)); });
    want(urls);
    coreDone = Promise.all(urls.map((u) => (cache.get(u) || load(u)).done));
    coreDone.then(() => idle(() => {
      const sd = navigator.connection && navigator.connection.saveData;
      // each variant at the current and final frame (what a click or the demo shows first), then whole episodes
      const first = [], rest = [];
      VARIANTS.forEach((v) => { first.push(rgbURL(v, state.t), rgbURL(v, LAST)); });
      if (!sd) VARIANTS.forEach((v) => order(0).forEach((t) => rest.push(rgbURL(v, t))));
      want(first.concat(rest));
    }));
  }
  function idle(fn) { if ("requestIdleCallback" in window) requestIdleCallback(fn, { timeout: 2500 }); else setTimeout(fn, 600); }
  // a look was chosen: its frames jump the queue, from the current frame on
  function prioritise(look) { want(order(state.t).map((t) => lookURL(look, t)), true); }

  /* ── helpers ── */
  const restart = (el, cls) => { if (!el || reduced) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  function setStack(name, key) {
    const el = stacks[name];
    if (!el || shown[name] === key) return false;
    shown[name] = key;
    Array.from(el.children).forEach((c) => c.classList.toggle("is-on", c.dataset.k === key));
    return true;
  }

  /* ── frames ── */
  let fadeTok = 0, fadeTimer = 0;
  function cancelFade() { fadeTok++; clearTimeout(fadeTimer); imgFade.classList.remove("is-on"); }
  function showFrames(fadeRGB) {
    const t = state.t, url = lookURL(state.look, t), d = depthURL(t);
    load(url); load(d);
    if (imgD.getAttribute("src") !== d) imgD.src = d;
    if (fadeRGB && !reduced && imgRGB.getAttribute("src") !== url) {
      // same physical state, new look: a short crossfade (nothing in the scene moves, so nothing ghosts)
      const tok = ++fadeTok;
      clearTimeout(fadeTimer);
      const go = () => {
        if (tok !== fadeTok) return;
        imgFade.src = url;
        imgFade.classList.add("is-on");
        fadeTimer = setTimeout(() => {
          if (tok !== fadeTok) return;
          imgRGB.src = url;
          // hide the top copy only once the base paints the same frame
          const d = imgRGB.decode ? imgRGB.decode().catch(() => {}) : Promise.resolve();
          d.then(() => requestAnimationFrame(() => { if (tok === fadeTok) imgFade.classList.remove("is-on"); }));
        }, 260);
      };
      if (ready(url)) go(); else cache.get(url).done.then(go);
      return;
    }
    cancelFade();
    // until a frame has loaded, the img keeps painting the previous one: never a blank
    if (imgRGB.getAttribute("src") !== url) imgRGB.src = url;
  }
  function setAlts() {
    const t = state.t, ph = phaseOf(t);
    imgRGB.alt = `Simulator RGB from the head camera, frame ${t + 1} of ${N} (${ph}), ${LOOK_NAME[state.look]} appearance.`;
    imgD.alt = `Simulator depth of the same frame, colour-coded from near (purple) to far (yellow).`;
  }

  /* ── render everything from state ── */
  function render(fadeRGB) {
    const t = state.t;
    showFrames(fadeRGB);

    // timeline
    slider.style.setProperty("--p", (t / LAST).toFixed(4));
    const x = t / LAST;
    PHASES.forEach((p, k) => {
      // each chapter of the track fills up to the thumb
      const f = P.clamp((x - EDGES[k]) / (EDGES[k + 1] - EDGES[k]), 0, 1);
      phaseEls[k].style.setProperty("--f", f.toFixed(4));
      phaseLbls[k].classList.toggle("is-on", phaseOf(t) === p[0]);
    });
    if (slider.getAttribute("aria-valuenow") !== String(t + 1)) {
      slider.setAttribute("aria-valuenow", t + 1);
      slider.setAttribute("aria-valuetext", `Frame ${t + 1} of ${N}, ${phaseOf(t)}`);
      if (readout) readout.textContent = t + 1;
    }
    if (!state.playing) setIcon(t >= LAST ? "replay" : "play");
    if (!state.playing) setAlts();

    // states: pills and rings say what the latest change did
    const look = state.last === "look", act = state.last === "act";
    frameRGB.classList.toggle("is-changed", look || act);
    frameD.classList.toggle("is-changed", act);
    // demo only: big Changed / Unchanged tags over the two views while an appearance edit is on screen
    const ovOn = demo.on && look && state.look !== "clean";
    if (ovOn && ovText) ovText.textContent = OV_TEXT[state.look] || "Appearance changed";
    root.classList.toggle("show-ov", ovOn);
    setStack("rgb", look || act ? "changed" : "same");
    if (setStack("depth", act ? "changed" : "same") && act) restart(stacks.depth, "is-pop");
    const sum = state.recap ? "both" : look ? LOOK_SUM[state.look] : act ? "act" : "idle";
    // the unsolicited demo stays quiet for screen readers; it announces once when it ends
    if (setStack("sum", sum) && !demo.on) announce();
  }
  function announce() {
    const p = stacks.sum.querySelector(`[data-k="${shown.sum}"]`);
    if (live && p && live.textContent !== p.textContent) live.textContent = p.textContent;
  }

  // the robot moved (or the user scrubbed): both views change
  function setT(t) {
    t = P.clamp(Math.round(t), 0, LAST);
    if (t === state.t && state.last === "act") return;
    if (t !== state.t) { state.last = "act"; state.recap = false; }
    state.t = t;
    render(false);
  }

  let icon = "play";
  function setIcon(name) {
    if (icon === name) return;
    icon = name;
    playBtn.dataset.icon = name;
    playBtn.setAttribute("aria-label", name === "pause" ? "Pause" : name === "replay" ? "Replay the episode" : "Play the episode");
  }

  // a light pulse runs from the prism to the view(s) that changed; the view's ring brightens as it lands
  function pulse(which) { which.split("").forEach((k) => { restart(pulses[k], "is-go"); restart(pulseTarget[k], "is-hit"); }); }

  /* ── appearance (RGB only) ── */
  function setLook(key) {
    let look = key;
    if (key === "random") { look = "random" + (randNext + 1); randNext = 1 - randNext; }
    if (look !== "clean") seenLook = true;
    state.look = look;
    state.last = "look";
    state.recap = false;
    opts.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.look === key)));
    const rb = opts.find((b) => b.dataset.look === "random");
    if (rb) rb.setAttribute("aria-label", look.startsWith("random") ? `Random appearance ${look.slice(-1)} of 2` : "Random appearance");
    startPreload();
    if (look !== "clean") prioritise(look);
    render(true);
    pulse("w");
    restart(stacks.depth, "is-ping"); // the point of the lab: the depth view did not move
  }

  /* ── playback: one frame every FRAME_MS, waiting for a frame that has not arrived yet ── */
  let raf = 0, onDone = null;
  function startPlay(done) {
    onDone = done || null;
    startPreload();
    if (state.t >= LAST) setT(0);
    state.playing = true;
    setIcon("pause");
    pulse("wc");
    let last = performance.now();
    const tick = (now) => {
      if (!state.playing) return;
      if (now - last >= FRAME_MS) {
        const n = state.t + 1;
        if (ready(lookURL(state.look, n)) && ready(depthURL(n))) {
          last = now - Math.min(FRAME_MS, now - last - FRAME_MS);
          setT(n);
          if (n >= LAST) { finishPlay(); return; }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (!state.playing) return;
    state.playing = false;
    cancelAnimationFrame(raf);
    onDone = null;
    render(false);
  }
  function finishPlay() {
    const done = onDone;
    state.playing = false;
    onDone = null;
    cancelAnimationFrame(raf);
    pulse("wc");
    if (seenLook && !done) state.recap = true; // after both kinds of change, the finished episode ends on the takeaway
    render(false);
    if (done) done();
  }

  /* ── one short demo: play the episode, flip two looks at the final frame, back to default ── */
  const demo = { on: false, timers: [], tok: 0 };
  // one persistent button (Play / Stop / Replay demo): it never hides, so keyboard focus is never dropped
  function setDemoBtn(key) {
    if (!demoBtn || !setStack("demobtn", key)) return;
    demoBtn.setAttribute("aria-label", key === "stop" ? "Stop demo" : key === "replay" ? "Replay demo" : "Play demo");
  }
  const later = (ms, fn) => demo.timers.push(setTimeout(fn, ms));
  function runDemo() {
    if (reduced) return;
    stopDemoTimers();
    demo.on = true; // set first: the reset below stays quiet for screen readers too
    stopPlay();
    startPreload();
    setDemoBtn("stop");
    root.classList.add("is-demo");
    // reset to the start, default look, without counting it as a change
    state.look = "clean"; state.t = 0; state.last = "none"; state.recap = false; randNext = 0;
    opts.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.look === "clean")));
    render(false);
    // wait (briefly) for the episode's frames, so the first play is smooth
    const tok = ++demo.tok;
    const wait = Promise.race([coreDone || Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]);
    wait.then(() => {
      if (!demo.on || tok !== demo.tok) return;
      later(450, () => startPlay(() => {
        if (!demo.on || tok !== demo.tok) return;
        // the appearance buttons, left to right, then back to Default
        const STEP = 2100;
        ["light", "texture", "lighttex", "random", "clean"].forEach((k, i) => later(900 + i * STEP, () => setLook(k)));
        later(900 + 5 * STEP - 600, () => { state.recap = true; render(false); endDemo(); });
      }));
    });
  }
  function stopDemoTimers() { demo.timers.forEach(clearTimeout); demo.timers = []; }
  function endDemo() {
    stopDemoTimers();
    demo.on = false;
    root.classList.remove("is-demo", "show-ov");
    setDemoBtn("replay");
    announce();
  }
  // the user takes over: the demo stops where it is
  function takeOver() {
    touched = true;
    if (!demo.on) return false;
    endDemo();
    const wasPlaying = state.playing;
    if (wasPlaying) stopPlay();
    return wasPlaying;
  }

  /* ── wire controls ── */
  opts.forEach((b) => b.addEventListener("click", () => {
    takeOver();
    const k = b.dataset.look;
    if (k !== "random" && b.getAttribute("aria-pressed") === "true") return;
    setLook(k);
  }));

  playBtn.addEventListener("click", () => {
    if (takeOver()) return;            // demo was playing: this click means "pause"
    if (state.playing) stopPlay(); else startPlay();
  });

  if (demoBtn) {
    if (reduced) demoBtn.remove();
    else demoBtn.addEventListener("click", () => {
      if (demo.on) { takeOver(); return; } // "Stop demo": leave the lab where the demo got to
      touched = true; runDemo();
    });
  }

  // scrubber: snaps to recorded frames while dragging (no blends between frames)
  let drag = null;
  const tFromX = (x) => {
    const r = slider.getBoundingClientRect();
    return P.clamp((x - r.left) / r.width, 0, 1) * LAST;
  };
  slider.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    takeOver(); stopPlay(); startPreload();
    drag = e.pointerId;
    try { slider.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    slider.classList.add("is-drag");
    slider.focus({ preventScroll: true });
    setT(tFromX(e.clientX));
    e.preventDefault();
  });
  slider.addEventListener("pointermove", (e) => { if (drag === e.pointerId) setT(tFromX(e.clientX)); });
  const endDrag = (e) => {
    if (drag !== e.pointerId) return;
    drag = null;
    slider.classList.remove("is-drag");
    pulse("wc");
  };
  slider.addEventListener("pointerup", endDrag);
  slider.addEventListener("pointercancel", endDrag);
  slider.addEventListener("keydown", (e) => {
    const t = state.t;
    let target = null;
    switch (e.key) {
      case "ArrowRight": case "ArrowUp": target = t + 1; break;
      case "ArrowLeft": case "ArrowDown": target = t - 1; break;
      case "PageUp": { const p = PHASES.find((q) => q[1] > t); target = p ? p[1] : LAST; break; }
      case "PageDown": { const p = PHASES.slice().reverse().find((q) => q[1] < t); target = p ? p[1] : 0; break; }
      case "Home": target = 0; break;
      case "End": target = LAST; break;
      default: return;
    }
    e.preventDefault();
    takeOver(); stopPlay(); startPreload();
    setT(target);
  });

  render(false);

  // frames start loading when the lab nears the viewport; the demo runs once, when most of the views are on screen
  P.onVisible(root, startPreload, { rootMargin: "900px 0px" });
  P.onVisible(stage, () => { setTimeout(() => { if (!touched) runDemo(); }, 350); }, { threshold: 0.55 });

  /* ── part 2: the film clip gets an explicit play/pause (core autoplays it while visible) ── */
  const vid = sec.querySelector(".lab-vid video"), vbtn = sec.querySelector(".lab-vbtn");
  if (vid && vbtn) {
    const sync = () => {
      const playing = !vid.paused;
      vbtn.dataset.state = playing ? "playing" : "paused";
      vbtn.setAttribute("aria-label", playing ? "Pause animation" : "Play animation");
    };
    vbtn.addEventListener("click", () => {
      if (vid.paused) { vid.__userPaused = false; const p = vid.play(); if (p) p.catch(() => {}); }
      else { vid.__userPaused = true; vid.pause(); }
    });
    // respect a manual pause even when core's visibility observer asks the clip to play again
    vid.addEventListener("play", () => { if (vid.__userPaused) vid.pause(); sync(); });
    vid.addEventListener("playing", sync);
    vid.addEventListener("pause", sync);
    sync();
  }
})();
