"""Decoding (via ffmpeg) and WAV writing."""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import soundfile as sf


class DecodeError(RuntimeError):
    pass


def ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def transcode_to_wav(src: Path, dst: Path, sample_rate: int) -> None:
    """Normalise any supported input to stereo float WAV at `sample_rate`."""
    if not ffmpeg_available():
        raise DecodeError("ffmpeg is required to decode audio but was not found on PATH")
    cmd = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-vn", "-ac", "2", "-ar", str(sample_rate),
        "-c:a", "pcm_f32le", str(dst),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not dst.exists():
        raise DecodeError(f"Could not decode audio: {proc.stderr.strip()[:300] or 'unknown error'}")


def probe_title(src: Path) -> str | None:
    """Return the embedded title tag if present."""
    if shutil.which("ffprobe") is None:
        return None
    proc = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(src)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        return None
    try:
        tags = json.loads(proc.stdout).get("format", {}).get("tags", {})
    except json.JSONDecodeError:
        return None
    for k, v in tags.items():
        if k.lower() == "title" and str(v).strip():
            return str(v).strip()
    return None


def read_wav(path: Path) -> tuple[np.ndarray, int]:
    """Return audio as float32 array shaped (channels, samples)."""
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return np.ascontiguousarray(data.T), sr


def write_wav(path: Path, audio: np.ndarray, sr: int, subtype: str = "PCM_24") -> None:
    sf.write(str(path), np.ascontiguousarray(audio.T), sr, subtype=subtype)


_SAFE = re.compile(r"[^A-Za-z0-9#\-]+")


def safe_token(text: str, fallback: str = "Track") -> str:
    token = _SAFE.sub("_", text).strip("_")
    return token[:80] or fallback


def stem_filename(title: str, stem_name: str, bpm: float | None, key_short: str | None) -> str:
    """[OriginalTitle]_[StemName]_[BPM]_[Key].wav"""
    bpm_part = f"{int(round(bpm))}BPM" if bpm else "UnknownBPM"
    key_part = safe_token(key_short or "UnknownKey", "UnknownKey")
    return f"{safe_token(title)}_{stem_name}_{bpm_part}_{key_part}.wav"
