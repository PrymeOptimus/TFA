# StemForge

Split any song into stems, detect its tempo and key, transcribe synced lyrics, and drop the
stems straight into Ableton Live as new tracks. Built Windows-first.

StemForge is an original implementation. It shares no code with Stem Splitter Plus, which
it was benchmarked against.

## What's better than Stem Splitter Plus

| | Stem Splitter Plus 1.0 | StemForge 1.0 |
|---|---|---|
| Vocal separation | Demucs | **BS-RoFormer** (SDR 12.98 on vocals) feeding Demucs: cleaner vocals, less bleed |
| GPU on Windows | CPU-only PyTorch | Installer detects NVIDIA and installs the **CUDA build** |
| CPU-only PCs | Same slow pipeline | `auto` quality picks the fast pipeline on CPU and the best on GPU |
| Installer | Needs re-runs after installing Python; winget; PATH edits | **One pass**: uv brings its own Python, so no PATH refresh is needed |
| FFmpeg | Must be on PATH (Windows PATH bug) | **Bundled** (imageio-ffmpeg), so there is no PATH dependency |
| Models | Lyrics model not pre-fetched on Windows | Everything the machine will use is pre-downloaded |
| Without Ableton | No | **Desktop drag-and-drop**: songs *or whole folders* (batch) |
| Lyrics output | Device viewer only | `lyrics.lrc` (works in any LRC player) plus the manifest |
| Tempo | librosa grid-quantised | Line fit over all beats (120.34 BPM on a 120 BPM test) |
| Tests | None | 18 automated tests |

**Not carried over:** song-section detection (verse/chorus clips) and the chord viewer.
Those were Stem Splitter's own features and would need an original implementation.

## Install (Windows)

1. Extract the folder anywhere. The installer copies what it needs to `%LOCALAPPDATA%\StemForge`.
2. Double-click **`Install StemForge (Windows).bat`**. If SmartScreen appears, click **More info**, then **Run anyway**.
3. Wait for **StemForge is installed**. Done.

Options: `-Cpu` (ignore the GPU), `-UserLibrary "D:\Ableton\User Library"`, `-SkipModels`, `-InstallDir <path>`.

## Use

- **Ableton Live 12 (Suite, or Standard + Max for Live):** go to Browser › Audio Effects › Max Audio Effect › **StemForge**. Drag it onto a track, drop a song on the box, then click **Split**. Each stem lands on a new, coloured track in clip slot 1, and the set tempo follows the song.
- **Desktop:** drop songs or folders on the **StemForge** desktop shortcut. Results open in `Music\StemForge`.
- **Command line:**
  ```bat
  "%LOCALAPPDATA%\StemForge\.venv\Scripts\python.exe" -m stemforge split "C:\Music\song.mp3" --mode 6stem --quality best
  ```
  `--mode vocals|4stem|6stem` · `--quality auto|fast|best` · `--no-lyrics` · `--out <dir>` · `stemforge doctor` · `stemforge download`

Each song gets a folder with numbered stems (`01 Vocals.wav`…), `manifest.json` (BPM, key, stems, lyrics) and `lyrics.lrc`.

## Pipelines

| Quality | 4/6 stems | Vocals + instrumental |
|---|---|---|
| fast | Demucs `htdemucs` / `htdemucs_6s` | Demucs, non-vocal stems summed |
| best | BS-RoFormer vocals, then Demucs `htdemucs_ft` / `htdemucs_6s` on the instrumental (leftover vocal bleed folded into Other) | BS-RoFormer |

`auto` = best on an NVIDIA or Apple GPU, fast on CPU. On CPU, BS-RoFormer runs at roughly 10× the song's length.

## Verification status

| Part | Status |
|---|---|
| Engine: pipelines, analysis, LRC, batch, naming | 18 tests pass. Real BS-RoFormer split verified (Linux, CPU) |
| Device runner (Node) | Verified against the real engine with a Max API stand-in |
| `.amxd` file | Generated and checked for structure (header, every cord valid) |
| **Not run yet** | In Ableton Live, on Windows, with Demucs weights, with Whisper weights. The build machine couldn't reach those model hosts or run Live/Windows. **First real run = acceptance test.** |

`create_audio_clip` (loading stems into tracks) needs **Live 12**. On older Live versions, drag the stems in from the song folder.

## Develop

```bash
cd engine
uv venv -p 3.12 && uv pip install -e ".[test]" torch torchaudio "audio-separator[cpu]"
.venv/bin/python -m pytest -q tests
python ../device/build_device.py   # regenerate StemForge.amxd
```

## Licenses

StemForge code: MIT (see `LICENSE`). Dependencies keep their own licenses. Demucs, audio-separator, faster-whisper and Whisper are MIT.
**Model weights** (especially the community BS-RoFormer checkpoint) carry their own terms. Check them before any commercial use.
