"""stemforge split | download | doctor"""

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path

from stemforge import __version__, analysis, audio, hardware, separate
from stemforge.progress import Reporter

AUDIO_EXTS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".wma", ".aif", ".aiff",
              ".mp4", ".mov", ".mkv", ".webm", ".wmv"}


def default_out():
    return Path.home() / "Music" / "StemForge"


def default_models():
    return Path.home() / ".stemforge" / "models"


def safe_name(name):
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name or "song"


def collect_inputs(paths):
    files = []
    for p in map(Path, paths):
        if p.is_dir():
            files += sorted(f for f in p.rglob("*") if f.suffix.lower() in AUDIO_EXTS)
        elif p.is_file():
            files.append(p)
        else:
            raise FileNotFoundError("Not found: %s" % p)
    return files


def split_one(src, args, hw, quality, backend, rep, index=0, total=1):
    def report(pct, msg):
        rep.progress((index + pct / 100) / total * 100, "%s: %s" % (src.name, msg))

    song_dir = Path(args.out) / safe_name(src.stem)
    work = song_dir / ".work"
    if song_dir.exists() and not args.overwrite and (song_dir / "manifest.json").exists():
        rep.log("Skipping %s (already split; use --overwrite)" % src.name)
        return song_dir / "manifest.json"
    work.mkdir(parents=True, exist_ok=True)
    started = time.time()

    report(2, "Decoding...")
    mix_wav = audio.decode_to_wav(src, work / "mix.wav")
    mix, sr = audio.read(mix_wav)

    stems = separate.separate(mix_wav, work, args.mode, quality, backend, report)
    kept, dropped = separate.drop_silent(stems, audio.rms_db(mix))
    for key in dropped:
        rep.log("Dropped %s: no real content" % separate.DISPLAY[key])

    report(80, "Writing stems...")
    order = separate.STEMS[args.mode]
    entries = []
    for n, key in enumerate(k for k in order if k in kept):
        name = separate.DISPLAY[key]
        dst = song_dir / ("%02d %s.wav" % (n + 1, name))
        shutil.move(str(kept[key]), dst)
        entries.append({"key": key, "name": name, "file": dst.name})

    manifest = {
        "stemforge": __version__,
        "song": src.stem,
        "source": str(src.resolve()),
        "mode": args.mode,
        "quality": quality,
        "device": hw["device"],
        "duration_sec": round(len(mix) / sr, 2),
        "sample_rate": sr,
        "stems": entries,
    }

    if not args.no_analysis:
        report(85, "Detecting tempo and key...")
        drums = audio.read(song_dir / next(e["file"] for e in entries if e["key"] == "drums"))[0] \
            if any(e["key"] == "drums" for e in entries) else None
        manifest["bpm"], manifest["first_beat_sec"] = analysis.tempo(mix, sr, drums)
        manifest["key"] = analysis.key(mix, sr)

    vocal = next((e for e in entries if e["key"] == "vocals"), None)
    if args.lyrics and vocal:
        report(90, "Transcribing lyrics...")
        from stemforge import lyrics

        try:
            voc, vsr = audio.read(song_dir / vocal["file"])
            words = lyrics.transcribe(voc, vsr, hw["device"], args.lyrics_model, str(Path(args.models) / "whisper"))
            manifest["lyrics"] = words
            (song_dir / "lyrics.lrc").write_text(lyrics.to_lrc(words, src.stem), encoding="utf-8")
        except Exception as e:  # lyrics are a bonus; never fail the split for them
            rep.log("Lyrics skipped: %s" % e)

    manifest["elapsed_sec"] = round(time.time() - started, 1)
    path = song_dir / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    if not args.keep_work:
        shutil.rmtree(work, ignore_errors=True)
    report(100, "Done")
    rep.done(path, song_dir)
    return path


