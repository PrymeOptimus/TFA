"""Tempo-matched stem renders + waveform peaks, used by the DAW plugin.

Stretching runs ffmpeg's `rubberband` filter (pitch-preserving, transient-aware)
when the local ffmpeg has it, otherwise ffmpeg's `atempo` (WSOLA). Renders are
cached per track and tempo; only the two most recent tempos are kept on disk.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

import numpy as np

from .audio_io import read_wav, stem_filename
from .config import Settings
from .stems import STEM_BY_ID
from .store import TrackStore

MIN_RATIO, MAX_RATIO = 0.5, 2.0
KEEP_RENDERS = 2

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


class StretchError(ValueError):
    pass


@lru_cache(maxsize=1)
def has_rubberband() -> bool:
    try:
        out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
    except OSError:
        return False
    return any(line.split()[1:2] == ["rubberband"] for line in out.splitlines() if line.strip())


def _lock_for(key: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(key, threading.Lock())


def _stretch_file(src, dst, ratio: float, subtype: str) -> None:
    filt = f"rubberband=tempo={ratio:.6f}:transients=crisp" if has_rubberband() else f"atempo={ratio:.6f}"
    codec = {"PCM_16": "pcm_s16le", "FLOAT": "pcm_f32le"}.get(subtype, "pcm_s24le")
    tmp = dst.with_name(dst.name + ".part.wav")
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
         "-filter:a", filt, "-c:a", codec, str(tmp)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg stretch failed: {proc.stderr.strip()[:300]}")
    tmp.replace(dst)


def render(store: TrackStore, meta: dict, bpm: float | None, settings: Settings) -> dict:
    a = meta["analysis"]
    orig = a.get("bpm")
    target = round(float(bpm), 2) if bpm and orig else None
    if target is not None and abs(target - orig) < 0.01:
        target = None
    ratio = (target / orig) if target else 1.0
    if not (MIN_RATIO <= ratio <= MAX_RATIO):
        raise StretchError(f"Tempo {target} is outside the stretch range "
                           f"({orig * MIN_RATIO:.1f}–{orig * MAX_RATIO:.1f} BPM for this track)")

    tid = meta["id"]
    stems = [e for e in meta["stems"] if e["status"] == "ok"]
    out_stems = []
    if target is None:
        for e in stems:
            out_stems.append((e, store.stems_dir(tid) / e["download_name"]))
    else:
        rdir = store.dir(tid) / "rendered" / f"{target:.2f}"
        with _lock_for(f"{tid}:{target:.2f}"):
            rdir.mkdir(parents=True, exist_ok=True)
            jobs = []
            for e in stems:
                name = stem_filename(meta["title"], STEM_BY_ID[e["id"]].file_name, target, a.get("key_short"))
                dst = rdir / name
                out_stems.append((e, dst))
                if not dst.exists():
                    jobs.append((store.stems_dir(tid) / e["download_name"], dst))
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(lambda j: _stretch_file(j[0], j[1], ratio, settings.wav_subtype), jobs))
            rdir.touch()
        _prune_renders(store.dir(tid) / "rendered")

    return {
        "bpm": target or orig,
        "original_bpm": orig,
        "ratio": round(ratio, 6),
        "stretched": target is not None,
        "engine": ("rubberband" if has_rubberband() else "atempo") if target else None,
        "grid_offset_sec": round(float(a.get("grid_offset_sec") or 0.0) / ratio, 4),
        "stems": [{"id": e["id"], "label": e["label"], "parent": e["parent"],
                   "path": str(p), "file_name": p.name} for e, p in out_stems],
    }


def _prune_renders(root) -> None:
    dirs = sorted((d for d in root.iterdir() if d.is_dir()), key=lambda d: d.stat().st_mtime, reverse=True)
    for d in dirs[KEEP_RENDERS:]:
        shutil.rmtree(d, ignore_errors=True)


def _peaks_of(audio: np.ndarray, buckets: int) -> list[int]:
    mono = audio.mean(axis=0)
    n = len(mono) // buckets * buckets
    if n == 0:
        return [0] * (buckets * 2)
    frames = mono[:n].reshape(buckets, -1)
    lo, hi = frames.min(axis=1), frames.max(axis=1)
    out = np.empty(buckets * 2, np.int16)
    out[0::2] = np.clip(np.round(lo * 1000), -1000, 1000)
    out[1::2] = np.clip(np.round(hi * 1000), -1000, 1000)
    return out.tolist()


def peaks(store: TrackStore, meta: dict, buckets: int) -> dict:
    """Min/max peaks (scaled to ±1000) for the mix and every written stem."""
    tid = meta["id"]
    cache = store.dir(tid) / "peaks.json"
    if cache.exists():
        data = json.loads(cache.read_text())
        if data.get("buckets") == buckets:
            return data
    mix, sr = read_wav(store.dir(tid) / "decoded.wav")
    data = {"buckets": buckets, "scale": 1000, "duration_sec": mix.shape[-1] / sr,
            "mix": _peaks_of(mix, buckets), "stems": {}}
    for e in meta["stems"]:
        if e["status"] == "ok":
            audio, _ = read_wav(store.stems_dir(tid) / e["download_name"])
            data["stems"][e["id"]] = _peaks_of(audio, buckets)
    if meta["status"] == "done":
        cache.write_text(json.dumps(data))
    return data
