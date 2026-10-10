"use strict";

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const statusEl = $("status");
const statusDetailEl = $("statusDetail");
const connectBtn = $("connectBtn");
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
const spectrumCanvas = $("spectrum");
const waterfallCanvas = $("waterfall");
const legendCanvas = $("legend");
const axisEl = $("axis");
const freqInput = $("freqInput");
const floorSlider = $("floorSlider");
const floorValue = $("floorValue");
const speedSlider = $("speedSlider");
const speedValue = $("speedValue");
const pauseBtn = $("pauseBtn");
const hoverTip = $("hoverTip");
const radioPaneEl = $("radioPane");
const gainSelect = $("gainSelect");
const srSelect = $("srSelect");
const chatLog = $("chatLog");
const chatInput = $("chatInput");
const demodSelect = $("demodSelect");
const listenBtn = $("listenBtn");
const bwSlider = $("bwSlider");
const bwValue = $("bwValue");
const deemphSelect = $("deemphSelect");
const toneSlider = $("toneSlider");
const toneValue = $("toneValue");
const volSlider = $("volSlider");
const volValue = $("volValue");

const sctx = spectrumCanvas.getContext("2d");
const wctx = waterfallCanvas.getContext("2d");

// ---------- state ----------
let centerHz = 100000000;
let sampleRate = 2400000;
let freqs = [];
let power = [];
let connected = false;
let prevConnected = null; // for activity-log connection transitions
let gain = "auto";
let chatHistory = []; // prior {role, content} turns
let demodMode = "nbfm";
let audioBandwidth = 16000; // current IF filter bandwidth (Hz)
// waterfall state
let wfImage = null, wfW = 0, wfH = 0;
let wfPaused = false;
let wfSpeed = 2; // rows per spectrum frame
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
let minDb = -80, maxDb = 0; // shared spectrum/waterfall dB range (floor adjustable)

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
  const span = sampleRate || 1;
  const pw = Math.max(2, (bw / span) * w);
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
  sctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w;
    const y = h - ((power[i] - minDb) / (maxDb - minDb)) * (h * 0.92) - h * 0.04;
    if (i === 0) sctx.moveTo(x, y); else sctx.lineTo(x, y);
  }
  sctx.strokeStyle = "#39d353";
  sctx.lineWidth = 1;
  sctx.stroke();
  sctx.lineTo(w, h); sctx.lineTo(0, h); sctx.closePath();
  sctx.fillStyle = "rgba(57, 211, 83, 0.08)";
  sctx.fill();

  // peak frequency labels
  const span = sampleRate, left = centerHz - span / 2;
  sctx.fillStyle = "#ffd166";
  sctx.font = "10px monospace";
  sctx.textAlign = "center";
  let lastX = -1e9;
  for (const p of clientPeaks()) {
    const x = ((p.freq - left) / span) * w;
    if (x < 20 || x > w - 20 || Math.abs(x - lastX) < 46) continue;
    lastX = x;
    sctx.fillText((p.freq / 1e6).toFixed(3), x, 10);
  }

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
    // draw `shift` fresh rows at the top from the current spectrum
    for (let r = 0; r < shift; r++) {
      const base = r * rowBytes;
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * n);
        const [cr, cg, cb] = dbToColor(power[i]);
        const o = base + x * 4;
        data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = 255;
      }
    }
  }

  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.putImageData(wfImage, 0, 0);
  drawTuneOverlay(wctx, w, h, false);
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
  const span = sampleRate;
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

// ---------- WebSocket ----------
let ws;
function connectWS() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === "spectrum") {
      centerHz = d.center_hz;
      sampleRate = d.sample_rate;
      freqs = d.freqs;
      power = d.power;
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
      renderSpectrum();
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
  const span = sampleRate;
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
  const thr = Math.max(audioBandwidth, sampleRate * 0.01);
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
    const opts = [...srSelect.options].map((o) => Number(o.value));
    const idx = opts.indexOf(sampleRate);
    const next = e.deltaY < 0 ? idx - 1 : idx + 1; // scroll up = zoom in (smaller SR)
    if (next >= 0 && next < opts.length && next !== idx) {
      sampleRate = opts[next];
      srSelect.value = String(opts[next]);
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "sample_rate", sample_rate: opts[next] }));
      }
      updateStatusDetail();
    }
  }, { passive: false });
}

