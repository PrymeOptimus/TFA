// Multitrack playback engine on the Web Audio API.
// All stem sources start against the same AudioContext timestamp, so they stay
// sample-locked; mute/solo/volume are GainNode changes, never source restarts.

export class MixEngine {
  constructor({ lite = false } = {}) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.lite = lite;
    this.ctx = lite ? new Ctx({ sampleRate: 22050 }) : new Ctx();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.lanes = new Map(); // id -> { buffer, gain, vol, mute, solo, enabled }
    this.sources = [];
    this.playing = false;
    this.offset = 0;        // seconds into the song when paused / at start
    this.startedAt = 0;     // ctx.currentTime when playback (re)started
    this.loop = { on: false, start: 0, end: 0 };
    this.duration = 0;
    this.onended = null;
  }

  async decode(arrayBuffer) {
    return await this.ctx.decodeAudioData(arrayBuffer);
  }

  addLane(id, buffer) {
    const gain = this.ctx.createGain();
    gain.connect(this.master);
    this.lanes.set(id, { buffer, gain, vol: 1, mute: false, solo: false, enabled: true });
    if (buffer) this.duration = Math.max(this.duration, buffer.duration);
    this._applyGains();
  }

  setDuration(d) { this.duration = Math.max(this.duration, d); }

  reset() {
    this.stop();
    for (const l of this.lanes.values()) l.gain.disconnect();
    this.lanes.clear();
    this.duration = 0;
    this.loop = { on: false, start: 0, end: 0 };
  }

  // enabled=false hides a lane from the mix entirely (e.g. guitar replaced by its sub-split).
  set(id, patch) {
    const l = this.lanes.get(id);
    if (!l) return;
    Object.assign(l, patch);
    this._applyGains();
  }

  setMaster(v) { this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015); }

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

  _applyGains() {
    const t = this.ctx.currentTime;
    for (const [id, l] of this.lanes) l.gain.gain.setTargetAtTime(this.audible(id) ? l.vol : 0, t, 0.012);
  }

  position() {
    if (!this.playing) return this.offset;
    let p = this.offset + (this.ctx.currentTime - this.startedAt);
    const { on, start, end } = this.loop;
    if (on && end > start && p >= end) p = start + ((p - start) % (end - start));
    return Math.min(p, this.duration);
  }

  async play() {
    if (this.playing || !this.duration) return;
    if (this.ctx.state === "suspended") await this.ctx.resume();
    const { on, start, end } = this.loop;
    let from = this.offset >= this.duration - 0.01 ? 0 : this.offset;
    if (on && end > start && (from < start || from >= end)) from = start;
    const when = this.ctx.currentTime + 0.03;
    this.sources = [];
    for (const l of this.lanes.values()) {
      if (!l.buffer) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = l.buffer;
      if (on && end > start) { src.loop = true; src.loopStart = start; src.loopEnd = end; }
      src.connect(l.gain);
      src.start(when, from);
      this.sources.push(src);
    }
    if (this.sources[0] && !(on && end > start)) {
      this.sources[0].onended = () => {
        if (this.playing && this.position() >= this.duration - 0.05) {
          this._halt(); this.offset = 0; this.onended?.();
        }
      };
    }
    this.offset = from;
    this.startedAt = when;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this._halt();
  }

  stop() { this._halt(); this.offset = 0; }

  _halt() {
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch { /* already stopped */ } s.disconnect(); }
    this.sources = [];
    this.playing = false;
  }

  async seek(t) {
    const was = this.playing;
    this._halt();
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) await this.play();
  }

  async setLoop(patch) {
    const pos = this.position();
    Object.assign(this.loop, patch);
    if (this.playing) { this._halt(); this.offset = pos; await this.play(); }
  }
}

// Min/max peak extraction for waveform drawing.
export function computePeaks(buffer, buckets = 2400) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const len = chans[0].length;
  const step = Math.max(1, Math.floor(len / buckets));
  const out = new Float32Array(buckets * 2);
  let maxAbs = 0;
  for (let b = 0; b < buckets; b++) {
    let lo = 0, hi = 0;
    const s = b * step, e = Math.min(len, s + step);
    for (let i = s; i < e; i += 2) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v /= chans.length;
      if (v < lo) lo = v; else if (v > hi) hi = v;
    }
    out[b * 2] = lo; out[b * 2 + 1] = hi;
    maxAbs = Math.max(maxAbs, -lo, hi);
  }
  return { data: out, buckets, maxAbs };
}

export function drawWave(canvas, peaks, color, { normalize = 1 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = "rgba(255,255,255,0.06)";
  g.fillRect(0, h / 2, w, 1);
  if (!peaks) return;
  const mid = h / 2, amp = (h / 2 - 2) * normalize;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color); grad.addColorStop(0.5, color); grad.addColorStop(1, color);
  g.fillStyle = grad;
  const { data, buckets } = peaks;
  for (let x = 0; x < w; x++) {
    const b0 = Math.floor((x / w) * buckets), b1 = Math.max(b0 + 1, Math.floor(((x + 1) / w) * buckets));
    let lo = 0, hi = 0;
    for (let b = b0; b < b1 && b < buckets; b++) { lo = Math.min(lo, data[b * 2]); hi = Math.max(hi, data[b * 2 + 1]); }
    const y1 = mid - Math.min(1, hi) * amp, y2 = mid - Math.max(-1, lo) * amp;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}