def cmd_split(args, rep):
    files = collect_inputs(args.inputs)
    if not files:
        rep.error("No audio files found.")
        return 2
    hw = hardware.detect()
    quality = hardware.resolve_quality(args.quality, hw["device"])
    rep.log("StemForge %s | %s (%s) | mode %s | quality %s | %d file(s)"
            % (__version__, hw["device"], hw["name"], args.mode, quality, len(files)))
    backend = separate.AudioSeparatorBackend(args.models)
    failures = 0
    for i, f in enumerate(files):
        try:
            split_one(f, args, hw, quality, backend, rep, i, len(files))
        except Exception as e:
            failures += 1
            rep.error("%s: %s" % (f.name, e))
    return 1 if failures else 0


def cmd_download(args, rep):
    """Fetch every model the selected modes/qualities need, so the first split is offline-ready."""
    hw = hardware.detect()
    qualities = ["fast", "best"] if args.quality == "all" else [hardware.resolve_quality(args.quality, hw["device"])]
    wanted = []
    for q in qualities:
        for mode in args.modes:
            wanted += [m for m in separate.models_for(mode, q) if m not in wanted]
    from audio_separator.separator import Separator

    sep = Separator(log_level=30, model_file_dir=str(args.models), output_dir=str(args.models))
    for i, model in enumerate(wanted):
        rep.progress(i / max(1, len(wanted) + args.lyrics) * 100, "Downloading %s" % model)
        sep.download_model_files(model)
    if args.lyrics:
        from faster_whisper.utils import download_model

        from stemforge import lyrics

        name = args.lyrics_model or lyrics.pick_model(hw["device"])
        rep.progress(len(wanted) / (len(wanted) + 1) * 100, "Downloading Whisper %s" % name)
        download_model(name, cache_dir=str(Path(args.models) / "whisper"))
    rep.progress(100, "Models ready")
    return 0


def cmd_doctor(args, rep):
    hw = hardware.detect()
    import torch

    info = {
        "stemforge": __version__,
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "device": hw["device"],
        "device_name": hw["name"],
        "auto_quality": hardware.resolve_quality("auto", hw["device"]),
        "ffmpeg": audio.ffmpeg_exe(),
        "models_dir": str(args.models),
    }
    print(json.dumps(info, indent=2))
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="stemforge", description="Split songs into stems with tempo, key and lyrics.")
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument("--json", action="store_true", help="JSON-lines progress (used by the Ableton device)")
    p.add_argument("--models", type=Path, default=default_models(), help="model cache folder")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("split", help="split one or more files or folders")
    s.add_argument("inputs", nargs="+")
    s.add_argument("--mode", choices=list(separate.STEMS), default="4stem")
    s.add_argument("--quality", choices=["auto", "fast", "best"], default="auto",
                   help="auto = best on an NVIDIA/Apple GPU, fast on CPU")
    s.add_argument("--out", type=Path, default=default_out())
    s.add_argument("--lyrics", action=argparse.BooleanOptionalAction, default=True)
    s.add_argument("--lyrics-model", default=None, help="Whisper model (default: large-v3-turbo on GPU, small on CPU)")
    s.add_argument("--no-analysis", action="store_true")
    s.add_argument("--overwrite", action="store_true")
    s.add_argument("--keep-work", action="store_true", help=argparse.SUPPRESS)

    d = sub.add_parser("download", help="pre-download models")
    d.add_argument("--modes", nargs="+", choices=list(separate.STEMS), default=list(separate.STEMS))
    d.add_argument("--quality", choices=["auto", "fast", "best", "all"], default="auto")
    d.add_argument("--lyrics", action=argparse.BooleanOptionalAction, default=True)
    d.add_argument("--lyrics-model", default=None)

    sub.add_parser("doctor", help="show device, versions and paths")
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    rep = Reporter(json_mode=args.json)
    try:
        return {"split": cmd_split, "download": cmd_download, "doctor": cmd_doctor}[args.command](args, rep)
    except Exception as e:
        rep.error(str(e))
        return 1
