"use strict";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const statusDetailEl = $("statusDetail");
const connectBtn = $("connectBtn");
const hostInput = $("host");
const portInput = $("port");
const hostHistory = $("hostHistory");
const bandChip = $("bandChip");
const signalDot = $("signalDot");
const signalStatus = $("signalStatus");
const mSnr = $("mSnr");
const mErr = $("mErr");
const mBw = $("mBw");
const mAdj = $("mAdj");
const mSignals = $("mSignals");
const mFloor = $("mFloor");
const activityLog = $("activityLog");
const saveBtn = $("saveBtn");
const favoritesHeader = $("favoritesHeader");
const favoritesToggle = $("favoritesToggle");
const favoritesList = $("favoritesList");
const favoritesCount = $("favoritesCount");
const spectrumCanvas = $("spectrum");
const waterfallCanvas = $("waterfall");
const legendCanvas = $("legend");
const axisEl = $("axis");
const freqInput = $("freqInput");
const floorSlider = $("floorSlider");
const floorValue = $("floorValue");
const speedSlider = $("speedSlider");
const speedValue = $("speedValue");
const scopeSlider = $("scopeSlider");
const scopeValue = $("scopeValue");
const zoomSlider = $("zoomSlider");
const zoomValue = $("zoomValue");
const smoothSlider = $("smoothSlider");
const smoothValue = $("smoothValue");
const pauseBtn = $("pauseBtn");
const grabBtn = $("grabBtn");
const timeAxisToggle = $("timeAxisToggle");
const hoverTip = $("hoverTip");
const radioPaneEl = $("radioPane");
const gainSelect = $("gainSelect");
const srSelect = $("srSelect");
const chatLog = $("chatLog");
const chatInput = $("chatInput");
const modelSelect = $("modelSelect");
const demodSelect = $("demodSelect");
const listenBtn = $("listenBtn");
const recordBtn = $("recordBtn");
const recordIndicator = $("recordIndicator");
const bwSlider = $("bwSlider");
const bwValue = $("bwValue");
const deemphSelect = $("deemphSelect");
const toneSlider = $("toneSlider");
const toneValue = $("toneValue");
const volSlider = $("volSlider");
const volValue = $("volValue");

// ---------- theme ----------
const themeSelect = $("themeSelect");

function applyTheme(theme) {
  const valid = [...themeSelect.options].some((o) => o.value === theme);
  if (!valid) theme = "black";
  document.documentElement.setAttribute("data-theme", theme);
  themeSelect.value = theme;
}

try {
  const saved = localStorage.getItem("sdr-theme");
  if (saved) applyTheme(saved);
} catch (e) { /* ignore */ }

themeSelect.addEventListener("change", () => {
  const t = themeSelect.value;
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("sdr-theme", t); } catch (e) { /* ignore */ }
});

const sctx = spectrumCanvas.getContext("2d");
const wctx = waterfallCanvas.getContext("2d");

// ---------- state ----------
let centerHz = 100000000;
let sampleRate = 2400000;
let freqs = [];
let power = [];
let viewSpan = 2400000; // displayed frequency span (Hz); a zoomed slice of the sample rate
let minSpanHz = 250000; // smallest allowed zoom span (from backend MIN_SPAN_HZ)
let lastSampleRate = 2400000; // detect sample-rate changes so we can reset zoom
let smoothing = 0; // 0..1 temporal smoothing of the spectrum trace (0 = off)
let smoothBuf = null; // EMA buffer for smoothing
let connected = false;
let prevConnected = null; // for activity-log connection transitions
let recentHosts = loadRecentHosts();
let gain = "auto";
let chatHistory = loadChatHistory(); // prior {role, content} turns
let selectedModel = ""; // empty = use backend default
let demodMode = "wfm";
let audioBandwidth = 200000; // current IF filter bandwidth (Hz)
// waterfall state
let wfImage = null, wfW = 0, wfH = 0;
let wfPaused = false;
let wfSpeed = 2; // rows per spectrum frame
let wfTimes = []; // per-row timestamps (ms) for the time axis
let showTimeAxis = true;
let spectrumRate = 30; // oscilloscope (spectrum) redraws per second
let lastSpectrumDraw = 0;
// favorites (user-saved frequencies)
let favorites = loadFavorites();
let favoritesOpen = true;
const DEMOD_BW = { am: 16000, nbfm: 16000, wfm: 200000, usb: 2700, lsb: 2700 };
const BW_RANGES = {
  am:   { min: 3000,  max: 20000,  step: 500 },
  nbfm: { min: 6000,  max: 40000,  step: 500 },
  wfm:  { min: 50000, max: 250000, step: 10000 },
  usb:  { min: 500,   max: 6000,   step: 100 },
  lsb:  { min: 500,   max: 6000,   step: 100 },
};

// ---------- colormap ----------
const STOPS = [
  [0.00, 0, 0, 30],
  [0.15, 0, 40, 140],
  [0.35, 0, 140, 190],
  [0.55, 0, 200, 120],
  [0.75, 220, 210, 40],
  [1.00, 255, 70, 30],
];
let minDb = -60, maxDb = 0; // shared spectrum/waterfall dB range (floor adjustable)

function colormap(v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, r1, g1, b1] = STOPS[i];
    const [b, r2, g2, b2] = STOPS[i + 1];
    if (v >= a && v <= b) {
      const t = (v - a) / (b - a);
      return [
        Math.round(r1 + (r2 - r1) * t),
        Math.round(g1 + (g2 - g1) * t),
        Math.round(b1 + (b2 - b1) * t),
      ];
    }
  }
  return [255, 70, 30];
}

