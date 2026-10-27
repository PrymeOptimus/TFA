# Stem Splitter Plus v1.0.0 — Windows Install Guide

Verified against the contents of `Stem-Splitter-Plus-v1.0.0.zip`
(SHA-256 `485c198d17df27a980eb068c4c9b80a9435541e1e380d2b7c1e1085eaeac84b9`).
If your zip has a different hash, this guide may not match it.

> **Heads-up:** the README lists macOS as the supported platform. The Windows
> installer is included but is less mature. Expect CPU-only processing unless you
> complete the optional GPU step (Step 7).

---

## What you need

| Requirement | Detail |
|---|---|
| Windows 10/11, 64-bit | `winget` (App Installer) available. It ships with current Windows 10/11 |
| Ableton Live 12 **Suite**, or Standard + Max for Live add-on | The device is a Max for Live audio effect |
| Free disk space | Several GB: Python packages (PyTorch is the largest), ~350 MB separation models, ~1.6 GB lyrics model |
| Internet | Needed for the install and the first lyrics run |
| Optional: NVIDIA GPU | Makes splitting much faster (Step 7) |

---

## Step 1: Put the folder in its permanent home

The device runs the engine **from the folder you install from**. If you move or delete it later, the device breaks.

1. Right-click the zip, choose **Properties**, tick **Unblock** if it's shown, then click **OK**.
   This stops Windows from flagging every extracted file.
