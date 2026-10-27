"""Audio decoding with the ffmpeg bundled by imageio-ffmpeg (no PATH setup needed)."""

import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np
import soundfile as sf

SAMPLE_RATE = 44100


def ffmpeg_exe():
    return imageio_ffmpeg.get_ffmpeg_exe()


def decode_to_wav(src, dst, sample_rate=SAMPLE_RATE):
    """Decode any audio/video file to a 32-bit float stereo WAV at sample_rate."""
    cmd = [
        ffmpeg_exe(), "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-vn", "-ac", "2", "-ar", str(sample_rate), "-c:a", "pcm_f32le", str(dst),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError("Could not decode %s: %s" % (Path(src).name, result.stderr.strip() or "ffmpeg failed"))
    info = sf.info(str(dst))
    if info.frames < sample_rate:
        raise RuntimeError("Audio is shorter than one second.")
    return Path(dst)


def read(path):
    """Return (audio[samples, channels] float32, sample_rate)."""
    audio, sr = sf.read(str(path), dtype="float32", always_2d=True)
    return np.ascontiguousarray(audio), sr


def write(path, audio, sr):
    sf.write(str(path), audio, sr, subtype="PCM_24")


def rms_db(audio):
    return float(20 * np.log10(np.sqrt(np.mean(np.square(audio, dtype=np.float64))) + 1e-12))