function dbToColor(db) {
  return colormap((db - minDb) / (maxDb - minDb));
}

function fmtHz(hz) {
  if (hz >= 1e6) return (hz / 1e6).toFixed(1) + "M";
  if (hz >= 1e3) return (hz / 1e3).toFixed(1) + "k";
  return hz + " Hz";
}

// ---------- resize ----------
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w === 0 || h === 0) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    return true; // resized; caller should redraw
  }
  return false;
}

// ---------- tune marker / passband overlay ----------
function drawTuneOverlay(ctx, w, h, drawLabel) {
  const bw = audioBandwidth;
  const pw = Math.max(2, (bw / (viewSpan || 1)) * w);
  const cx = w / 2;

  // passband (demod filter width)
  ctx.fillStyle = "rgba(255, 190, 40, 0.10)";
  ctx.fillRect(cx - pw / 2, 0, pw, h);
  ctx.strokeStyle = "rgba(255, 190, 40, 0.40)";
  ctx.lineWidth = 1;
  ctx.strokeRect(cx - pw / 2, 0, pw, h);

  // center / tuned frequency line
  ctx.strokeStyle = "rgba(255, 90, 90, 0.95)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 0);
  ctx.lineTo(cx, h);
  ctx.stroke();

  if (drawLabel) {
    const label = (centerHz / 1e6).toFixed(3) + " MHz";
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
    ctx.fillRect(cx - tw / 2 - 5, 2, tw + 10, 15);
    ctx.fillStyle = "rgba(255, 130, 130, 0.95)";
    ctx.fillText(label, cx, 13);
  }
}

// ---------- spectrum + waterfall rendering ----------
function renderSpectrum() {
  const dpr = window.devicePixelRatio || 1;
  const w = spectrumCanvas.width, h = spectrumCanvas.height;
  if (w === 0) return;
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, w, h);
  if (!power.length) return;

  const n = power.length;
  const bin = sampleRate / n;
  const f0 = freqs[0];
  const left = centerHz - viewSpan / 2;
  const right = centerHz + viewSpan / 2;
  let i0 = Math.max(0, Math.floor((left - f0) / bin));
  const i1 = Math.min(n - 1, Math.ceil((right - f0) / bin));
  if (i0 > i1) return;

  const x0 = ((freqs[i0] - left) / viewSpan) * w;
  const x1 = ((freqs[i1] - left) / viewSpan) * w;

  sctx.beginPath();
  for (let i = i0; i <= i1; i++) {
    const x = ((freqs[i] - left) / viewSpan) * w;
    const y = h - ((power[i] - minDb) / (maxDb - minDb)) * (h * 0.92) - h * 0.04;
    if (i === i0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
  }
  sctx.strokeStyle = "#39d353";
  sctx.lineWidth = 1;
  sctx.stroke();
  sctx.lineTo(x1, h); sctx.lineTo(x0, h); sctx.closePath();
  sctx.fillStyle = "rgba(57, 211, 83, 0.08)";
  sctx.fill();

  // dB scale labels
  sctx.fillStyle = "#8b949e";
  sctx.font = "10px monospace";
  sctx.textAlign = "left";
  for (let db = minDb; db <= maxDb; db += 20) {
    const y = h - ((db - minDb) / (maxDb - minDb)) * (h * 0.92) - h * 0.04;
    sctx.fillText(db + " dB", 4, y - 2);
  }

  drawTuneOverlay(sctx, w, h, true);
}

function ensureWfBuffer(w, h) {
  if (wfImage && wfW === w && wfH === h) return;
  wfW = w; wfH = h;
  wfImage = wctx.createImageData(w, h);
  wfTimes = new Array(h).fill(0);
  const [fr, fg, fb] = colormap(0); // fill with the cold (noise-floor) color
  for (let i = 0; i < wfImage.data.length; i += 4) {
    wfImage.data[i] = fr; wfImage.data[i + 1] = fg; wfImage.data[i + 2] = fb; wfImage.data[i + 3] = 255;
  }
}

function renderWaterfall() {
  const w = waterfallCanvas.width, h = waterfallCanvas.height;
  if (w === 0 || h === 0 || !power.length) return;
  ensureWfBuffer(w, h);
  const data = wfImage.data;
  const n = power.length;
  const rowBytes = w * 4;

  if (!wfPaused) {
    const shift = Math.min(Math.max(1, wfSpeed), h);
    // scroll existing rows down by `shift`
    data.copyWithin(shift * rowBytes, 0, (h - shift) * rowBytes);
    wfTimes.copyWithin(shift, 0, h - shift);
    const now = Date.now();
    // draw `shift` fresh rows at the top from the current spectrum
    const bin = sampleRate / n;
    const f0 = freqs[0];
    const left = centerHz - viewSpan / 2;
    for (let r = 0; r < shift; r++) {
      wfTimes[r] = now;
      const base = r * rowBytes;
      for (let x = 0; x < w; x++) {
        const freq = left + (x / w) * viewSpan;
        let i = Math.round((freq - f0) / bin);
        if (i < 0) i = 0; else if (i >= n) i = n - 1;
        const [cr, cg, cb] = dbToColor(power[i]);
        const o = base + x * 4;
        data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = 255;
      }
    }
  }

  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.putImageData(wfImage, 0, 0);
  drawTimeAxis();
  drawTuneOverlay(wctx, w, h, false);
}

