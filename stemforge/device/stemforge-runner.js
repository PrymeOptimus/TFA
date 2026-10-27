// StemForge device, Node for Max side: runs the engine and hands finished stems to Live.
// In:  file <path> | mode <i> | quality <i> | lyrics <0|1> | tempo <0|1> | split | cancel | reveal
// Out: status <text> | tempo <bpm> | stem <name> <path> <rgb> | built <count>

const maxApi = require("max-api");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const MODES = ["4stem", "6stem", "vocals"];
const QUALITIES = ["auto", "fast", "best"];
const COLORS = {
  vocals: 0xff5f5f, drums: 0xffb74d, bass: 0x7c4dff, guitar: 0x4caf50,
  piano: 0x29b6f6, other: 0xbdbdbd, instrumental: 0x9e9e9e,
};

const state = { file: null, mode: "4stem", quality: "auto", lyrics: true, tempo: true, proc: null, lastDir: null };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function config() {
  const file = path.join(__dirname, "stemforge-config.json");
  const fallback = {
    python: path.join(os.homedir(), "AppData", "Local", "StemForge", ".venv", "Scripts", "python.exe"),
    models: path.join(os.homedir(), "AppData", "Local", "StemForge", "models"),
    out: path.join(os.homedir(), "Music", "StemForge"),
  };
  try {
    return Object.assign(fallback, readJson(file));
  } catch (e) {
    return fallback;
  }
}

// Max on macOS hands over "Macintosh HD:/Users/..."; Windows paths arrive as "C:/Users/...".
function toLocalPath(p) {
  const m = /^([^/:]{2,}):(\/.*)$/.exec(p);
  return m ? m[2] : p;
}

const status = (text) => maxApi.outlet("status", text);

async function buildInLive(manifestPath) {
  const manifest = readJson(manifestPath);
  const dir = path.dirname(manifestPath);
  state.lastDir = dir;
  if (state.tempo && manifest.bpm) await maxApi.outlet("tempo", manifest.bpm);
  for (const s of manifest.stems) {
    const file = path.join(dir, s.file).split(path.sep).join("/");
    await maxApi.outlet("stem", manifest.song + " - " + s.name, file, COLORS[s.key] || 0x9e9e9e);
  }
  await maxApi.outlet("built", manifest.stems.length);
  const facts = [manifest.bpm && manifest.bpm + " BPM", manifest.key, manifest.lyrics && "lyrics.lrc saved"]
    .filter(Boolean).join(" | ");
  await status(`Done: ${manifest.stems.length} stems in ${manifest.elapsed_sec}s. ${facts}`);
}

maxApi.addHandlers({
  file: async (...parts) => {
    const p = toLocalPath(parts.join(" "));
    if (!fs.existsSync(p)) return status("File not found: " + p);
    state.file = p;
    await status("Ready: " + path.basename(p) + ". Press Split.");
  },
  mode: (i) => { state.mode = MODES[Math.round(i)] || "4stem"; },
  quality: (i) => { state.quality = QUALITIES[Math.round(i)] || "auto"; },
  lyrics: (on) => { state.lyrics = Boolean(Math.round(on)); },
  tempo: (on) => { state.tempo = Boolean(Math.round(on)); },

  cancel: async () => {
    if (state.proc) {
      state.proc.kill();
      state.proc = null;
      await status("Cancelled.");
    }
  },

  reveal: async () => {
    const dir = state.lastDir || config().out;
    fs.mkdirSync(dir, { recursive: true });
    const opener = process.platform === "win32" ? "explorer" : "open";
    spawn(opener, [dir], { detached: true, stdio: "ignore" }).unref();
  },

  split: async () => {
    if (state.proc) return status("Already working. Press Cancel first.");
    if (!state.file) return status("Drop a song on the device first.");
    const cfg = config();
    if (!fs.existsSync(cfg.python)) return status("Engine not found. Run the StemForge installer.");

    const args = ["-m", "stemforge", "--json", "--models", cfg.models, "split", state.file,
      "--mode", state.mode, "--quality", state.quality, "--out", cfg.out, state.lyrics ? "--lyrics" : "--no-lyrics"];
    const proc = spawn(cfg.python, args, { env: Object.assign({}, process.env, { PYTHONUNBUFFERED: "1" }) });
    state.proc = proc;
    let buffer = "";
    let manifest = null;
    let error = null;
    let stderrTail = "";
    await status("Starting...");

    proc.stdout.on("data", async (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (ev.event === "progress") await status(`${ev.percent}%  ${ev.message}`);
        else if (ev.event === "log") maxApi.post(ev.message);
        else if (ev.event === "error") error = ev.message;
        else if (ev.event === "done") manifest = ev.manifest;
      }
    });
    proc.stderr.on("data", (chunk) => { stderrTail = (stderrTail + chunk.toString()).slice(-1500); });
    proc.on("error", (e) => { error = e.message; });
    proc.on("close", async (code) => {
      const cancelled = state.proc !== proc;
      state.proc = null;
      if (cancelled) return;
      if (manifest) {
        try {
          await buildInLive(manifest);
        } catch (e) {
          await status("Split OK but could not load into Live: " + e.message);
        }
      } else {
        if (stderrTail) maxApi.post(stderrTail, maxApi.POST_LEVELS.ERROR);
        await status("Failed: " + (error || "engine exited with code " + code + " (see Max window)"));
      }
    });
  },
});

status("Drop a song (mp3, wav, flac, m4a, mp4...) on the box.");
