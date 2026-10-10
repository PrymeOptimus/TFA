#pragma once

// Shown inside the plug-in until the local StemForge engine answers.
static const char* const kLoadingPageHtml = R"HTML(<!doctype html>
<html><head><meta charset="utf-8"><title>StemForge</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; height:100vh; display:grid; place-items:center; background:#0b0d12; color:#e8ebf2;
         font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
  .card { width:min(560px,90vw); padding:28px; border:1px solid #262c39; border-radius:14px;
          background:linear-gradient(180deg,#151922,#11141b); }
  h1 { margin:0 0 6px; font-size:20px; } h1 b { color:#ff8a3d; }
  .status { color:#8b93a7; min-height:42px; white-space:pre-wrap; word-break:break-word; }
  .bar { height:4px; background:#262c39; border-radius:4px; overflow:hidden; margin:16px 0; }
  .bar i { display:block; height:100%; width:30%; background:#ff8a3d; animation:s 1.2s ease-in-out infinite; }
  @keyframes s { 0%{margin-left:-30%} 100%{margin-left:100%} }
  button { height:36px; padding:0 14px; border-radius:10px; border:0; background:#ff8a3d; color:#1a0d03;
           font-weight:600; cursor:pointer; }
  code { background:#1b202b; padding:1px 6px; border-radius:6px; font-size:12px; }
  .hint { color:#8b93a7; font-size:12.5px; margin-top:16px; }
</style></head>
<body><div class="card">
  <h1>Stem<b>Forge</b></h1>
  <div class="status" id="status">Connecting to the StemForge engine...</div>
  <div class="bar"><i></i></div>
  <button id="start">Start engine</button>
  <div class="hint">The plug-in uses the local StemForge engine for separation.
    It starts automatically when Python and the <code>stemforge</code> package are installed
    (<code>pip install -e stemforge/backend</code>). Settings: <code id="cfg">~/.stemforge/plugin.json</code></div>
</div>
<script>
  const b = window.__JUCE__ && window.__JUCE__.backend;
  let id = 0; const waiting = new Map();
  function call(name, ...params) {
    return new Promise((resolve) => {
      const resultId = id++; waiting.set(resultId, resolve);
      b.emitEvent("__juce__invoke", { name, params, resultId });
    });
  }
  function show(s) {
    if (!s) return;
    document.getElementById("status").textContent = s.message || "";
    if (s.config) document.getElementById("cfg").textContent = s.config;
  }
  if (b) {
    b.addEventListener("__juce__complete", ({ promiseId, result }) => {
      const r = waiting.get(promiseId); if (r) { waiting.delete(promiseId); r(result); }
    });
    b.addEventListener("sf_engine", show);
    call("sf_engineStatus").then(show);
    document.getElementById("start").onclick = () => call("sf_startEngine");
  }
</script>
</body></html>)HTML";