function drawTimeAxis() {
  if (!showTimeAxis) return;
  const h = waterfallCanvas.height;
  if (!h || !wfTimes.length) return;
  const ctx = wctx;
  ctx.font = "10px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const count = Math.max(2, Math.floor(h / 80));
  for (let i = 0; i <= count; i++) {
    const y = Math.min(h - 14, Math.round((i * (h - 14)) / count));
    const t = wfTimes[y];
    if (!t) continue;
    const label = new Date(t).toLocaleTimeString([], { hour12: false });
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(3, y, tw + 10, 13);
    ctx.fillStyle = "#aab4c0";
    ctx.fillText(label, 8, y + 2);
  }
  ctx.textBaseline = "alphabetic";
}

function renderLegend() {
  const c = legendCanvas;
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (cw === 0 || ch === 0) return;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
  }
  const w = c.width, h = c.height;
  const ctx = c.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = 1 - y / (h - 1); // top = maxDb (hot), bottom = minDb (cold)
    const [r, g, b] = colormap(v);
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = "#e6edf3";
  ctx.font = Math.round(9 * dpr) + "px monospace";
  ctx.textAlign = "center";
  ctx.fillText(Math.round(maxDb), w / 2, Math.round(10 * dpr));
  ctx.fillText(Math.round(minDb), w / 2, h - Math.round(3 * dpr));
}

// ---------- axis + peak labels ----------
function niceStep(span) {
  const target = span / 10;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const n = target / pow;
  let m = 1;
  if (n >= 5) m = 5; else if (n >= 2) m = 2;
  return m * pow;
}

function renderAxis() {
  axisEl.innerHTML = "";
  if (!freqs.length) return;
  const span = viewSpan;
  const left = centerHz - span / 2;
  const step = niceStep(span);
  const start = Math.ceil(left / step) * step;
  const w = spectrumCanvas.clientWidth || waterfallCanvas.clientWidth;
  for (let f = start; f < centerHz + span / 2; f += step) {
    const x = ((f - left) / span) * w;
    const t = document.createElement("span");
    t.className = "tick";
    t.style.left = x + "px";
    t.textContent = (f / 1e6).toFixed(step >= 1e6 ? 1 : 3) + " MHz";
    axisEl.appendChild(t);
  }
}

function clientPeaks() {
  if (!power.length) return [];
  const n = power.length;
  // noise floor ~ median
  const sorted = [...power].sort((a, b) => a - b);
  const noise = sorted[Math.floor(n / 2)];
  const thr = noise + 12;
  const peaks = [];
  let i = 0;
  while (i < n) {
    if (power[i] <= thr) { i++; continue; }
    let j = i;
    while (j < n && power[j] > thr) j++;
    let idx = i;
    for (let k = i; k < j; k++) if (power[k] > power[idx]) idx = k;
    peaks.push({ idx, freq: freqs[idx], db: power[idx] });
    i = j;
  }
  peaks.sort((a, b) => b.db - a.db);
  return peaks.slice(0, 8);
}

// ---------- spectrum smoothing ----------
function applySmoothing() {
  if (smoothing <= 0) { smoothBuf = null; return; }
  const n = power.length;
  if (!smoothBuf || smoothBuf.length !== n) {
    smoothBuf = Float64Array.from(power);
  } else {
    const alpha = Math.max(0.05, 1 - smoothing);
    for (let i = 0; i < n; i++) smoothBuf[i] += (power[i] - smoothBuf[i]) * alpha;
  }
  power = smoothBuf;
}

// ---------- WebSocket ----------
let ws;
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === "spectrum") {
      const centerChanged = d.center_hz !== centerHz;
      centerHz = d.center_hz;
      sampleRate = d.sample_rate;
      power = d.power;
      // Rebuild the (uniformly spaced) frequency axis client-side instead of
      // shipping one float per FFT bin over the wire every frame.
      const n = power.length;
      const bin = sampleRate / n;
      const f0 = centerHz - sampleRate / 2;
      freqs = new Float64Array(n);
      for (let i = 0; i < n; i++) freqs[i] = f0 + i * bin;
      if (d.min_span_hz != null) minSpanHz = Math.min(d.min_span_hz, sampleRate);
      if (sampleRate !== lastSampleRate) {
        lastSampleRate = sampleRate;
        viewSpan = sampleRate; // reset zoom when the hardware span changes
        configureZoomControls();
      }
      if (centerChanged) smoothBuf = null; // don't crossfade across a retune
      applySmoothing();
      bandChip.textContent = d.band || "—";
      renderInspector(d.metrics);
      if (!document.activeElement || document.activeElement !== freqInput) {
        freqInput.value = (centerHz / 1e6).toFixed(3);
      }
      const recentUserChange = Date.now() - lastConfigSent < 500;
      if (d.demod_mode !== undefined && !recentUserChange) {
        demodMode = d.demod_mode;
        if (demodSelect.value !== demodMode) demodSelect.value = demodMode;
      }
      if (d.bandwidth !== undefined && !bwDragging && !recentUserChange) {
        audioBandwidth = d.bandwidth;
        if (Number(bwSlider.value) !== audioBandwidth) bwSlider.value = audioBandwidth;
        bwValue.textContent = fmtHz(audioBandwidth);
      }
      renderSpectrumThrottled();
      renderWaterfall();
      renderAxis();
      updateStatusDetail();
    }
  };
  ws.onopen = () => sendRadioConfig();
  ws.onclose = () => setTimeout(connectWS, 1500);
  ws.onerror = () => ws.close();
}

// ---------- tuning / controls ----------
function freqFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const span = viewSpan;
  const left = centerHz - span / 2;
  return Math.round(left + (x / rect.width) * span);
}

function tune(freq) {
  freq = Math.round(freq);
  freqInput.value = (freq / 1e6).toFixed(3);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "tune", freq_hz: freq }));
}

