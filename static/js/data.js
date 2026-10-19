/* PrismWAM page data. Every number comes from the paper (Tables 1, 2, 4, 5 and Figs. 1, 3).
   One model id is shared by every chart, so hovering a model anywhere can light it up everywhere. */
window.PRISM_DATA = (function () {
  "use strict";

  // type: "ours" | "VLA" | "WAM"; pre: uses extra embodied action pretraining (hatched in the paper's Fig. 3).
  // pre: null = the paper does not say; preNote then gives what it does say (render it instead of "yes"/"no").
  // "PrismWAM" is the 5B model; PrismWAM* (the exploratory 15B variant) is reported where available.
  const MODELS = {
    "vpp2":         { name: "VPP2", type: "WAM", pre: false, org: "RobotEra", inert: true },  // RoboDojo only; no hover card or linking
    "prismwam-15b": { name: "PrismWAM*", type: "ours", pre: false, hours: 0, hoursLabel: "0 h", ours: true },
    "prismwam":     { name: "PrismWAM", type: "ours", pre: false, hours: 0, hoursLabel: "0 h", ours: true, size: "5B", note: "5B model" },
    "openwam":      { name: "OpenWAM-α", type: "WAM", pre: true, hours: 6400, hoursLabel: "≈6,400 h" },
    "pi05":         { name: "π0.5", type: "VLA", pre: true, hours: 10000, hoursLabel: "10,000+ h" },
    "pi0":          { name: "π0", type: "VLA", pre: true },
    "4dwam":        { name: "4D-WAM", type: "WAM", pre: true, radar: false },
    // not in Fig. 3; Tables 1-2 list it under "w/ Explicit Spatial Information", and Sec. 4.1 groups it with
    // methods using "physics-aware or spatially aware pretraining or fine-tuning"
    "xwam":         { name: "X-WAM", type: "WAM", pre: true, radar: false },
    "spatialforcing": { name: "Spatial Forcing", type: "VLA", pre: true },
    "starvla":      { name: "StarVLA", type: "VLA", pre: false, hours: 0, hoursLabel: "0 h" },
    "fastwam":      { name: "FastWAM", type: "WAM", pre: false, hours: 0, hoursLabel: "0 h" },
    "gigabrain":    { name: "GigaBrain-0.7", type: "VLA", pre: true },
    "abot":         { name: "ABot-M0.5", type: "WAM", pre: false },   // LIBERO only on this page
    "xiaomi":       { name: "Xiaomi-Robotics-1", type: "VLA", pre: true, hours: 100000, hoursLabel: "100,000+ h" },
    "g05":          { name: "G0.5", type: "VLA", pre: true },
    "dm05":         { name: "DM0.5", type: "VLA", pre: true },
    "acot":         { name: "ACoT-VLA", type: "VLA", pre: true },
    "openvla":      { name: "OpenVLA", type: "VLA", pre: true },
  };

  // Headline metric per benchmark. lo/hi: axis range for bars (bars start above zero where results are close).
  const BENCHMARKS = [
    { id: "c2r", name: "RoboTwin clean → random", short: "RoboTwin C2R", metric: "Avg. success", unit: "%", lo: 0, hi: 87,
      blurb: "Trained on clean scenes only; score = mean success on clean and fully randomized scenes.",
      scores: { "prismwam-15b": 83.67, prismwam: 70.57, openwam: 69.05, gigabrain: 67.35, "4dwam": 61.65, pi05: 58.35, spatialforcing: 51.97, xwam: 47.9, fastwam: 39.85, starvla: 24.84 } },
    { id: "dojo", name: "RoboDojo", short: "RoboDojo", metric: "Overall score", unit: "", lo: 0, hi: 41,
      blurb: "Generalization, precision, long-horizon, memory and open-ended tasks.",
      scores: { vpp2: 39.26, "prismwam-15b": 36.23, dm05: 24.9, prismwam: 25.10, g05: 20.23, xiaomi: 20.07, openwam: 17.18, "4dwam": 12.71, spatialforcing: 12.38, pi05: 11.44, xwam: 7.69, starvla: 6.4, fastwam: 3.48 } },
    { id: "libero", name: "LIBERO", short: "LIBERO", metric: "Avg. success", unit: "%", lo: 95.5, hi: 100,
      blurb: "Spatial, Object, Goal and Long suites.",
      scores: { abot: 99.4, prismwam: 99.35, openwam: 99.3, "4dwam": 98.6, spatialforcing: 98.5, fastwam: 97.6, pi05: 96.85, xwam: 96.6, starvla: 96.6 } },
    { id: "plus", name: "LIBERO-Plus", short: "LIBERO-Plus", metric: "Overall success", unit: "%", lo: 20, hi: 90,
      blurb: "Camera, robot, language, light, background, noise and layout perturbations.",
      scores: { acot: 86.6, pi05: 84.76, prismwam: 79.44, starvla: 77.83, xwam: 74.8, spatialforcing: 71.1, "4dwam": 71.01, openwam: 68.79, fastwam: 52.56 } },
    { id: "pro", name: "LIBERO-Pro", short: "LIBERO-Pro", metric: "Overall success", unit: "%", lo: 35, hi: 60,
      blurb: "Changed objects, positions, semantics, tasks and environments.",
      scores: { pi05: 57.16, openwam: 55.71, prismwam: 54.48, xwam: 53.13, openvla: 52.0, "4dwam": 48.34, starvla: 47.43, pi0: 44.0, spatialforcing: 42.42, fastwam: 40.51 },
    },
  ];

  // Radar: per-axis range used to normalise; models with a score on every benchmark can be drawn.
  // PrismWAM uses its best model per benchmark (PrismWAM* where reported), as in the paper's Fig. 1c.
  const RADAR_RANGES = { c2r: [0, 85], dojo: [0, 40], libero: [94, 100], plus: [40, 88], pro: [35, 58] };
  const PRISM_BEST = { c2r: 83.67, dojo: 36.23, libero: 99.35, plus: 79.44, pro: 54.48 };

  // RoboDojo score / success rate (Tables 1 and 4) vs. hours of extra embodied action pretraining.
  // Only models whose pretraining amount the paper states: Table 4 hours, plus StarVLA and FastWAM,
  // which the paper groups as trained without embodied action pretraining (0 h).
  const EFFICIENCY = [
    { id: "starvla", score: 6.4, sr: 3.24 },
    { id: "fastwam", score: 3.48, sr: 2.03 },
    { id: "xiaomi", score: 20.07, sr: 13.93 },
    { id: "pi05", score: 11.44, sr: 6.93 },
    { id: "openwam", score: 17.18, sr: 11.92 },
    { id: "prismwam", score: 25.10, sr: 18.55 },
    { id: "prismwam-15b", score: 36.23, sr: 29.3 },
  ];

  // Table 1: RoboDojo Precision category, progress score (/100)
  const DOJO_PRECISION = { "prismwam-15b": 39.82, prismwam: 28.70, openwam: 18.45, "4dwam": 18.08, spatialforcing: 17.32, pi05: 12.4, starvla: 9.9, xwam: 6.72, fastwam: 1.96 };

  // Table 5: real-world successes / trials
  const REAL = [
    { id: "plate", name: "Pick Up Plate", meta: "Bimanual plate handling", openwam: { id: [4, 5], ood: [10, 15] }, prismwam: { id: [5, 5], ood: [13, 15] } },
    { id: "ranking", name: "Ranking Block Size", meta: "Single-arm ordering by size", openwam: { id: [7, 12], ood: [3, 10] }, prismwam: { id: [11, 12], ood: [6, 10] } },
    { id: "microwave", name: "Open Microwave", meta: "Bimanual multistep retrieval", openwam: { id: [9, 10], ood: [4, 10] }, prismwam: { id: [8, 10], ood: [5, 10] } },
  ];
  const REAL_POOLED = { openwam: { id: [20, 27], ood: [17, 35] }, prismwam: { id: [24, 27], ood: [24, 35] } };

  // Intro film chapters (seconds) for the video player
  const CHAPTERS = [
    { t: 0, label: "The question" },
    { t: 22, label: "The insight" },
    { t: 45.7, label: "PrismWAM" },
    { t: 64.7, label: "Three roles" },
    { t: 74.7, label: "How it works" },
    { t: 100.2, label: "Results" },
    { t: 114.7, label: "Real robots" },
  ];

  // helpers
  const rankIn = (bench, id) => {
    const sorted = Object.entries(bench.scores).sort((a, b) => b[1] - a[1]);
    const i = sorted.findIndex(([k]) => k === id);
    return i < 0 ? null : { rank: i + 1, of: sorted.length };
  };
  const hasAll = (id) => id === "prismwam-best" || BENCHMARKS.every((b) => b.scores[id] != null);
  const radarModels = () => Object.keys(MODELS).filter((id) => !MODELS[id].ours && MODELS[id].radar !== false && hasAll(id));

  return { DOJO_PRECISION, MODELS, BENCHMARKS, RADAR_RANGES, PRISM_BEST, EFFICIENCY, REAL, REAL_POOLED, CHAPTERS, rankIn, hasAll, radarModels };
})();