2. Extract it to a permanent location, for example:
   `C:\Tools\Stem Splitter Plus\`
3. Don't use Downloads, Desktop, or a OneDrive-synced folder. OneDrive can offload the 2+ GB environment and break it.

## Step 2: Close Ableton Live

The installer writes into your User Library. Live must be restarted afterward anyway to see new tools on PATH.

## Step 3: Run the installer

1. Open the folder and double-click **`Install Stem Splitter Plus (Windows).bat`**.
2. If **"Windows protected your PC"** (SmartScreen) appears, click **More info**, then **Run anyway**.
   I reviewed this file. It only installs Python packages and copies the device files.
3. Let it run. It works through 5 stages:

| Stage | What happens | Typical time |
|---|---|---|
| 1/5 Python | Finds Python 3.10–3.12, or installs 3.11 via winget | 1–3 min if installing |
| 2/5 FFmpeg | Finds FFmpeg, or installs it via winget (`Gyan.FFmpeg`) | 1–2 min if installing |
| 3/5 Environment | Creates `.venv` in the folder and installs PyTorch, Demucs, librosa, faster-whisper | 5–15 min (largest download) |
| 4/5 Models | Downloads the separation models (~350 MB) | 1–5 min |
| 5/5 Device | Copies the device into `Documents\Ableton\User Library\...\Stem Splitter Plus` and writes `config.json` | seconds |

4. Wait for **SUCCESS!**, then press a key to close the window.

### If the installer just installed Python or FFmpeg: run it a second time

A freshly installed Python or FFmpeg is not visible to the installer window that is already open.
On a machine without Python, the first run typically fails at stage 3. **Close the window and double-click the `.bat` again.**
It skips what's already done.

## Step 4: Confirm the install

Open **Command Prompt** (`Win`+`R`, type `cmd`, press Enter) and run these. Each should print a version or path, not an error:

```bat
ffmpeg -version
"C:\Tools\Stem Splitter Plus\.venv\Scripts\python.exe" -c "import torch, demucs, faster_whisper; print('engine OK, torch', torch.__version__)"
type "%USERPROFILE%\Documents\Ableton\User Library\Presets\Audio Effects\Max Audio Effect\Stem Splitter Plus\config.json"
```

- Adjust `C:\Tools\Stem Splitter Plus` if you extracted elsewhere.
- In `config.json`, `python` must point to the `.venv\Scripts\python.exe` in your folder, and `engine` to its `engine` folder.
- If your User Library is somewhere custom (Live: **Preferences › Library**), copy the whole `Stem Splitter Plus` device folder into
  `<your User Library>\Presets\Audio Effects\Max Audio Effect\`.

## Step 5: First run in Live

1. **Restart your PC** (or at least sign out and back in) if FFmpeg was just installed.
   Live passes its own PATH to the engine, and it only sees FFmpeg after a fresh login.
2. Open Live. In the Browser, go to **Audio Effects › Max Audio Effect › Stem Splitter Plus**.
3. Drag **Stem Splitter Plus** onto any audio track.
4. Drop a song file (mp3, wav, flac, m4a, wma/wmv, mp4…) onto the device.
5. Choose a model, then click **Split + Build**.

**Model choice on a CPU-only PC:**

| Menu option | Stems | Speed | Notes |
|---|---|---|---|
| **4fast** | Drums, Bass, Vocals, Other | Fastest | **Best first test.** Model already downloaded |
| 2stem | Vocals + Instrumental | Fast | Same model as 4fast |
| 6stem (default) | + Guitar, Piano | Slower | Model already downloaded |
| 4stem | Drums, Bass, Vocals, Other | Slowest, best quality | Downloads an extra model on first use |

- **The first split with Lyrics on downloads the Whisper model (~1.6 GB).** It pauses at the lyrics stage until the download finishes.
  Turn Lyrics off for a quick first test.
- Results are saved to `%USERPROFILE%\Music\Ableton\Stem Splitter Plus\`. **Leave those files in place.** The Live set's clips point to them.

## Step 6: Troubleshooting

| Symptom | Fix |
|---|---|
| Device shows **"Engine not installed"** | `config.json` is missing or points to the wrong place. Re-run the installer from the folder's permanent location |
| **"ffmpeg not found"** / "Could not decode audio" | Run `ffmpeg -version` in a new Command Prompt. If it works there, restart the PC so Live picks up the new PATH. If it fails, re-run the installer or `winget install -e --id Gyan.FFmpeg` |
| Nothing happens on Split | Right-click the device title bar › **Open Max Window** and read the red error lines |
| No lyrics | The song has no vocals, Lyrics was off, or the model download failed (check internet and re-split) |
| Very slow splits | Expected on CPU. Use **4fast**, turn Lyrics off, or do Step 7 |
| Installer fails on `pip install` | Re-run it once (common after a fresh Python install). If it still fails, screenshot the last 20 lines |

**Run the engine outside Live** to see the real error. This is the same command the device runs:

```bat
cd /d "C:\Tools\Stem Splitter Plus\engine"
"..\.venv\Scripts\python.exe" -u -m stemsplit.cli "C:\path\to\song.mp3" --model 4fast --sections normal --out-root "%USERPROFILE%\Music\Ableton\Stem Splitter Plus" --no-lyrics
```

## Step 7 (optional): NVIDIA GPU acceleration

The installer pulls the standard PyTorch from PyPI, which on Windows is **CPU-only**. With an NVIDIA GPU and a current driver, swap in the CUDA build:

```bat
"C:\Tools\Stem Splitter Plus\.venv\Scripts\python.exe" -m pip install --force-reinstall torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu124
"C:\Tools\Stem Splitter Plus\.venv\Scripts\python.exe" -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

- `CUDA: True` means stem separation now runs on the GPU. The engine picks it automatically.
- Lyrics (faster-whisper) tries the GPU too. If NVIDIA's cuBLAS/cuDNN libraries aren't installed, it **falls back to CPU automatically**. Lyrics still work, just slower.

## Uninstall

1. Delete the device folder:
   `%USERPROFILE%\Documents\Ableton\User Library\Presets\Audio Effects\Max Audio Effect\Stem Splitter Plus`
2. Delete the install folder (e.g. `C:\Tools\Stem Splitter Plus`). This removes the `.venv` and all packages.
3. Optional: delete the cached models:
   - `%USERPROFILE%\.cache\torch\hub` (Demucs)
   - `%USERPROFILE%\.cache\huggingface` (Whisper)
4. Optional: delete your splits in `%USERPROFILE%\Music\Ableton\Stem Splitter Plus`.
5. Python and FFmpeg stay installed. Remove them in **Settings › Apps** if nothing else uses them.

---

### Known issue (does not block normal use)

`runner.js` prepends Mac-style paths to PATH using `:` separators. On Windows this corrupts the **first** PATH entry for the engine process.
It only matters if FFmpeg's folder is that first entry. Winget's FFmpeg is not normally first. If you hit "ffmpeg not found" despite Step 4 passing, this is the likely cause.