function nearestPeak(freqHz) {
  if (!power.length) return null;
  // Snap only within a small fraction of the *visible* span (a few pixels),
  // not the full demod bandwidth / sample rate. Otherwise a zoomed-in click
  // jumps to a peak up to the whole demod bandwidth away (or off-screen).
  const thr = Math.max(viewSpan * 0.02, (sampleRate / power.length) * 2);
  let best = null, bestD = Infinity;
  for (const p of clientPeaks()) {
    const d = Math.abs(p.freq - freqHz);
    if (d < thr && d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function showHoverTip(e, canvas, freq) {
  const p = nearestPeak(freq);
  if (p) {
    hoverTip.style.display = "block";
    hoverTip.textContent = (p.freq / 1e6).toFixed(3) + " MHz · " + p.db.toFixed(1) + " dB (click to tune)";
    canvas.style.cursor = "pointer";
    const paneRect = radioPaneEl.getBoundingClientRect();
    hoverTip.style.left = (e.clientX - paneRect.left + 12) + "px";
    hoverTip.style.top = (e.clientY - paneRect.top - 12) + "px";
  } else {
    hoverTip.style.display = "none";
    canvas.style.cursor = "crosshair";
  }
}

function bindCanvasInteractions(canvas) {
  let dragging = false;
  let lastSent = 0;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    const f = freqFromEvent(e, canvas);
    const p = nearestPeak(f);
    tune(p ? p.freq : f);
  });

  canvas.addEventListener("pointermove", (e) => {
    const f = freqFromEvent(e, canvas);
    showHoverTip(e, canvas, f);
    if (dragging) {
      const now = performance.now();
      if (now - lastSent > 50) { // throttle live retunes while dragging
        lastSent = now;
        tune(f);
      }
    }
  });

  canvas.addEventListener("pointerup", (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });

  canvas.addEventListener("pointerleave", () => {
    hoverTip.style.display = "none";
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1 / 1.25 : 1.25; // scroll up = zoom in
    setZoom(viewSpan * factor);
  }, { passive: false });

  canvas.addEventListener("dblclick", () => { setZoom(sampleRate); });
}

// ---------- zoom (display span) ----------
const ZOOM_SLIDER_STEPS = 1000;

function spanToSlider(span) {
  const lo = Math.log(Math.max(minSpanHz, 1));
  const hi = Math.log(Math.max(sampleRate, 1));
  if (hi <= lo) return 0;
  const t = (Math.log(Math.max(span, 1)) - lo) / (hi - lo);
  return Math.round(Math.min(1, Math.max(0, t)) * ZOOM_SLIDER_STEPS);
}

function sliderToSpan(v) {
  const lo = Math.log(Math.max(minSpanHz, 1));
  const hi = Math.log(Math.max(sampleRate, 1));
  return Math.exp(lo + (Number(v) / ZOOM_SLIDER_STEPS) * (hi - lo));
}

function setZoom(span) {
  span = Math.min(sampleRate, Math.max(minSpanHz, span));
  if (span === viewSpan) return;
  viewSpan = span;
  updateZoomControls();
  renderSpectrum();
  renderWaterfall();
  renderAxis();
}

function updateZoomControls() {
  zoomSlider.value = spanToSlider(viewSpan);
  zoomValue.textContent = fmtHz(viewSpan);
  zoomValue.title = "span " + fmtHz(viewSpan) + " · min " + fmtHz(minSpanHz);
}

function configureZoomControls() {
  minSpanHz = Math.min(minSpanHz, sampleRate);
  zoomSlider.min = 0;
  zoomSlider.max = ZOOM_SLIDER_STEPS;
  updateZoomControls();
}

zoomSlider.addEventListener("input", () => {
  setZoom(sliderToSpan(zoomSlider.value));
});

function tuneFromInput() {
  const mhz = Number(freqInput.value);
  tune(mhz * 1e6);
  addActivity("tuned " + mhz.toFixed(3) + " MHz");
}
$("tuneBtn").addEventListener("click", tuneFromInput);
freqInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tuneFromInput(); });

// ---- connection history (recent SDR hosts) ----
function loadRecentHosts() {
  try {
    const h = JSON.parse(localStorage.getItem("sdr-recent-hosts") || "[]");
    return Array.isArray(h) ? h : [];
  } catch (e) {
    return [];
  }
}

function saveRecentHost(host, port) {
  recentHosts = recentHosts.filter((r) => r.host !== host);
  recentHosts.unshift({ host, port });
  if (recentHosts.length > 10) recentHosts.pop();
  localStorage.setItem("sdr-recent-hosts", JSON.stringify(recentHosts));
  renderHostHistory();
}

function renderHostHistory() {
  hostHistory.innerHTML = "";
  for (const r of recentHosts) {
    const o = document.createElement("option");
    o.value = r.host;
    hostHistory.appendChild(o);
  }
}

hostInput.addEventListener("input", () => {
  const host = hostInput.value.trim();
  const match = recentHosts.find((r) => r.host === host);
  if (match) portInput.value = match.port;
});

connectBtn.addEventListener("click", async () => {
  if (connected) {
    await fetch("/api/disconnect", { method: "POST" }).then((r) => r.json()).catch(() => {});
  } else {
    const host = hostInput.value.trim();
    const port = Number(portInput.value);
    if (host) {
      const r = await fetch("/api/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port }),
      }).then((r) => r.json()).catch(() => null);
      if (r && !r.error) {
        saveRecentHost(host, port);
        addActivity("connected to " + host + ":" + port);
      }
    }
  }
  refreshStatus();
});

gainSelect.addEventListener("change", () => {
  const g = gainSelect.value;
  gain = g;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "gain", gain: g }));
  updateStatusDetail();
  addActivity("gain → " + g);
  persistSettings();
});

