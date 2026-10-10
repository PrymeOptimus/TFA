# StemForge plug-in (VST3 / AU / Standalone)

StemForge inside your DAW. It is the same mixer UI as the web app, running in a native window. Audio plays **through the DAW's mixer**, locked to the DAW's transport and tempo. Stems drag straight onto DAW tracks.

```
┌──────────────── DAW ────────────────┐
│ StemForge plug-in (C++/JUCE)        │      ┌── StemForge engine (Python) ──┐
│  ├ WebView: the StemForge UI ◄──────┼─HTTP─┤ separation, analysis,         │
│  ├ Real-time stem player ──► outs   │      │ tempo-stretch renders (rubber-│
│  ├ Follows DAW transport + tempo    │      │ band), peaks, file paths      │
│  └ Native drag dock ──► DAW tracks  │      └───────────────────────────────┘
└─────────────────────────────────────┘
```

## What it does

| Feature | How |
|---|---|
| Same interface | The editor hosts the engine-served UI in JUCE's `WebBrowserComponent` (WebView2 / WKWebView / WebKitGTK). It detects plug-in mode and drives the native player instead of Web Audio |
| Audio through the DAW | C++ real-time player: per-stem gain smoothing, mute/solo, master, loop. No allocation or locking on the audio thread (try-lock only). Old tracks are freed on the message thread |
| Per-stem outputs | Main stereo out plus 12 optional stereo outs (Vocals … Residual). A stem routed to its own out is removed from the main mix |
| **DAW transport sync** | "Follow DAW transport": playback starts and stops with the DAW, and position comes from the DAW's beat position. Small timing jitter (< 10 ms) is absorbed with no clicks. Real locates jump |
| **DAW tempo sync** | "Stretch to DAW tempo": the engine renders every stem at the DAW BPM with rubberband (pitch preserved), so the song locks to the bar grid. Tempo changes are followed automatically after ~0.5 s. The stretch range is 0.5×–2× the original tempo |
| Grid alignment | The engine detects the song's first beat (`grid_offset_sec`). "Start at bar N" places the song in the arrangement, and "Nudge (ms)" fine-tunes it |
| **Drag-out** | A native **drag dock** under the UI: drag any stem tile onto a DAW track. Files are at the tempo currently playing, named `[Title]_[Stem]_[BPM]BPM_[Key].wav`. Lanes also have a drag handle (⋮⋮), which is best-effort because some hosts reject drags that start in a WebView. **Recombine** bounces your mix and adds it to the dock |
| Session recall | The DAW project saves track, levels, mute/solo, guitar split, sync settings and loop. Reopening the project reloads the stems |
| Engine auto-start | If the engine isn't running, the plug-in starts it (`python -m stemforge`) and shows a status page until it's up |

## Build

Requirements: CMake ≥ 3.22, a C++17 compiler. JUCE 8.0.10 is fetched automatically, or pass `-DJUCE_DIR=/path/to/JUCE`.

```bash
cd stemforge/plugin
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release --target StemForge_VST3 StemForge_Standalone   # + StemForge_AU on macOS
```

Outputs land in `build/StemForge_artefacts/Release/{VST3,AU,Standalone}/`. Copy `StemForge.vst3` to your VST3 folder (`~/Library/Audio/Plug-Ins/VST3`, `C:\Program Files\Common Files\VST3`, `~/.vst3`) and `StemForge.component` to `~/Library/Audio/Plug-Ins/Components`.

Platform notes:
- **Windows:** the WebView2 SDK must be installable by CMake. JUCE finds the NuGet package: `Install-Package Microsoft.Web.WebView2 -Scope CurrentUser -RequiredVersion 1.0.1901.177 -Source https://www.nuget.org/api/v2`. The WebView2 runtime is preinstalled on Windows 10/11.
- **macOS:** builds AU + VST3. Sign and notarize before distributing.
- **Linux:** needs `libwebkit2gtk-4.1-dev libgtk-3-dev libasound2-dev libcurl4-openssl-dev libfreetype-dev libfontconfig1-dev`.

## Engine setup (one time)

```bash
pip install -e stemforge/backend       # makes `python -m stemforge` work from anywhere
```

The plug-in reads `~/.stemforge/plugin.json`, which is created on first run:

```json
{ "engineUrl": "http://127.0.0.1:8000", "autoStart": true, "python": "", "backendDir": "" }
```

- `python`: absolute path to the Python that has StemForge installed. DAWs launch plug-ins with a minimal PATH, so set this if auto-detection fails. Auto-detection checks `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `/usr/bin/python3`, and `py.exe` on Windows.
- `backendDir`: use instead of `pip install -e` to point at `stemforge/backend`.
- Engine data (history, stems, renders) lives in `~/.stemforge/data`, shared between the web app and the plug-in.

## Using it

1. Put StemForge on an **instrument track** (it generates audio and ignores MIDI).
2. Drop a file in the plug-in window and separate. Or reopen one from History.
3. Keep **Follow DAW transport** and **Stretch to DAW tempo** on. Press play in the DAW, and the stems play on the DAW's grid at the DAW's tempo.
4. If the downbeat lands off a bar line, adjust **Start at bar** and **Nudge**.
5. Drag stems from the dock onto audio tracks to commit them as clips. They're already at the project tempo.

Turn **Follow DAW transport** off to audition with StemForge's own transport (play/pause/loop) while the DAW is stopped.

## Tests

```bash
cmake --build build --target StemForgeTests
./build/StemForgeTests_artefacts/Release/StemForgeTests                 # unit tests
./build/StemForgeTests_artefacts/Release/StemForgeTests --engine http://127.0.0.1:8000 --track <trackId>
```

The integration mode drives a real processor with a fake DAW playhead at 132 BPM. It checks the stretched render and audio output, then changes the tempo to 100 BPM and checks the automatic re-render, session recall and drag-out file names.

## Limits

- Tempo mapping assumes a constant tempo from the start bar. Songs with tempo automation inside the DAW will drift; the stems re-render when the tempo settles.
- Stems are held in RAM at the host sample rate: about 90 MB per stereo stem per 4 minutes at 48 kHz.
- Separation is not real-time. It runs in the engine, and the plug-in plays the results.
