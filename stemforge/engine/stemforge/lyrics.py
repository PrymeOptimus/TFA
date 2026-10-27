"""Timed lyrics from the vocal stem with faster-whisper; writes JSON lines and an .lrc file."""

import re

import librosa
import numpy as np

WHISPER_SR = 16000
# Phrases Whisper tends to invent over instrumental passages
_HALLUCINATION = re.compile(r"(thanks? (you )?for watching|subscribe|subtitles by|amara\.org)", re.I)


def pick_model(device):
    # turbo is accurate but slow on CPU; small keeps CPU runs practical
    return "large-v3-turbo" if device == "cuda" else "small"


def _load(model_name, device, models_dir):
    from faster_whisper import WhisperModel

    if device == "cuda":
        try:
            return WhisperModel(model_name, device="cuda", compute_type="float16", download_root=models_dir)
        except Exception:
            pass  # missing cuBLAS/cuDNN: fall back to CPU
    return WhisperModel(model_name, device="cpu", compute_type="int8", download_root=models_dir)


def transcribe(vocals, sr, device="cpu", model_name=None, models_dir=None, language=None):
    """Return {"language": str, "lines": [{"start", "end", "text"}]}."""
    y = vocals.mean(axis=1) if vocals.ndim == 2 else vocals
    y = librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=WHISPER_SR)
    peak = float(np.max(np.abs(y))) or 1.0
    y = (y / peak * 0.9).astype(np.float32)

    model = _load(model_name or pick_model(device), device, models_dir)
    segments, info = model.transcribe(
        y, language=language, word_timestamps=True, vad_filter=True,
        condition_on_previous_text=False, no_speech_threshold=0.6,
    )
    lines = []
    for seg in segments:
        text = seg.text.strip()
        if not text or _HALLUCINATION.search(text):
            continue
        if lines and lines[-1]["text"] == text:
            continue  # repeated-line loop
        lines.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": text})
    return {"language": info.language, "lines": lines}


def to_lrc(lyrics, title=None):
    out = []
    if title:
        out.append("[ti:%s]" % title)
    for line in lyrics["lines"]:
        minutes, seconds = divmod(line["start"], 60)
        out.append("[%02d:%05.2f]%s" % (minutes, seconds, line["text"]))
    return "\n".join(out) + "\n"