srSelect.addEventListener("change", () => {
  const sr = Number(srSelect.value);
  sampleRate = sr;
  viewSpan = sr; // reset zoom to the new full width
  configureZoomControls();
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "sample_rate", sample_rate: sr }));
  updateStatusDetail();
  addActivity("sample rate → " + fmtHz(sr));
});

// populate gain options
const GAINS = ["auto", "0.0", "7.7", "16.6", "19.7", "24.0", "29.7", "37.2", "49.6"];
for (const g of GAINS) {
  const o = document.createElement("option");
  o.value = g; o.textContent = g === "auto" ? "auto" : g + " dB";
  gainSelect.appendChild(o);
}

// ---------- status ----------
function updateConnectButton() {
  connectBtn.textContent = connected ? "Disconnect" : "Connect";
  connectBtn.classList.toggle("connected", connected);
}

async function refreshStatus() {
  try {
    const s = await fetch("/api/status").then((r) => r.json());
    connected = !!s.connected;
    statusEl.textContent = connected ? "connected" : "disconnected";
    statusEl.classList.toggle("connected", connected);
    updateConnectButton();
    if (prevConnected !== null && prevConnected !== connected) {
      addActivity(connected ? "connected to SDR" : "disconnected from SDR");
    }
    prevConnected = connected;
    if (s.center_hz) freqInput.value = (s.center_hz / 1e6).toFixed(3);
    if (s.sample_rate) srSelect.value = String(s.sample_rate);
    if (s.gain && s.gain !== "None") {
      gain = s.gain;
      const match = [...gainSelect.options].find((o) => o.value === s.gain);
      if (match) gainSelect.value = s.gain;
    }
    updateStatusDetail();
  } catch (e) { /* ignore */ }
}

// ---------- chat ----------
function addMsg(text, role) {
  const d = document.createElement("div");
  d.className = "msg " + role;
  d.textContent = text;
  chatLog.appendChild(d);
  chatLog.scrollTop = chatLog.scrollHeight;
  return d;
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  addMsg(text, "user");

  const aiMsg = addMsg("…", "ai");
  let toolMsg = null;
  let reply = "";
  const tools = [];

  try {
    const resp = await fetch("/api/chat/stream", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory, model: selectedModel }),
    });
    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }

        if (ev.type === "token") {
          reply += ev.text;
          aiMsg.textContent = reply;
        } else if (ev.type === "tool") {
          tools.push(ev.name);
          if (!toolMsg) toolMsg = addMsg("", "tool");
          toolMsg.textContent = "🔧 " + tools.join(", ") + "…";
        } else if (ev.type === "done") {
          if (ev.reply) { reply = ev.reply; aiMsg.textContent = reply; }
        } else if (ev.type === "error") {
          aiMsg.textContent = "⚠️ " + ev.message;
          reply = "";
        }
        chatLog.scrollTop = chatLog.scrollHeight;
      }
    }
  } catch (e) {
    aiMsg.textContent = "Error: " + e;
    reply = "";
  }

  if (toolMsg) {
    toolMsg.textContent = "🔧 used tools: " + tools.join(", ");
    addActivity("AI used tools: " + tools.join(", "));
  }
  if (reply) {
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: reply });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
    persistChatHistory();
  }
}

$("chatSend").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ---- chat history persistence ----
function loadChatHistory() {
  try {
    const h = JSON.parse(localStorage.getItem("sdr-chat-history") || "[]");
    return Array.isArray(h) ? h : [];
  } catch (e) {
    return [];
  }
}

function persistChatHistory() {
  localStorage.setItem("sdr-chat-history", JSON.stringify(chatHistory));
}

function restoreChatHistory() {
  for (const h of chatHistory) {
    if (h.role === "user") addMsg(h.content, "user");
    else if (h.role === "assistant") addMsg(h.content, "ai");
  }
}

// ---- model selector ----
async function loadModels() {
  try {
    const r = await fetch("/api/models").then((r) => r.json());
    const models = r.models || [];
    const prev = selectedModel || modelSelect.value;
    modelSelect.innerHTML = "";
    for (const m of models) {
      const o = document.createElement("option");
      o.value = m;
      o.textContent = m;
      modelSelect.appendChild(o);
    }
    if (prev && models.includes(prev)) modelSelect.value = prev;
  } catch (e) {
    // leave the dropdown empty on failure
  }
}

modelSelect.addEventListener("change", () => {
  selectedModel = modelSelect.value;
});

// ---- suggestion chips ----
document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    chatInput.value = chip.dataset.prompt;
    sendChat();
  });
});

// ---------- audio (demod + playback) ----------
let audioCtx = null, gainNode = null, scriptNode = null, audioWS = null;
let audioChunks = [];
let listening = false;
let bwDragging = false;
let deemphasis = "75us";
let tone = 0; // -1..1 tilt EQ (tone control)
let volume = 0.3; // 30% default, to avoid blasting ears on first listen
let lastConfigSent = 0;
let recording = false;
let recordChunks = [];
let recordStart = 0;
let recordMeta = null;
let recordTimer = null;

function startListening() {
  if (listening) return;
  listening = true;
  listenBtn.textContent = "🔇 Stop";
  listenBtn.classList.add("listening");
  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
  gainNode = audioCtx.createGain();
  gainNode.gain.value = volume;
  gainNode.connect(audioCtx.destination);
  scriptNode = audioCtx.createScriptProcessor(4096, 0, 1);
  scriptNode.onaudioprocess = onAudioProcess;
  scriptNode.connect(gainNode);
  audioChunks = [];
  openAudioWS();
}

function openAudioWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  audioWS = new WebSocket(`${proto}://${location.host}/ws/audio`);
  audioWS.binaryType = "arraybuffer";
  audioWS.onmessage = (ev) => {
    if (typeof ev.data === "string") return; // JSON info frame
    const chunk = new Float32Array(ev.data);
    audioChunks.push(chunk);
    if (recording) recordChunks.push(chunk);
  };
  audioWS.onopen = () => {};
  audioWS.onclose = () => { if (listening) setTimeout(openAudioWS, 1000); };
}

function onAudioProcess(e) {
  const out = e.outputBuffer.getChannelData(0);
  let written = 0;
  while (written < out.length && audioChunks.length) {
    const chunk = audioChunks[0];
    const n = Math.min(chunk.length, out.length - written);
    out.set(chunk.subarray(0, n), written);
    written += n;
    if (n < chunk.length) audioChunks[0] = chunk.subarray(n);
    else audioChunks.shift();
  }
}

function stopListening() {
  if (recording) stopRecording();
  listening = false;
  listenBtn.textContent = "🔊 Listen";
  listenBtn.classList.remove("listening");
  if (audioWS) { audioWS.onclose = null; audioWS.close(); audioWS = null; }
  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  if (gainNode) { gainNode.disconnect(); gainNode = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  audioChunks = [];
}

function sendRadioConfig() {
  lastConfigSent = Date.now();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: "config", mode: demodMode, bandwidth: audioBandwidth, deemphasis, tone }));
  }
}

listenBtn.addEventListener("click", () => {
  if (listening) stopListening(); else startListening();
});

function startRecording() {
  if (recording) return;
  if (!listening) startListening();
  recording = true;
  recordChunks = [];
  recordStart = Date.now();
  recordMeta = {
    freq_hz: centerHz,
    demod_mode: demodMode,
    bandwidth_hz: audioBandwidth,
    started: new Date(),
  };
  recordBtn.textContent = "⏹ Stop";
  recordBtn.classList.add("recording");
  recordTimer = setInterval(() => {
    const secs = Math.floor((Date.now() - recordStart) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    recordIndicator.textContent = "● " + mm + ":" + ss;
  }, 500);
}

function stopRecording() {
  if (!recording) return;
  recording = false;
  if (recordTimer) { clearInterval(recordTimer); recordTimer = null; }
  recordIndicator.textContent = "";
  recordBtn.textContent = "⏺ Record";
  recordBtn.classList.remove("recording");
  if (recordChunks.length) {
    const dur = Math.max(1, Math.round((Date.now() - recordStart) / 1000));
    const wav = encodeWav(recordChunks, 48000, buildRecordMeta());
    downloadBlob(new Blob([wav], { type: "audio/wav" }), "recording-" + fileTimestamp() + ".wav");
    addActivity("recording saved: " + dur + "s");
  }
  recordChunks = [];
  recordMeta = null;
}

function encodeWav(chunks, sampleRate, meta) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const buf = new Float32Array(total);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  const pcm = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const s = Math.max(-1, Math.min(1, buf[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  const dataSize = pcm.length * 2;

  // Build a RIFF INFO (LIST-INFO) chunk from the metadata.
  const info = [];
  if (meta) {
    if (meta.title) info.push(["INAM", meta.title]);
    if (meta.comment) info.push(["ICMT", meta.comment]);
    if (meta.date) info.push(["ICRD", meta.date]);
    info.push(["ISFT", "Wideband-SDR"]);
  }
  let listSize = 0;
  if (info.length) {
    listSize = 4; // "INFO" type id
    for (const pair of info) {
      const n = pair[1].length + 1; // data + null terminator
      listSize += 8 + n + (n % 2); // tag + len + data (+ pad to even)
    }
  }

  const ab = new ArrayBuffer(44 + dataSize + (info.length ? 8 + listSize : 0));
  const v = new DataView(ab);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };

  wstr(0, "RIFF");
  v.setUint32(4, ab.byteLength - 8, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, dataSize, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);

  if (info.length) {
    let o = 44 + dataSize;
    wstr(o, "LIST");
    v.setUint32(o + 4, listSize, true);
    wstr(o + 8, "INFO");
    o += 12;
    for (const pair of info) {
      const tag = pair[0], val = pair[1];
      wstr(o, tag);
      v.setUint32(o + 4, val.length + 1, true);
      wstr(o + 8, val);
      v.setUint8(o + 8 + val.length, 0); // null terminator
      const n = val.length + 1;
      o += 8 + n + (n % 2);
    }
  }

  return ab;
}

function buildRecordMeta() {
  const m = recordMeta || { freq_hz: centerHz, demod_mode: demodMode, bandwidth_hz: audioBandwidth, started: new Date() };
  const p2 = (n) => String(n).padStart(2, "0");
  const d = m.started instanceof Date ? m.started : new Date(m.started || Date.now());
  const freqMhz = (m.freq_hz / 1e6).toFixed(3);
  const dateStr = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
  const timeStr = p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds());
  return {
    title: freqMhz + " MHz " + (m.demod_mode || "?").toUpperCase(),
    comment: "Frequency: " + freqMhz + " MHz · Demod: " + (m.demod_mode || "?").toUpperCase() +
      " · Bandwidth: " + fmtHz(m.bandwidth_hz) +
      " · Recorded: " + dateStr + " " + timeStr,
    date: dateStr,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileTimestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
    "_" + p(d.getHours()) + "-" + p(d.getMinutes()) + "-" + p(d.getSeconds());
}

function grabWaterfall() {
  const dataURL = waterfallCanvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataURL;
  a.download = "waterfall-" + fileTimestamp() + ".png";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  addActivity("waterfall image saved");
}

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording(); else startRecording();
});

