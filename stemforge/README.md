# StemForge

Upload a track → get 10 isolated stems (Vocals, Drums, Percussion, Bass, Guitar, Piano/Keys, Synth, Organ, Auxiliary, Residual) in a synced multitrack mixer, with lossless downloads and a Recombine bounce.

## Quick start

```bash
cd stemforge/backend
pip install -r requirements.txt     # includes torch + demucs (neural engine)
python -m stemforge --port 8000     # needs ffmpeg on PATH
# open http://127.0.0.1:8000
```

On first separation, Demucs downloads the `htdemucs_6s` weights (~80 MB) from `dl.fbaipublicfiles.com`. For offline machines, put the weights in a folder and set `STEMFORGE_DEMUCS_REPO`.

Run the tests with `cd stemforge/backend && python -m pytest -q`.

## What it does

| Feature | Implementation |
|---|---|
| Upload (WAV/MP3/M4A/FLAC, one file) | Drag-drop or file picker. ffmpeg decodes to 44.1 kHz stereo |
| BPM | librosa beat tracking, refined by fitting a line through onset-snapped beat times |
| Key | Krumhansl-Schmuckler profile correlation, with a confidence value |
| Duration | Exact |
| Genre/style | **Rule-based estimate**, labelled "est." in the UI. No trained genre model is bundled |
| Mix waveform | Client-side peaks with click-to-seek and drag-to-loop |
| Primary split | Demucs `htdemucs_6s`: vocals, drums, bass, guitar, piano, other |
| Refinement pass | `other` → Piano/Keys (merged), Synth, Organ, Auxiliary, Residual. `drums` → Kit + Percussion. `guitar` → Electric / Acoustic sub-stems (only when clearly separable) |
| Not detected | Stems below −38 dB relative to the mix, or audible in under 3% of frames, are **not written**. Their audio goes to Residual |
| Low confidence | Score < 0.5 → "Low confidence — may contain bleed" |
| Sum-to-mix | Residual = mix − Σ(written stems), so the stems always add back to the original (verified in tests) |
| Mixer | Web Audio. All sources start on one clock (sample-locked). Mute, solo (Alt-click = exclusive solo), fader, master, loop region. Space = play/pause, L = loop |
| Downloads | Per-stem 24-bit WAV, "Download all" as a zip. Name format: `[Title]_[Stem]_[BPM]BPM_[Key].wav` |
| Recombine | Server-side bounce of the current mute/solo/volume mix from the full-quality stems, peak-normalised if it would clip |
| Send to Replace / Extend / Cover | POSTs the stem (multipart: `file`, `action`, `stem`, `title`, `bpm`, `key`) to `STEMFORGE_REMIX_WEBHOOK`. If none is configured, the stem downloads for manual upload |
| History | Last 10 tracks. Older ones are deleted from disk automatically |
| Mobile | Lanes stack on small screens. Low-memory devices play back at 22 kHz; downloads stay full quality |

## Confidence: what the numbers mean

- **Primary stems** (vocals, bass, guitar): a *dominance* score, meaning the share of the stem's energy in time-frequency bins where it is louder than all other stems combined. Stems that mostly sit under other sources are the ones likely to carry bleed. It is a proxy, not a ground-truth measure.
- **Refined stems** (Percussion, Synth, Organ, Auxiliary, the keys part of Piano, guitar sub-split): NMF decomposition plus transparent feature rules (attack, sustain, tonality, 4–8 Hz tremolo, spectral balance). There is no off-the-shelf open model for these classes, so they are capped at 0.75 confidence and will often show the low-confidence flag on dense mixes. To upgrade, swap the `classify_*` functions in `refine.py` for a trained model; the masking and sum-to-mix contract stays the same.
- **DSP fallback** (no torch or weights): every stem is capped at 0.45, so all stems are flagged. The UI shows why the fallback is active.

## Configuration (env vars)

| Var | Default | |
|---|---|---|
| `STEMFORGE_ENGINE` | `auto` | `auto` (Demucs, else DSP fallback), `demucs` (fail if unavailable), `dsp` |
| `STEMFORGE_DEMUCS_MODEL` | `htdemucs_6s` | Must be a 6-source model for guitar/piano. 4-source models also work |
| `STEMFORGE_DEMUCS_REPO` | — | Local weights folder |
| `STEMFORGE_DEVICE` | `auto` | `cuda` / `mps` / `cpu` |
| `STEMFORGE_DATA_DIR` | `./data` | Track storage |
| `STEMFORGE_HISTORY_LIMIT` | `10` | |
| `STEMFORGE_MAX_UPLOAD_MB` | `200` | |
| `STEMFORGE_WAV_SUBTYPE` | `PCM_24` | `PCM_16`, `PCM_24`, `FLOAT` |
| `STEMFORGE_REMIX_WEBHOOK` / `STEMFORGE_REMIX_TOKEN` | — | Replace/Extend/Cover hand-off endpoint + bearer token |

## API

`POST /api/tracks` (upload + analyse) · `POST /api/tracks/{id}/separate` · `GET /api/tracks/{id}` (status, progress, stems) · `GET /api/tracks/{id}/mix` · `GET /api/tracks/{id}/stems/{stem}?download=true` · `GET /api/tracks/{id}/zip` · `POST /api/tracks/{id}/recombine {levels}` · `POST /api/tracks/{id}/stems/{stem}/send {target}` · `GET /api/history` · `DELETE /api/tracks/{id}`

## Layout

```
backend/stemforge/
  analysis.py    BPM, key, duration, style estimate
  separation.py  Demucs + DSP-fallback primary splitters
  refine.py      NMF refinement pass (drums/other/guitar)
  pipeline.py    orchestration, detection, confidence, residual, WAV export
  store.py       track storage + rolling history
  app.py         FastAPI app (also serves the frontend)
frontend/        no-build vanilla JS: index.html, app.js, engine.js (Web Audio), styles.css
```

## VST plugin status

This build is a local web app: a Python engine plus a browser mixer. A real VST3/AU plugin needs a C++ (JUCE) wrapper. The planned route is a JUCE plugin whose editor hosts this same UI in a `WebBrowserComponent` and talks to the local engine, adding DAW drag-out of stems and host-tempo sync. The engine and API are already split out for that.
