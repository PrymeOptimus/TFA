import { MixEngine, computePeaks, drawWave } from "./engine.js";

const $ = (s, el = document) => el.querySelector(s);
const ACCEPT = [".wav", ".mp3", ".m4a", ".flac"];
const LS_LAST = "stemforge:lastTrack";

const state = {
  track: null,
  engine: null,
  mixPeaks: null,
  lanes: new Map(), // id -> { el, entry, peaks }
  guitarSplit: false,
  pollTimer: null,
  raf: 0,
  loadToken: 0,
};

// Low-memory devices decode at 22.05 kHz to roughly halve RAM for 10+ stems.
const LITE = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
  (window.matchMedia("(max-width: 700px)").matches && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));

// ---------------------------------------------------------------- utilities
function fmtTime(s, tenths = false) {
  if (!isFinite(s)) s = 0;
  const m = Math.floor(s / 60), sec = s - m * 60;
  return tenths ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(sec)).padStart(2, "0")}`;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = `toast ${kind}`; t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), 5200);
}
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  if (!r.ok) {
    let detail = r.statusText;
    try { detail = (await r.json()).detail || detail; } catch { /* not json */ }
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = r.status; throw err;
  }
  return r;
}
function triggerDownload(url, name) {
  const a = document.createElement("a");
  a.href = url; if (name) a.download = name;
  document.body.append(a); a.click(); a.remove();
}

// ---------------------------------------------------------------- upload
const dropzone = $("#dropzone"), fileInput = $("#fileInput");
["dragenter", "dragover"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("over"); }));
dropzone.addEventListener("drop", (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length > 1) toast("One file at a time — using the first one.");
  if (files[0]) upload(files[0]);
});
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", () => { if (fileInput.files[0]) upload(fileInput.files[0]); fileInput.value = ""; });
// Allow dropping anywhere on the page while the upload card is visible.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (!$("#dropSection").hidden && !dropzone.contains(e.target) && e.dataTransfer?.files[0]) upload(e.dataTransfer.files[0]);
});

function upload(file) {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!ACCEPT.includes(ext)) { toast(`Unsupported file type ${ext}. Use WAV, MP3, M4A or FLAC.`, "error"); return; }
  const status = $("#uploadStatus"), bar = $("#uploadBar"), text = $("#uploadText");
  status.hidden = false; bar.style.width = "0%"; text.textContent = `Uploading ${file.name}…`;
  const fd = new FormData(); fd.append("file", file);
  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/tracks");
  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const p = e.loaded / e.total; bar.style.width = `${(p * 100).toFixed(0)}%`;
    if (p >= 1) text.textContent = "Analysing tempo, key and style…";
  };
  xhr.onload = () => {
    status.hidden = true;
    let body = {};
    try { body = JSON.parse(xhr.responseText); } catch { /* ignore */ }
    if (xhr.status !== 200) { toast(body.detail || `Upload failed (${xhr.status})`, "error"); return; }
    openTrack(body);
    refreshHistory();
  };
  xhr.onerror = () => { status.hidden = true; toast("Upload failed — is the StemForge server running?", "error"); };
  xhr.send(fd);
}

// ---------------------------------------------------------------- track view
async function openTrack(meta) {
  const token = ++state.loadToken;
  teardownMixer();
  state.track = meta;
  try { localStorage.setItem(LS_LAST, meta.id); } catch { /* storage unavailable */ }
  $("#dropSection").hidden = true;
  $("#trackSection").hidden = false;
  $("#newTrackBtn").hidden = false;
  renderTrackHeader(meta);
  renderSeparateState(meta);
  markHistoryActive();

  state.engine = new MixEngine({ lite: LITE });
  state.engine.onended = () => setPlayingUI(false);
  try {
    const buf = await (await api(`/api/tracks/${meta.id}/mix`)).arrayBuffer();
    const audio = await state.engine.decode(buf);
    if (token !== state.loadToken) return;
    state.engine.setDuration(audio.duration);
    state.mixPeaks = computePeaks(audio);
    state.mixBuffer = audio;
    drawMix();
  } catch (e) {
    toast(`Could not load waveform: ${e.message}`, "error");
  }
  if (meta.status === "done") await buildMixer(meta, token);
  else if (meta.status === "processing" || meta.status === "queued") poll(meta.id);
}

function renderTrackHeader(meta) {
  const a = meta.analysis || {};
  $("#trackTitle").textContent = meta.title;
  $("#trackFile").textContent = meta.original_filename;
  const style = a.style || {};
  const chips = [
    ["Tempo", a.bpm ? `${a.bpm} BPM` : "—"],
    ["Key", a.key || "—", a.key_confidence != null && a.key_confidence < 0.35 ? "low conf." : ""],
    ["Duration", fmtTime(a.duration_sec || 0)],
    ["Style", style.label || "—", style.method === "heuristic" ? "est." : ""],
  ];
  $("#trackChips").replaceChildren(...chips.map(([k, v, note]) => {
    const c = document.createElement("div"); c.className = "chip";
    c.innerHTML = `<small></small><b></b>`;
    c.querySelector("small").textContent = k;
    c.querySelector("b").textContent = v;
    if (note) { const e = document.createElement("span"); e.className = "est"; e.textContent = note; c.querySelector("small").append(e); }
    if (k === "Style" && style.alternatives) c.title = `Heuristic estimate. Alternatives: ${style.alternatives.join(", ")}`;
    return c;
  }));
}

function renderSeparateState(meta) {
  const btn = $("#separateBtn"), prog = $("#sepProgress"), err = $("#trackError"), note = $("#engineNote");
  err.hidden = !meta.error; err.textContent = meta.error ? `Separation failed: ${meta.error}` : "";
  note.hidden = !meta.engine_note; note.textContent = meta.engine_note || "";
  const busy = meta.status === "processing" || meta.status === "queued";
  prog.hidden = !busy;
  btn.hidden = busy || meta.status === "done";
  btn.textContent = meta.status === "error" ? "Retry separation" : "Separate stems";
  if (busy) {
    $("#sepBar").style.width = `${Math.round((meta.progress || 0) * 100)}%`;
    $("#sepStage").textContent = `${meta.stage || "Working"} — ${Math.round((meta.progress || 0) * 100)}%`;
  }
}

$("#separateBtn").addEventListener("click", async () => {
  if (!state.track) return;
  try {
    const meta = await (await api(`/api/tracks/${state.track.id}/separate`, { method: "POST" })).json();
    state.track = meta; renderSeparateState(meta); poll(meta.id);
  } catch (e) { toast(e.message, "error"); }
});

function poll(id) {
  clearTimeout(state.pollTimer);
  const tick = async () => {
    if (!state.track || state.track.id !== id) return;
    try {
      const meta = await (await api(`/api/tracks/${id}`)).json();
      state.track = meta;
      renderSeparateState(meta);
      if (meta.status === "done") { refreshHistory(); await buildMixer(meta, state.loadToken); return; }
      if (meta.status === "error") { refreshHistory(); return; }
    } catch (e) { /* transient; keep polling */ }
    state.pollTimer = setTimeout(tick, 1000);
  };
  tick();
}

// ---------------------------------------------------------------- mixer
async function buildMixer(meta, token) {
  const eng = state.engine;
  $("#mixerSection").hidden = false;
  $("#liteNote").hidden = !LITE;
  $("#zipBtn").href = `/api/tracks/${meta.id}/zip`;
  $("#timeTotal").textContent = fmtTime(meta.analysis.duration_sec);
  const lanesEl = $("#lanes");
  lanesEl.replaceChildren();
  state.lanes.clear();
  state.guitarSplit = false;
  const hasSplit = meta.stems.some((s) => s.parent === "guitar" && s.status === "ok");

  for (const entry of meta.stems) {
    const el = $("#laneTpl").content.firstElementChild.cloneNode(true);
    el.style.setProperty("--c", `var(--c-${entry.id})`);
    el.dataset.id = entry.id;
    $(".lane-name strong", el).textContent = entry.label;
    const sub = $(".lane-sub", el);
    if (entry.parent) el.classList.add("sub");
    if (entry.parent && !hasSplit) continue; // sub-split unavailable → no lane
    if (entry.parent) el.hidden = true;

    if (entry.status !== "ok") {
      el.classList.add("nd");
      sub.innerHTML = `<span class="badge nd">Not detected</span>`;
      if (entry.note) sub.append(entry.note);
      $(".lane-empty", el).textContent = "Not detected in this track";
      $(".dl", el).classList.add("disabled");
    } else {
      const bits = [];
      if (entry.low_confidence) bits.push(`<span class="badge low" title="Confidence ${entry.confidence}">Low confidence — may contain bleed</span>`);
      else if (entry.flag) bits.push(`<span class="badge nd">${entry.flag}</span>`);
      else if (entry.confidence != null) bits.push(`<span class="badge ok" title="Estimated separation confidence">${Math.round(entry.confidence * 100)}%</span>`);
      sub.innerHTML = bits.join("");
      sub.append(entry.character || entry.description);
      $(".lane-empty", el).textContent = "Loading…";
      const dl = $(".dl", el);
      dl.href = `/api/tracks/${meta.id}/stems/${entry.id}?download=true`;
      dl.download = entry.download_name;
      dl.title = `Download ${entry.download_name}`;
    }
    if (entry.id === "guitar" && hasSplit) {
      const t = document.createElement("button");
      t.className = "btn split-toggle keep"; t.setAttribute("aria-pressed", "false");
      t.textContent = "Split electric / acoustic";
      t.addEventListener("click", () => setGuitarSplit(!state.guitarSplit));
      $(".lane-name", el).append(t);
    }
    wireLane(el, entry);
    lanesEl.append(el);
    state.lanes.set(entry.id, { el, entry, peaks: null });
    eng.addLane(entry.id, null);
    if (entry.parent) eng.set(entry.id, { enabled: false });
  }

  // Decode stems in parallel (bounded) so the first lanes appear quickly.
  const toLoad = meta.stems.filter((s) => s.status === "ok" && state.lanes.has(s.id));
  const loadNote = $("#loadNote");
  let done = 0;
  loadNote.hidden = false; loadNote.textContent = `Loading stems 0/${toLoad.length}…`;
  setTransportEnabled(false);
  const queue = [...toLoad];
  const worker = async () => {
    while (queue.length) {
      const entry = queue.shift();
      try {
        const buf = await (await api(`/api/tracks/${meta.id}/stems/${entry.id}`)).arrayBuffer();
        const audio = await eng.decode(buf);
        if (token !== state.loadToken) return;
        const lane = state.lanes.get(entry.id);
        eng.lanes.get(entry.id).buffer = audio;
        eng.setDuration(audio.duration);
        lane.peaks = computePeaks(audio);
        $(".lane-empty", lane.el).textContent = "";
        drawLane(entry.id);
      } catch (e) {
        if (token !== state.loadToken) return;
        const lane = state.lanes.get(entry.id);
        if (lane) $(".lane-empty", lane.el).textContent = `Failed to load: ${e.message}`;
      }
      done++; loadNote.textContent = `Loading stems ${done}/${toLoad.length}…`;
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (token !== state.loadToken) return;
  loadNote.hidden = true;
  eng._applyGains();
  setTransportEnabled(true);
  syncLaneVisuals();
  startRaf();
}

function wireLane(el, entry) {
  const id = entry.id;
  const mute = $(".mute", el), solo = $(".solo", el), fader = $(".fader", el);
  mute.addEventListener("click", () => {
    const v = mute.getAttribute("aria-pressed") !== "true";
    mute.setAttribute("aria-pressed", String(v)); state.engine.set(id, { mute: v }); syncLaneVisuals();
  });
  solo.addEventListener("click", (e) => {
    const v = solo.getAttribute("aria-pressed") !== "true";
    if (e.altKey || e.metaKey) { // exclusive solo
      for (const [oid, l] of state.lanes) { $(".solo", l.el).setAttribute("aria-pressed", "false"); state.engine.set(oid, { solo: false }); }
    }
    solo.setAttribute("aria-pressed", String(v)); state.engine.set(id, { solo: v }); syncLaneVisuals();
  });
  fader.addEventListener("input", () => state.engine.set(id, { vol: parseFloat(fader.value) }));
  fader.addEventListener("dblclick", () => { fader.value = 1; state.engine.set(id, { vol: 1 }); });

  const btn = $(".send-btn", el), menu = $(".send-menu", el);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".send-menu").forEach((m) => { if (m !== menu) m.hidden = true; });
    menu.hidden = !menu.hidden;
  });
  menu.addEventListener("click", (e) => {
    const target = e.target.closest("button")?.dataset.target;
    if (!target) return;
    menu.hidden = true;
    sendStem(entry, target);
  });
  attachWaveInteractions($(".lane-wave", el), false);
}
document.addEventListener("click", () => document.querySelectorAll(".send-menu").forEach((m) => (m.hidden = true)));

async function sendStem(entry, target) {
  const label = target[0].toUpperCase() + target.slice(1);
  try {
    await api(`/api/tracks/${state.track.id}/stems/${entry.id}/send`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }),
    });
    toast(`${entry.label} sent to ${label}.`);
  } catch (e) {
    if (e.status === 501) {
      toast(`No ${label} integration is configured on this server — downloading the stem so you can upload it manually.`);
      triggerDownload(`/api/tracks/${state.track.id}/stems/${entry.id}?download=true`, entry.download_name);
    } else toast(`Send to ${label} failed: ${e.message}`, "error");
  }
}

function setGuitarSplit(on) {
  state.guitarSplit = on;
  const eng = state.engine;
  eng.set("guitar", { enabled: !on });
  for (const [id, l] of state.lanes) {
    if (l.entry.parent === "guitar") { l.el.hidden = !on; eng.set(id, { enabled: on }); if (on) requestAnimationFrame(() => drawLane(id)); }
  }
  const t = $(".split-toggle", state.lanes.get("guitar").el);
  t.setAttribute("aria-pressed", String(on));
  t.textContent = on ? "Merge guitar" : "Split electric / acoustic";
  syncLaneVisuals();
}

function syncLaneVisuals() {
  for (const [id, l] of state.lanes) {
    l.el.classList.toggle("silenced", l.entry.status === "ok" && !state.engine.audible(id));
  }
}

function setTransportEnabled(on) {
  ["#playBtn", "#stopBtn", "#loopBtn", "#recombineBtn"].forEach((s) => $(s).classList.toggle("disabled", !on));
  $("#zipBtn").classList.toggle("disabled", !on);
}

// ---------------------------------------------------------------- drawing
function drawMix() {
  const canvas = $("#mixWave canvas");
  drawWave(canvas, state.mixPeaks, cssVar("--accent"), { normalize: state.mixPeaks ? 0.95 / Math.max(state.mixPeaks.maxAbs, 1e-3) : 1 });
  renderLoopRegions();
}
function drawLane(id) {
  const l = state.lanes.get(id);
  if (!l || !l.peaks || l.el.hidden) return;
  // Scale relative to the mix so levels read honestly, but lift quiet stems (max 4x) so their shape stays visible.
  const mixNorm = 0.95 / Math.max(state.mixPeaks?.maxAbs || l.peaks.maxAbs, 1e-3);
  const selfNorm = 0.95 / Math.max(l.peaks.maxAbs, 1e-4);
  const norm = Math.min(selfNorm, mixNorm * 4);
  drawWave($("canvas", l.el), l.peaks, cssVar(`--c-${id}`), { normalize: norm });
}
let resizeT;
window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { drawMix(); for (const id of state.lanes.keys()) drawLane(id); }, 120);
});

function startRaf() {
  cancelAnimationFrame(state.raf);
  const frame = () => {
    updatePlayheads();
    state.raf = requestAnimationFrame(frame);
  };
  state.raf = requestAnimationFrame(frame);
}
function updatePlayheads() {
  const eng = state.engine;
  if (!eng || !eng.duration) return;
  const p = eng.position(), frac = p / eng.duration;
  $("#timeNow").textContent = fmtTime(p, true);
  document.querySelectorAll(".mix-wave .playhead, .lane-wave .playhead").forEach((ph) => {
    ph.style.transform = `translateX(${frac * ph.parentElement.clientWidth}px)`;
  });
}

// ---------------------------------------------------------------- seek + loop
function attachWaveInteractions(el, isMaster) {
  let startX = null, rect = null, dragging = false;
  const toTime = (clientX) => Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * (state.engine?.duration || 0);
  el.addEventListener("pointerdown", (e) => {
    if (!state.engine?.duration || el.closest(".lane.nd")) return;
    rect = el.getBoundingClientRect(); startX = e.clientX; dragging = false;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (startX === null) return;
    if (!dragging && Math.abs(e.clientX - startX) > 6) dragging = true;
    if (dragging) {
      const a = toTime(startX), b = toTime(e.clientX);
      state.engine.loop.start = Math.min(a, b); state.engine.loop.end = Math.max(a, b);
      renderLoopRegions();
    }
  });
  el.addEventListener("pointerup", async (e) => {
    if (startX === null) return;
    if (dragging) {
      const { start, end } = state.engine.loop;
      if (end - start > 0.1) { await state.engine.setLoop({ on: true, start, end }); setLoopUI(true); }
    } else {
      await state.engine.seek(toTime(e.clientX));
    }
    startX = null; dragging = false;
    renderLoopRegions(); updatePlayheads();
  });
}
attachWaveInteractions($("#mixWave"), true);

function renderLoopRegions() {
  const eng = state.engine;
  const has = eng && eng.duration && eng.loop.end - eng.loop.start > 0.05;
  document.querySelectorAll(".loop-region").forEach((r) => {
    r.hidden = !has;
    if (!has) return;
    r.style.left = `${(eng.loop.start / eng.duration) * 100}%`;
    r.style.width = `${((eng.loop.end - eng.loop.start) / eng.duration) * 100}%`;
    r.classList.toggle("off", !eng.loop.on);
  });
  $("#loopReadout").textContent = has ? `Loop ${fmtTime(eng.loop.start, true)} – ${fmtTime(eng.loop.end, true)}` : "";
}

// ---------------------------------------------------------------- transport
function setPlayingUI(on) { $("#playBtn").classList.toggle("playing", on); $("#playBtn").setAttribute("aria-label", on ? "Pause" : "Play"); }
function setLoopUI(on) { $("#loopBtn").setAttribute("aria-pressed", String(on)); renderLoopRegions(); }

$("#playBtn").addEventListener("click", togglePlay);
async function togglePlay() {
  const eng = state.engine;
  if (!eng || $("#playBtn").classList.contains("disabled")) return;
  if (eng.playing) { eng.pause(); setPlayingUI(false); }
  else { await eng.play(); setPlayingUI(true); }
}
$("#stopBtn").addEventListener("click", () => { state.engine?.stop(); setPlayingUI(false); updatePlayheads(); });
$("#loopBtn").addEventListener("click", async () => {
  const eng = state.engine; if (!eng) return;
  const on = !eng.loop.on;
  if (on && eng.loop.end - eng.loop.start < 0.1) {
    // No region yet: default to 4 bars from the playhead (or 8 s without a tempo).
    const bpm = state.track?.analysis?.bpm;
    const len = bpm ? (60 / bpm) * 16 : 8;
    const s = eng.position();
    await eng.setLoop({ start: s, end: Math.min(eng.duration, s + len), on: true });
  } else await eng.setLoop({ on });
  setLoopUI(on);
});
$("#masterVol").addEventListener("input", (e) => state.engine?.setMaster(parseFloat(e.target.value)));
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea") && e.target.type !== "range") return;
  if (e.code === "Space" && !$("#mixerSection").hidden) { e.preventDefault(); togglePlay(); }
  if (e.key === "l" && !$("#mixerSection").hidden) $("#loopBtn").click();
});

$("#recombineBtn").addEventListener("click", async () => {
  const btn = $("#recombineBtn");
  const levels = state.engine.levels();
  if (!Object.values(levels).some((v) => v > 0)) { toast("Everything is muted — nothing to bounce.", "error"); return; }
  btn.classList.add("disabled"); btn.textContent = "Bouncing…";
  try {
    const r = await api(`/api/tracks/${state.track.id}/recombine`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ levels }),
    });
    const blob = await r.blob();
    const cd = r.headers.get("content-disposition") || "";
    const name = decodeURIComponent((cd.match(/filename\*=utf-8''([^;]+)/i) || cd.match(/filename="?([^";]+)"?/i) || [])[1] || "Recombined.wav");
    const url = URL.createObjectURL(blob);
    triggerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(r.headers.get("x-peak-normalized") === "1" ? `Bounced ${name} (peak-normalised to avoid clipping).` : `Bounced ${name}.`);
  } catch (e) { toast(`Recombine failed: ${e.message}`, "error"); }
  btn.classList.remove("disabled"); btn.textContent = "Recombine";
});

function teardownMixer() {
  clearTimeout(state.pollTimer);
  cancelAnimationFrame(state.raf);
  if (state.engine) { state.engine.reset(); state.engine.ctx.close?.(); }
  state.engine = null; state.mixPeaks = null; state.mixBuffer = null;
  state.lanes.clear();
  $("#lanes").replaceChildren();
  $("#mixerSection").hidden = true;
  setPlayingUI(false); setLoopUI(false);
}

$("#newTrackBtn").addEventListener("click", () => {
  state.loadToken++;
  teardownMixer();
  state.track = null;
  try { localStorage.removeItem(LS_LAST); } catch { /* ignore */ }
  $("#trackSection").hidden = true; $("#dropSection").hidden = false; $("#newTrackBtn").hidden = true;
  markHistoryActive();
});

// ---------------------------------------------------------------- history
const drawer = $("#historyPanel"), scrim = $("#scrim");
function setDrawer(open) {
  drawer.classList.toggle("open", open); drawer.setAttribute("aria-hidden", String(!open));
  $("#historyBtn").setAttribute("aria-expanded", String(open)); scrim.hidden = !open;
  if (open) refreshHistory();
}
$("#historyBtn").addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
$("#historyClose").addEventListener("click", () => setDrawer(false));
scrim.addEventListener("click", () => setDrawer(false));

async function refreshHistory() {
  try {
    const items = await (await api("/api/history")).json();
    const list = $("#historyList");
    if (!items.length) { list.innerHTML = `<li class="dim small">No tracks yet.</li>`; return; }
    list.replaceChildren(...items.map((h) => {
      const li = document.createElement("li"); li.dataset.id = h.id;
      const b = document.createElement("button");
      const statusTxt = { done: "Separated", uploaded: "Analysed", processing: "Processing…", queued: "Queued", error: "Failed" }[h.status] || h.status;
      b.innerHTML = `<strong></strong><span class="meta"></span>`;
      b.querySelector("strong").textContent = h.title;
      b.querySelector(".meta").textContent = [h.bpm ? `${h.bpm} BPM` : null, h.key, fmtTime(h.duration_sec || 0), statusTxt].filter(Boolean).join(" · ");
      b.addEventListener("click", async () => {
        setDrawer(false);
        try { openTrack(await (await api(`/api/tracks/${h.id}`)).json()); } catch (e) { toast(e.message, "error"); }
      });
      li.append(b); return li;
    }));
    markHistoryActive();
  } catch { /* server offline */ }
}
function markHistoryActive() {
  document.querySelectorAll("#historyList li").forEach((li) => li.classList.toggle("active", li.dataset.id === state.track?.id));
}

// ---------------------------------------------------------------- boot
(async function boot() {
  refreshHistory();
  let last = null;
  try { last = localStorage.getItem(LS_LAST); } catch { /* ignore */ }
  if (last) {
    try { openTrack(await (await api(`/api/tracks/${last}`)).json()); } catch { try { localStorage.removeItem(LS_LAST); } catch { /* ignore */ } }
  }
})();