demodSelect.addEventListener("change", () => {
  demodMode = demodSelect.value;
  updateBandwidthUI();
  sendRadioConfig();
  renderSpectrum(); // update passband width immediately
  addActivity("demod → " + demodMode.toUpperCase());
  persistSettings();
});

function updateBandwidthUI() {
  const r = BW_RANGES[demodMode];
  bwSlider.min = r.min; bwSlider.max = r.max; bwSlider.step = r.step;
  audioBandwidth = DEMOD_BW[demodMode];
  bwSlider.value = audioBandwidth;
  bwValue.textContent = fmtHz(audioBandwidth);
}

bwSlider.addEventListener("pointerdown", () => { bwDragging = true; });
bwSlider.addEventListener("pointerup", () => { bwDragging = false; });
bwSlider.addEventListener("input", () => {
  audioBandwidth = Number(bwSlider.value);
  bwValue.textContent = fmtHz(audioBandwidth);
  sendRadioConfig();
  renderSpectrum(); // update passband overlay width
  persistSettings();
});

volSlider.addEventListener("input", () => {
  volume = Number(volSlider.value);
  volValue.textContent = Math.round(volume * 100) + "%";
  if (gainNode) gainNode.gain.value = volume;
  persistSettings();
});

deemphSelect.addEventListener("change", () => {
  deemphasis = deemphSelect.value;
  sendRadioConfig();
  addActivity("de-emphasis → " + deemphasis);
  persistSettings();
});

toneSlider.addEventListener("input", () => {
  tone = Number(toneSlider.value);
  toneValue.textContent = tone === 0 ? "flat" : (tone > 0 ? "+" : "") + (tone * 6).toFixed(1) + " dB";
  sendRadioConfig();
  persistSettings();
});

// ---------- waterfall / status controls ----------
function updateStatusDetail() {
  const parts = [(centerHz / 1e6).toFixed(3) + " MHz",
                 "SR " + fmtHz(sampleRate),
                 "gain " + gain];
  statusDetailEl.textContent = parts.join(" · ");
}

function updateWfReadouts() {
  floorValue.textContent = Math.round(minDb) + " dB";
  speedValue.textContent = wfSpeed + "×";
  scopeValue.textContent = spectrumRate + " Hz";
  const h = waterfallCanvas.clientHeight || 420;
  const fps = 30; // backend broadcasts at ~30 fps (BROADCAST_INTERVAL 0.03)
  const secs = Math.round((h / (wfSpeed * fps)) * 10) / 10;
  speedValue.title = "full-height scroll time ≈ " + secs + " s";
}

function renderSpectrumThrottled() {
  const now = performance.now();
  if (now - lastSpectrumDraw >= 1000 / spectrumRate) {
    lastSpectrumDraw = now;
    renderSpectrum();
  }
}

floorSlider.addEventListener("input", () => {
  minDb = Number(floorSlider.value);
  renderLegend();
  renderSpectrum();
  updateWfReadouts();
  persistSettings();
});
speedSlider.addEventListener("input", () => {
  wfSpeed = Number(speedSlider.value);
  updateWfReadouts();
  persistSettings();
});
scopeSlider.addEventListener("input", () => {
  spectrumRate = Number(scopeSlider.value);
  updateWfReadouts();
  persistSettings();
});
smoothSlider.addEventListener("input", () => {
  smoothing = Number(smoothSlider.value) / 100;
  smoothValue.textContent = smoothSlider.value + "%";
  persistSettings();
});
pauseBtn.addEventListener("click", () => {
  wfPaused = !wfPaused;
  pauseBtn.textContent = wfPaused ? "▶ Resume" : "⏸ Pause";
  pauseBtn.classList.toggle("paused", wfPaused);
});

timeAxisToggle.addEventListener("change", () => {
  showTimeAxis = timeAxisToggle.checked;
});

grabBtn.addEventListener("click", grabWaterfall);

// ---------- info panel (band / inspector / activity) ----------
function renderInspector(m) {
  if (!m) return;
  const locked = !!m.signal_detected;
  signalDot.classList.toggle("locked", locked);
  signalStatus.textContent = locked ? "detected" : "no signal";
  if (!locked) {
    mSnr.textContent = mErr.textContent = mBw.textContent = mAdj.textContent = mSignals.textContent = "—";
    mFloor.textContent = (m.noise_floor_db != null ? m.noise_floor_db.toFixed(1) : "—") + " dB";
    return;
  }
  mSnr.textContent = m.snr_db.toFixed(1) + " dB";
  mErr.textContent = (m.tuning_error_hz >= 0 ? "+" : "") + fmtHz(m.tuning_error_hz);
  mBw.textContent = fmtHz(m.bandwidth_hz);
  mAdj.textContent = m.adjacent_interference_db.toFixed(1) + " dB";
  mSignals.textContent = m.num_signals_in_view + " in view";
  mFloor.textContent = m.noise_floor_db.toFixed(1) + " dB";
}

function addActivity(text) {
  const d = document.createElement("div");
  d.className = "activity";
  d.textContent = new Date().toLocaleTimeString([], { hour12: false }) + " · " + text;
  activityLog.appendChild(d);
  while (activityLog.children.length > 50) activityLog.removeChild(activityLog.firstChild);
  activityLog.scrollTop = activityLog.scrollHeight;
}

// ---------- favorites ----------
function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem("sdr-favorites") || "[]");
  } catch (e) {
    return [];
  }
}

function persistFavorites() {
  localStorage.setItem("sdr-favorites", JSON.stringify(favorites));
}

function addFavorite(name) {
  favorites.push({
    id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
    name: name,
    freq_hz: centerHz,
    demod_mode: demodMode,
    bandwidth_hz: audioBandwidth,
  });
  persistFavorites();
  renderFavorites();
}