function tuneFromInput() {
  const mhz = Number(freqInput.value);
  tune(mhz * 1e6);
  addActivity("tuned " + mhz.toFixed(3) + " MHz");
}
$("tuneBtn").addEventListener("click", tuneFromInput);
freqInput.addEventListener("keydown", (e) => { if (e.key === "Enter") tuneFromInput(); });

connectBtn.addEventListener("click", async () => {
  if (connected) {
    await fetch("/api/disconnect", { method: "POST" }).then((r) => r.json()).catch(() => {});
  } else {
    const host = $("host").value.trim();
    const port = Number($("port").value);
    await fetch("/api/connect", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host, port }),
    }).then((r) => r.json()).catch(() => {});
  }
  refreshStatus();
});

gainSelect.addEventListener("change", () => {
  const g = gainSelect.value;
  gain = g;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "gain", gain: g }));
  updateStatusDetail();
  addActivity("gain → " + g);
});

srSelect.addEventListener("change", () => {
  const sr = Number(srSelect.value);
  sampleRate = sr;
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
  const thinking = addMsg("…", "ai");
  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, history: chatHistory }),
    }).then((r) => r.json());
    thinking.remove();
    if (r.tools_called && r.tools_called.length) {
      addMsg("🔧 used tools: " + r.tools_called.join(", "), "tool");
      addActivity("AI used tools: " + r.tools_called.join(", "));
    }
    addMsg(r.reply || "(no reply)", "ai");
    // update shared history for context
    chatHistory.push({ role: "user", content: text });
    chatHistory.push({ role: "assistant", content: r.reply || "" });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
  } catch (e) {
    thinking.remove();
    addMsg("Error: " + e, "error");
  }
}

$("chatSend").addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ---------- audio (demod + playback) ----------
let audioCtx = null, gainNode = null, scriptNode = null, audioWS = null;
let audioChunks = [];
let listening = false;
let bwDragging = false;
let deemphasis = "75us";
let tone = 0; // -1..1 tilt EQ (tone control)
let volume = 1.0;
let lastConfigSent = 0;

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
    audioChunks.push(new Float32Array(ev.data));
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

demodSelect.addEventListener("change", () => {
  demodMode = demodSelect.value;
  updateBandwidthUI();
  sendRadioConfig();
  renderSpectrum(); // update passband width immediately
  addActivity("demod → " + demodMode.toUpperCase());
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
});

volSlider.addEventListener("input", () => {
  volume = Number(volSlider.value);
  volValue.textContent = Math.round(volume * 100) + "%";
  if (gainNode) gainNode.gain.value = volume;
});

deemphSelect.addEventListener("change", () => {
  deemphasis = deemphSelect.value;
  sendRadioConfig();
  addActivity("de-emphasis → " + deemphasis);
});

toneSlider.addEventListener("input", () => {
  tone = Number(toneSlider.value);
  toneValue.textContent = tone === 0 ? "flat" : (tone > 0 ? "+" : "") + (tone * 6).toFixed(1) + " dB";
  sendRadioConfig();
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
  const h = waterfallCanvas.clientHeight || 420;
  const fps = 30; // backend broadcasts at ~30 fps (BROADCAST_INTERVAL 0.03)
  const secs = Math.round((h / (wfSpeed * fps)) * 10) / 10;
  speedValue.title = "full-height scroll time ≈ " + secs + " s";
}

floorSlider.addEventListener("input", () => {
  minDb = Number(floorSlider.value);
  renderLegend();
  renderSpectrum();
  updateWfReadouts();
});
speedSlider.addEventListener("input", () => {
  wfSpeed = Number(speedSlider.value);
  updateWfReadouts();
});
pauseBtn.addEventListener("click", () => {
  wfPaused = !wfPaused;
  pauseBtn.textContent = wfPaused ? "▶ Resume" : "⏸ Pause";
  pauseBtn.classList.toggle("paused", wfPaused);
});

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

// ---------- init ----------
bindCanvasInteractions(spectrumCanvas);
bindCanvasInteractions(waterfallCanvas);
window.addEventListener("resize", () => {
  fitCanvas(spectrumCanvas); fitCanvas(waterfallCanvas);
  renderSpectrum(); renderWaterfall(); renderLegend(); renderAxis();
});
fitCanvas(spectrumCanvas);
fitCanvas(waterfallCanvas);
renderLegend();
updateWfReadouts();
updateBandwidthUI();
connectWS();
refreshStatus();
setInterval(refreshStatus, 2000);

// fetch model name for header
fetch("/api/status").then(() => {
  // model name comes via /api/chat; show generic for now
  $("modelName").textContent = "";
});
