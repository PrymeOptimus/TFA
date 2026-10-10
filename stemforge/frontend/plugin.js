// DAW plug-in mode. When the UI runs inside the StemForge VST3/AU (JUCE WebView), audio is
// played by the native plug-in through the DAW's mixer; this module forwards transport and
// mix changes to it and mirrors its state back. Same interface as MixEngine in engine.js.

const backend = window.__JUCE__?.backend;
export const HOST = Boolean(backend) && new URLSearchParams(location.search).get("host") === "juce";

let nextId = 0;
const waiting = new Map();
if (backend) {
  backend.addEventListener("__juce__complete", ({ promiseId, result }) => {
    const resolve = waiting.get(promiseId);
    if (resolve) { waiting.delete(promiseId); resolve(result); }
  });
}

export const bridge = {
  call(name, ...params) {
    if (!backend) return Promise.reject(new Error("Not running inside the StemForge plug-in"));
    return new Promise((resolve) => {
      const resultId = nextId++;
      waiting.set(resultId, resolve);
      backend.emitEvent("__juce__invoke", { name, params, resultId });
    });
  },
  on(event, fn) { backend?.addEventListener(event, fn); },
};

export class PluginEngine {
  constructor() {
    this.lanes = new Map(); // id -> { buffer(ready flag), vol, mute, solo, enabled }
    this.playing = false;
    this.duration = 0;
    this.loop = { on: false, start: 0, end: 0 };
    this.offset = 0;
    this.stateAt = performance.now();
    this.native = null;     // last sf_state from the plug-in
    this.onstate = null;
    this.onended = null;
    this.ctx = null;
    this._listener = (s) => this._onState(s);
    bridge.on("sf_state", this._listener);
  }

  _onState(s) {
    this.native = s;
    if (!this.trackId || s.trackId !== this.trackId) { this.onstate?.(s); return; }
    const wasPlaying = this.playing;
    this.playing = !!s.playing;
    this.offset = s.position || 0;
    this.stateAt = performance.now();
    if (s.duration) this.duration = s.duration;
    if (!this._editingLoop && s.loop) this.loop = { on: !!s.loop.on, start: s.loop.start, end: s.loop.end };
    if (wasPlaying && !this.playing && !s.sync?.hostSync) this.onended?.();
    this.onstate?.(s);
  }

  attach(trackId) { this.trackId = trackId; return bridge.call("sf_loadTrack", trackId); }
  get ready() { return !!this.native && this.native.trackId === this.trackId && this.native.loader?.state !== "error"; }
  get hostSync() { return !!this.native?.sync?.hostSync; }

  async decode() { throw new Error("Decoding happens in the plug-in"); }
  setDuration(d) { this.duration = Math.max(this.duration, d); }
  addLane(id, ready) { this.lanes.set(id, { buffer: ready, vol: 1, mute: false, solo: false, enabled: true }); }

  set(id, patch) {
    const l = this.lanes.get(id);
    if (!l) return;
    Object.assign(l, patch);
    this._applyGains();
  }
  setMaster(v) { bridge.call("sf_setMaster", v); }

  audible(id) {
    const l = this.lanes.get(id);
    if (!l || !l.enabled || !l.buffer) return false;
    const anySolo = [...this.lanes.values()].some((x) => x.solo && x.enabled);
    return !l.mute && (!anySolo || l.solo);
  }
  levels() {
    const out = {};
    for (const [id, l] of this.lanes) out[id] = this.audible(id) ? l.vol : 0;
    return out;
  }
  _applyGains() { bridge.call("sf_setLevels", this.levels()); }

  position() {
    if (!this.playing) return this.offset;
    // Interpolate between 30 Hz state updates for a smooth playhead.
    let p = this.offset + (performance.now() - this.stateAt) / 1000;
    const { on, start, end } = this.loop;
    if (on && end > start && p >= end) p = start + ((p - start) % (end - start));
    return Math.min(Math.max(p, 0), this.duration || p);
  }

  async play() { await bridge.call("sf_transport", { action: "play" }); this.playing = true; this.stateAt = performance.now(); }
  pause() { bridge.call("sf_transport", { action: "pause" }); this.offset = this.position(); this.playing = false; }
  stop() { bridge.call("sf_transport", { action: "stop" }); this.offset = 0; this.playing = false; }
  async seek(t) { this.offset = t; this.stateAt = performance.now(); await bridge.call("sf_transport", { action: "seek", time: t }); }
  async setLoop(patch) {
    Object.assign(this.loop, patch);
    await bridge.call("sf_transport", { action: "loop", ...this.loop });
  }

  reset() { this.lanes.clear(); this.trackId = null; this.onstate = null; }
}

/** Server peaks ({mix|stems: int[] scaled to ±1000}) -> the shape drawWave expects. */
export function serverPeaks(arr, scale = 1000) {
  if (!arr) return null;
  const data = new Float32Array(arr.length);
  let maxAbs = 0;
  for (let i = 0; i < arr.length; i++) {
    data[i] = arr[i] / scale;
    maxAbs = Math.max(maxAbs, Math.abs(data[i]));
  }
  return { data, buckets: arr.length / 2, maxAbs };
}