function removeFavorite(id) {
  favorites = favorites.filter((f) => f.id !== id);
  persistFavorites();
  renderFavorites();
}

function tuneFavorite(fav) {
  tune(fav.freq_hz);
  demodMode = fav.demod_mode || demodMode;
  demodSelect.value = demodMode;
  const r = BW_RANGES[demodMode];
  bwSlider.min = r.min; bwSlider.max = r.max; bwSlider.step = r.step;
  audioBandwidth = fav.bandwidth_hz || DEMOD_BW[demodMode];
  bwSlider.value = audioBandwidth;
  bwValue.textContent = fmtHz(audioBandwidth);
  sendRadioConfig();
  renderSpectrum();
  addActivity("tuned favorite: " + fav.name);
}

function renderFavorites() {
  favoritesList.innerHTML = "";
  favoritesCount.textContent = favorites.length;
  if (!favorites.length) {
    const e = document.createElement("div");
    e.className = "fav-empty";
    e.textContent = "No favorites yet — tune a station and click ★.";
    favoritesList.appendChild(e);
    return;
  }
  const sorted = [...favorites].sort((a, b) => a.freq_hz - b.freq_hz);
  for (const fav of sorted) {
    const row = document.createElement("div");
    row.className = "fav-row";

    const main = document.createElement("button");
    main.className = "fav-main";
    main.title = "Tune to " + fav.name;

    const name = document.createElement("span");
    name.className = "fav-name";
    name.textContent = fav.name;

    const meta = document.createElement("span");
    meta.className = "fav-meta";
    meta.textContent = (fav.freq_hz / 1e6).toFixed(3) + " MHz · " + (fav.demod_mode || "?").toUpperCase();

    main.appendChild(name);
    main.appendChild(meta);
    main.addEventListener("click", () => tuneFavorite(fav));

    const remove = document.createElement("button");
    remove.className = "fav-remove";
    remove.title = "Remove " + fav.name;
    remove.textContent = "✕";
    remove.addEventListener("click", () => removeFavorite(fav.id));

    row.appendChild(main);
    row.appendChild(remove);
    favoritesList.appendChild(row);
  }
}

saveBtn.addEventListener("click", () => {
  const def = (centerHz / 1e6).toFixed(3) + " MHz";
  const name = prompt("Name this favorite:", def);
  if (name === null) return;
  addFavorite(name.trim() || def);
});

favoritesHeader.addEventListener("click", () => {
  favoritesOpen = !favoritesOpen;
  favoritesList.classList.toggle("collapsed", !favoritesOpen);
  favoritesToggle.textContent = favoritesOpen ? "−" : "+";
});

// ---------- settings persistence ----------
const DEFAULT_SETTINGS = {
  minDb: -60,
  wfSpeed: 2,
  spectrumRate: 30,
  tone: 0,
  volume: 0.3,
  demodMode: "wfm",
  audioBandwidth: 200000,
  gain: "auto",
  deemphasis: "75us",
  smoothing: 0,
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem("sdr-settings") || "{}");
    return { ...DEFAULT_SETTINGS, ...s };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings() {
  localStorage.setItem("sdr-settings", JSON.stringify({
    minDb, wfSpeed, spectrumRate, smoothing, tone, volume,
    demodMode, audioBandwidth, gain, deemphasis,
  }));
}

function applySettings() {
  const s = loadSettings();
  minDb = s.minDb;
  wfSpeed = s.wfSpeed;
  spectrumRate = s.spectrumRate;
  tone = s.tone;
  volume = s.volume;
  demodMode = s.demodMode;
  audioBandwidth = s.audioBandwidth;
  gain = s.gain;
  deemphasis = s.deemphasis;
  smoothing = s.smoothing;

  floorSlider.value = minDb;
  speedSlider.value = wfSpeed;
  scopeSlider.value = spectrumRate;
  smoothSlider.value = Math.round(smoothing * 100);
  toneSlider.value = tone;
  volSlider.value = volume;
  demodSelect.value = demodMode;
  deemphSelect.value = deemphasis;
  gainSelect.value = gain;
  const r = BW_RANGES[demodMode];
  bwSlider.min = r.min; bwSlider.max = r.max; bwSlider.step = r.step;
  bwSlider.value = audioBandwidth;

  floorValue.textContent = Math.round(minDb) + " dB";
  speedValue.textContent = wfSpeed + "×";
  scopeValue.textContent = spectrumRate + " Hz";
  smoothValue.textContent = Math.round(smoothing * 100) + "%";
  toneValue.textContent = tone === 0 ? "flat" : (tone > 0 ? "+" : "") + (tone * 6).toFixed(1) + " dB";
  volValue.textContent = Math.round(volume * 100) + "%";
  bwValue.textContent = fmtHz(audioBandwidth);
}

// ---------- init ----------
bindCanvasInteractions(spectrumCanvas);
bindCanvasInteractions(waterfallCanvas);
window.addEventListener("resize", () => {
  fitCanvas(spectrumCanvas); fitCanvas(waterfallCanvas);
  renderSpectrum(); renderWaterfall(); renderLegend(); renderAxis();
});
fitCanvas(spectrumCanvas);
fitCanvas(waterfallCanvas);
applySettings();
configureZoomControls();
renderLegend();
updateWfReadouts();
renderFavorites();
renderHostHistory();
if (recentHosts.length) {
  hostInput.value = recentHosts[0].host;
  portInput.value = recentHosts[0].port;
}
connectWS();
restoreChatHistory();
refreshStatus();
setInterval(refreshStatus, 2000);

loadModels();
