/**
 * candlestick-engine.js — Drop-in candlestick renderer for JEEMaxxing.
 *
 * Pure vanilla JS (no React, no deps). Exposes three helpers:
 *
 *   drawCandlesticks(svgEl, counts, opts)   → renders an OHLC candlestick chart
 *   countsToOHLC(counts, opts)              → synthesises OHLC from a scalar series
 *   predictNext(counts, days)               → linear-regression projection
 *
 * Designed to replace the line/area `renderGraph()` in app.js and to power
 * the 15-day error-momentum sparkline inside the Error Resolution Matrix.
 *
 * Aesthetic matches the dashboard: dark glass, green (#22c55e) up candles,
 * red (#f87171) down candles, purple (#8b5cf6) projection, glow filters,
 * crosshair + OHLC tooltip on hover.
 *
 * Usage (ES module):
 *   import { drawCandlesticks, countsToOHLC, predictNext }
 *     from './candlestick-engine.js';
 */

// ──────────────────────────────────────────────────────────────────────────
//  Colour palette
// ──────────────────────────────────────────────────────────────────────────
const COLOR = {
  up: "#22c55e",
  down: "#f87171",
  flat: "#8b5cf6",
  grid: "rgba(255, 255, 255, 0.045)",
  axis: "rgba(255, 255, 255, 0.32)",
  divider: "rgba(139, 92, 246, 0.28)",
};

const NS = "http://www.w3.org/2000/svg";

// ──────────────────────────────────────────────────────────────────────────
//  Maths helpers
// ──────────────────────────────────────────────────────────────────────────
function rollingStd(values, idx, window = 5) {
  const start = Math.max(0, idx - window + 1);
  const slice = values.slice(start, idx + 1);
  if (!slice.length) return 0;
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance =
    slice.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, slice.length);
  return Math.sqrt(variance);
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }

/**
 * Synthesise OHLC candles from a scalar daily-count series.
 *
 *   open[i]  = close[i-1]            (yesterday's close = today's open)
 *   close[i] = raw[i]
 *   high[i]  = max(open, close) + wick   (wick derived from local volatility)
 *   low[i]   = max(0, min(open, close) - wick)
 *
 * @param {number[]} counts      oldest → newest
 * @param {object}   opts        { wickScale, penaltyFlags }
 * @returns {Array<{open,high,low,close,isPenalty}>}
 */
export function countsToOHLC(counts, opts = {}) {
  const { wickScale = 0.45, penaltyFlags = [] } = opts;
  const out = [];
  for (let i = 0; i < counts.length; i++) {
    const enforced = penaltyFlags[i] ? 0 : counts[i];
    const close = enforced;
    const open = i === 0 ? enforced : (penaltyFlags[i - 1] ? 0 : counts[i - 1]);
    const vol = rollingStd(counts, i, 5);
    const wick = vol * wickScale;
    const high = Math.max(open, close) + wick;
    const low = Math.max(0, Math.min(open, close) - wick);
    out.push({
      open: round2(open),
      high: round2(high),
      low: round2(low),
      close: round2(close),
      isPenalty: !!penaltyFlags[i],
    });
  }
  return out;
}

/**
 * Linear-regression projection of the next `days` values.
 * Returns { predictions: number[], slope, intercept, r2 }.
 */
export function predictNext(counts, days = 5) {
  const n = counts.length;
  if (n < 2) return { predictions: [], slope: 0, intercept: counts[0] || 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += counts[i];
    sumXY += i * counts[i]; sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yp = slope * i + intercept;
    ssTot += (counts[i] - meanY) ** 2;
    ssRes += (counts[i] - yp) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const predictions = [];
  for (let i = 0; i < days; i++) {
    predictions.push(Math.max(0, slope * (n + i) + intercept));
  }
  return { predictions, slope, intercept: round2(intercept), r2: round3(r2) };
}

function momentumColor(slope) {
  if (slope > 0.2) return COLOR.up;
  if (slope < -0.2) return COLOR.down;
  return COLOR.flat;
}

// ──────────────────────────────────────────────────────────────────────────
//  SVG element helpers
// ──────────────────────────────────────────────────────────────────────────
function el(name, attrs = {}, parent) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (parent) parent.appendChild(e);
  return e;
}

function clearNode(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }

// ──────────────────────────────────────────────────────────────────────────
//  Tooltip (one shared instance per chart, created lazily)
// ──────────────────────────────────────────────────────────────────────────
function ensureTooltip(svg, state) {
  if (state.tooltip) return state.tooltip;
  const wrap = svg.parentElement || svg;
  // wrapper must be positioned
  const prevPos = getComputedStyle(wrap).position;
  if (prevPos === "static") wrap.style.position = "relative";
  const tip = document.createElement("div");
  tip.className = "candle-tooltip";
  tip.style.cssText = `
    position:absolute; pointer-events:none; z-index:30; display:none;
    background:rgba(8,8,14,0.96); border:1px solid rgba(139,92,246,0.35);
    border-radius:10px; padding:10px 12px; min-width:150px;
    font-family:'Space Grotesk',monospace; backdrop-filter:blur(10px);
    box-shadow:0 8px 30px rgba(0,0,0,0.6),0 0 18px rgba(139,92,246,0.18);
  `;
  wrap.appendChild(tip);
  state.tooltip = tip;
  return tip;
}

function showTooltip(tip, candle, index, opts, px, py, width, height) {
  const isPred = opts.predStart != null && index >= opts.predStart;
  const change = candle.close - candle.open;
  const pct = candle.open !== 0 ? (change / candle.open) * 100 : 0;
  const chgColor =
    change > 0 ? (opts.invert ? COLOR.down : COLOR.up)
    : change < 0 ? (opts.invert ? COLOR.up : COLOR.down)
    : COLOR.flat;
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "■";
  const label = opts.labelFn ? opts.labelFn(index, candle) : `Day ${index + 1}`;

  tip.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#8a8ad3;
                margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.08);">
      <b style="color:#fff;letter-spacing:0.3px;">${escapeHtml(label)}</b>
      ${isPred ? '<span style="font-size:8px;padding:2px 5px;border-radius:3px;font-weight:700;letter-spacing:0.6px;background:rgba(139,92,246,0.3);color:#c4b5fd;">PRED</span>' : ""}
      ${candle.isPenalty ? '<span style="font-size:8px;padding:2px 5px;border-radius:3px;font-weight:700;letter-spacing:0.6px;background:rgba(248,113,113,0.3);color:#fca5a5;">P0</span>' : ""}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;font-size:11px;">
      <div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:#4a4a6a;font-size:10px;">Open</span><b style="color:#fff;">${candle.open.toFixed(1)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:#4a4a6a;font-size:10px;">High</span><b style="color:#22c55e;">${candle.high.toFixed(1)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:#4a4a6a;font-size:10px;">Low</span><b style="color:#f87171;">${candle.low.toFixed(1)}</b></div>
      <div style="display:flex;justify-content:space-between;gap:8px;"><span style="color:#4a4a6a;font-size:10px;">Close</span><b style="color:#fff;">${candle.close.toFixed(1)} ${escapeHtml(opts.valueLabel || "")}</b></div>
    </div>
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);font-size:11px;font-weight:700;color:${chgColor};">
      ${arrow} ${Math.abs(change).toFixed(1)} (${Math.abs(pct).toFixed(1)}%)
    </div>`;
  // position
  const tipW = 168, tipH = 132;
  let left = px + 14;
  let top = py - tipH / 2;
  if (left + tipW > width) left = px - tipW - 14;
  if (top + tipH > height) top = height - tipH - 4;
  if (top < 0) top = 4;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  tip.style.display = "block";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ──────────────────────────────────────────────────────────────────────────
//  Audio-visual hover telemetry tick
// ──────────────────────────────────────────────────────────────────────────
// Fires a tiny, click-free bleep whenever the crosshair lands on a NEW candle.
//   • Green candle (target met)  → clean sine wave @880Hz
//   • Red candle   (target missed) → bass sawtooth @220Hz
// Gain envelope peaks at 0.03 and decays to ~0 within 0.08s via exponential
// ramps (exponential ramps cannot reach exactly 0, so 0.0001 is the floor).
function playHoverTick(metTarget) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!window._candleTickCtx) window._candleTickCtx = new Ctx();
    const ac = window._candleTickCtx;
    if (ac.state === "suspended") ac.resume();
    const now = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = metTarget ? "sine" : "sawtooth";
    osc.frequency.setValueAtTime(metTarget ? 880 : 220, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.03, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(ac.destination);
    osc.start(now);
    osc.stop(now + 0.09);
  } catch (_) { /* audio is best-effort; never block rendering */ }
}

// ──────────────────────────────────────────────────────────────────────────
//  Main renderer
// ──────────────────────────────────────────────────────────────────────────
/**
 * Render an OHLC candlestick chart into an <svg> element.
 *
 * @param {SVGSVGElement} svg        the target <svg> (e.g. #dynamic-graph)
 * @param {number[]}      counts     historical daily counts (oldest → newest)
 * @param {object}        opts
 *   @param {number}   opts.width          SVG width (default 320)
 *   @param {number}   opts.height         SVG height (default 80)
 *   @param {boolean[]} opts.penaltyFlags  per-day Protocol-Zero override
 *   @param {boolean}  opts.showPrediction render 5-day dashed projection
 *   @param {number}   opts.predDays       prediction horizon (default 5)
 *   @param {boolean}  opts.compact        sparkline mode (no axes/labels)
 *   @param {boolean}  opts.invert         green = value DOWN (for error counts)
 *   @param {string}   opts.valueLabel     unit label shown in tooltip
 *   @param {function} opts.labelFn        (index, candle) → string label
 *   @param {function} opts.getX           (index, isPred) → x position override
 */
export function drawCandlesticks(svg, counts, opts = {}) {
  if (!svg) return;
  const {
    width = 320,
    height = 80,
    penaltyFlags = [],
    showPrediction = true,
    predDays = 5,
    compact = false,
    invert = false,
    valueLabel = "solves",
    labelFn,
    targetValue,
  } = opts;

  clearNode(svg);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");

  // If we have < 2 points, draw a flat placeholder.
  if (!counts.length) return;

  // ── Build OHLC + predictions ──
  const candles = countsToOHLC(counts, { penaltyFlags });
  // Pad a single-point series so regression + candles can render.
  if (candles.length === 1) {
    candles.unshift({ ...candles[0] });
    counts = [counts[0], ...counts];
  }

  const pred = showPrediction
    ? predictNext(counts, predDays)
    : { predictions: [], slope: 0, intercept: 0, r2: 0 };
  const predCandles = pred.predictions.map((p, i) => {
    const open = i === 0 ? candles[candles.length - 1].close : pred.predictions[i - 1];
    const close = Math.max(0, p);
    const vol = rollingStd(counts, counts.length - 1, 5);
    const wick = vol * 0.45 * (1 + i * 0.15);
    return {
      open: round2(open),
      high: round2(Math.max(open, close) + wick),
      low: round2(Math.max(0, Math.min(open, close) - wick)),
      close: round2(close),
      isPrediction: true,
    };
  });

  const all = [...candles, ...predCandles];
  const predStart = candles.length;
  const themeColor = momentumColor(pred.slope);

  // ── Layout ──
  const padL = compact ? 4 : 34;
  const padR = compact ? 4 : 14;
  const padT = compact ? 4 : 12;
  const padB = compact ? 4 : 20;
  const plotW = Math.max(10, width - padL - padR);
  const plotH = Math.max(10, height - padT - padB);

  // ── Target compliance setup ──
  // An explicit target drives candle colour; if absent, fall back to the
  // series mean so the chart still gets a meaningful green/red split WITHOUT
  // reverting to delta-driven (open vs close) finance logic.
  const targetValueRaw = Number.isFinite(targetValue) ? targetValue : null;
  const effectiveTarget = targetValueRaw != null
    ? targetValueRaw
    : all.reduce((s, c) => s + (Number.isFinite(c.close) ? c.close : 0), 0) / Math.max(1, all.length);

  // Expand the y-domain to include the target so the LOCK line stays visible.
  const domainExtras = targetValueRaw != null ? [targetValueRaw] : [];
  const rawMax = Math.max(...all.map((c) => c.high), 1, ...domainExtras);
  const rawMin = Math.min(...all.map((c) => c.low), 0, ...domainExtras);
  const yMax = rawMax + (rawMax - rawMin) * 0.08 + 0.5;
  const yMin = Math.max(0, rawMin - (rawMax - rawMin) * 0.05);
  const yRange = Math.max(0.001, yMax - yMin);
  const y = (v) => padT + plotH - ((v - yMin) / yRange) * plotH;

  // Allocate 70% of width to history, 30% to prediction (matches original).
  const histW = showPrediction ? plotW * 0.7 : plotW;
  const bandHist = histW / Math.max(1, candles.length);
  const bandPred = showPrediction ? (plotW * 0.3) / Math.max(1, predCandles.length) : 0;
  const xCenter = (i) => {
    if (i < predStart) return padL + bandHist * (i + 0.5);
    const j = i - predStart;
    return padL + histW + bandPred * (j + 0.5);
  };

  const bodyW = Math.min(bandHist * 0.62, compact ? 6 : 14);

  // ── <defs> (glow filter + prediction gradient) ──
  const defs = el("defs", {}, svg);
  const filter = el("filter", { id: "cnd-glow", x: "-50%", y: "-50%", width: "200%", height: "200%" }, defs);
  el("feGaussianBlur", { stdDeviation: "1.6", result: "b" }, filter);
  const merge = el("feMerge", {}, filter);
  el("feMergeNode", { in: "b" }, merge);
  el("feMergeNode", { in: "SourceGraphic" }, merge);
  const grad = el("linearGradient", { id: "cnd-pred-grad", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
  el("stop", { offset: "0%", "stop-color": themeColor, "stop-opacity": "0.22" }, grad);
  el("stop", { offset: "100%", "stop-color": themeColor, "stop-opacity": "0" }, grad);

  // ── Grid ──
  if (!compact) {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = yMin + yRange * t;
      el("line", { x1: padL, y1: y(v), x2: width - padR, y2: y(v), stroke: COLOR.grid, "stroke-width": 1 }, svg);
      el("text", {
        x: padL - 6, y: y(v) + 3, "text-anchor": "end",
        "font-size": 9, "font-family": "'Space Grotesk',monospace", fill: COLOR.axis,
      }, svg).textContent = v >= 10 ? Math.round(v).toString() : v.toFixed(1);
    }
  }

  // ── Prediction divider + area + dashed line ──
  if (showPrediction && predCandles.length) {
    const divX = padL + histW;
    el("line", { x1: divX, y1: padT, x2: divX, y2: padT + plotH, stroke: COLOR.divider, "stroke-width": 1, "stroke-dasharray": "3 3" }, svg);
    const lastHistX = xCenter(predStart - 1);
    const lastHistY = y(candles[candles.length - 1].close);
    let areaD = `M ${lastHistX},${lastHistY} `;
    predCandles.forEach((c, i) => { areaD += `L ${xCenter(predStart + i)},${y(c.close)} `; });
    areaD += `L ${xCenter(predStart + predCandles.length - 1)},${y(0)} L ${lastHistX},${y(0)} Z`;
    el("path", { d: areaD, fill: "url(#cnd-pred-grad)" }, svg);
    const pts = [`${lastHistX},${lastHistY}`];
    predCandles.forEach((c, i) => pts.push(`${xCenter(predStart + i)},${y(c.close)}`));
    el("polyline", { points: pts.join(" "), fill: "none", stroke: themeColor, "stroke-width": 1.6, "stroke-dasharray": "4 3", "stroke-linecap": "round", opacity: 0.85 }, svg);
  }

  // ── "Target Lock" barrier line (neon cyan) ──
  // Edge-to-edge horizontal at y(targetValue); drawn before candles so the
  // bodies paint on top of it.
  if (targetValueRaw != null && !compact) {
    const lockY = y(targetValueRaw);
    el("line", {
      x1: padL, y1: lockY, x2: width - padR, y2: lockY,
      stroke: "rgba(6, 182, 212, 0.6)", "stroke-width": 1.5, "stroke-dasharray": "4 2",
    }, svg);
    const lockLbl = el("text", {
      x: width - padR - 2, y: lockY - 3, "text-anchor": "end",
      "font-size": 8, "font-family": "'Space Grotesk',monospace",
      fill: "rgba(6, 182, 212, 0.9)", "font-weight": 700, "letter-spacing": 0.6,
    }, svg);
    lockLbl.textContent = "LOCK";
  }

  // ── Candles ──
  const hoverGroup = el("g", { class: "cnd-hover-layer" }, svg);
  const crosshairV = el("line", { stroke: "rgba(255,255,255,0.18)", "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0 }, hoverGroup);
  const crosshairH = el("line", { stroke: "rgba(255,255,255,0.12)", "stroke-width": 1, "stroke-dasharray": "2 3", opacity: 0 }, hoverGroup);
  const hoverDot = el("circle", { r: 3, fill: "#fff", opacity: 0 }, hoverGroup);

  // ── Target Compliance Colouring Rule ──
  // Green/red is driven SOLELY by whether `close` meets the target metric,
  // completely ignoring previous-day (open) values.
  //   • invert=false (Daily Solves):   green when close >= target
  //   • invert=true  (Error Momentum): green when close <= target
  const candleColor = (c) => {
    if (c.isPenalty) return COLOR.down;
    if (c.isPrediction) return themeColor;
    if (!invert) return c.close >= effectiveTarget ? COLOR.up : COLOR.down;
    return c.close <= effectiveTarget ? COLOR.up : COLOR.down;
  };

  // ── "Bull Run" combustion streak tracker ──
  // Running count of consecutive target-meeting history candles. ≥3 in a row
  // promotes the body <rect> to `candle-hyper-charged`; otherwise normal.
  let targetStreak = 0;

  all.forEach((c, i) => {
    const cx = xCenter(i);
    const color = candleColor(c);
    const bodyTop = y(Math.max(c.open, c.close));
    const bodyBot = y(Math.min(c.open, c.close));
    const bodyH = Math.max(1, bodyBot - bodyTop);

    // Update consecutive target-meeting streak (history candles only;
    // penalties and predictions break the chain).
    const meetsTarget = !c.isPrediction && !c.isPenalty && (
      invert ? (c.close <= effectiveTarget) : (c.close >= effectiveTarget)
    );
    targetStreak = meetsTarget ? targetStreak + 1 : 0;
    const candleClass = targetStreak >= 3 ? "candle-hyper-charged" : "candle-normal";

    // Penalty marker
    if (c.isPenalty && !compact) {
      el("line", { x1: cx, y1: padT, x2: cx, y2: padT + plotH, stroke: COLOR.down, "stroke-width": 1, "stroke-dasharray": "3 2", opacity: 0.45 }, svg);
    }

    // Wick
    el("line", {
      x1: cx, y1: y(c.high), x2: cx, y2: y(c.low),
      stroke: color, "stroke-width": compact ? 1 : 1.3,
      opacity: c.isPrediction ? 0.55 : 0.95, "stroke-linecap": "round",
    }, svg);

    // Body
    if (c.isPrediction) {
      el("rect", {
        x: cx - bodyW / 2, y: bodyTop, width: bodyW, height: bodyH,
        rx: compact ? 1 : 2, fill: "none", stroke: color,
        "stroke-width": 1.1, "stroke-dasharray": "2 2", opacity: 0.6,
        class: candleClass,
      }, svg);
    } else {
      el("rect", {
        x: cx - bodyW / 2, y: bodyTop, width: bodyW, height: bodyH,
        rx: compact ? 1 : 2, fill: color, opacity: c.close >= c.open ? 0.92 : 0.88,
        filter: "url(#cnd-glow)",
        class: candleClass,
      }, svg);
    }

    // P0 badge
    if (c.isPenalty && !compact) {
      el("rect", { x: cx - 8, y: padT - 2, width: 16, height: 10, rx: 2, fill: COLOR.down, opacity: 0.92 }, svg);
      const t = el("text", { x: cx, y: padT + 5, "text-anchor": "middle", "font-size": 7, "font-weight": 700, "font-family": "'Space Grotesk',monospace", fill: "#fff" }, svg);
      t.textContent = "P0";
    }
  });

  // ── X labels (sparse) ──
  if (!compact && labelFn) {
    const every = Math.max(1, Math.ceil(candles.length / 7));
    for (let i = 0; i < candles.length; i += every) {
      const t = el("text", { x: xCenter(i), y: height - 5, "text-anchor": "middle", "font-size": 9, "font-family": "'Space Grotesk',monospace", fill: COLOR.axis }, svg);
      t.textContent = labelFn(i, candles[i]);
    }
  }

  // ── TODAY marker ──
  if (!compact && candles.length) {
    const t = el("text", { x: xCenter(predStart - 1), y: padT - 3, "text-anchor": "middle", "font-size": 8, "font-weight": 700, "letter-spacing": 1, fill: "rgba(255,255,255,0.45)", "font-family": "'Space Grotesk',monospace" }, svg);
    t.textContent = "TODAY";
  }

  // ── Hover interaction ──
  const state = { tooltip: null };
  ensureTooltip(svg, state);
  const tip = state.tooltip;

  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const px = (ev.clientX - rect.left) * scaleX;
    // find nearest candle
    let nearest = -1, bestDist = Infinity;
    for (let i = 0; i < all.length; i++) {
      const d = Math.abs(xCenter(i) - px);
      if (d < bestDist) { bestDist = d; nearest = i; }
    }
    // ── Telemetry tick: fire a bleep ONLY when the crosshair lands on a new candle index ──
    if (nearest !== window._lastHoveredIndex) {
      window._lastHoveredIndex = nearest;
      if (nearest >= 0) {
        const hovered = all[nearest];
        const metTarget = candleColor(hovered) === COLOR.up;
        playHoverTick(metTarget);
      }
    }
    if (nearest < 0) { tip.style.display = "none"; crosshairV.setAttribute("opacity", 0); crosshairH.setAttribute("opacity", 0); hoverDot.setAttribute("opacity", 0); return; }
    const c = all[nearest];
    const cx = xCenter(nearest);
    const cy = y(c.close);
    crosshairV.setAttribute("x1", cx); crosshairV.setAttribute("x2", cx);
    crosshairV.setAttribute("y1", padT); crosshairV.setAttribute("y2", padT + plotH);
    crosshairV.setAttribute("opacity", 1);
    crosshairH.setAttribute("x1", padL); crosshairH.setAttribute("x2", width - padR);
    crosshairH.setAttribute("y1", cy); crosshairH.setAttribute("y2", cy);
    crosshairH.setAttribute("opacity", 1);
    hoverDot.setAttribute("cx", cx); hoverDot.setAttribute("cy", cy);
    hoverDot.setAttribute("stroke", candleColor(c)); hoverDot.setAttribute("stroke-width", 1.5);
    hoverDot.setAttribute("opacity", 1);
    showTooltip(tip, c, nearest, { ...opts, predStart }, cx, cy, width, height);
  };
  const onLeave = () => {
    window._lastHoveredIndex = -1;
    tip.style.display = "none";
    crosshairV.setAttribute("opacity", 0);
    crosshairH.setAttribute("opacity", 0);
    hoverDot.setAttribute("opacity", 0);
  };
  svg.addEventListener("mousemove", onMove);
  svg.addEventListener("mouseleave", onLeave);

  return { slope: pred.slope, r2: pred.r2, themeColor, candles: all };
}

// ──────────────────────────────────────────────────────────────────────────
//  Convenience: extract a count series from an existing rendered sparkline.
//  Used by renderMomentumCandles() to read whatever matrix.js already drew
//  into #error-momentum-svg-container and re-render it as candlesticks —
//  no need to know matrix.js's internal data source.
// ──────────────────────────────────────────────────────────────────────────
export function extractCountsFromSvg(container) {
  if (!container) return [];
  // Try <polyline points="x,y x,y ..."> first.
  const poly = container.querySelector("polyline");
  if (poly) {
    const pts = (poly.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    const ys = [];
    for (let i = 1; i < pts.length; i += 2) ys.push(pts[i]);
    if (ys.length) return ys;
  }
  // Fall back to <rect> heights (bar sparkline).
  const rects = Array.from(container.querySelectorAll("rect"));
  if (rects.length) {
    // heights are inverse to y; we just need relative values.
    const baseTop = Math.min(...rects.map((r) => parseFloat(r.getAttribute("y") || "0")));
    return rects
      .map((r) => parseFloat(r.getAttribute("height") || "0"))
      .map((h) => Math.round(h));
  }
  // Fall back to <circle> cy values.
  const circles = Array.from(container.querySelectorAll("circle"));
  if (circles.length) {
    return circles.map((c) => parseFloat(c.getAttribute("cy") || "0")).map((v) => Math.round(v));
  }
  return [];
}

export { COLOR as CANDLE_COLORS };
