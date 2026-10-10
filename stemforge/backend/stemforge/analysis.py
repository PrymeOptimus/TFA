"""Track analysis: tempo, key, duration and a style estimate.

Tempo and key use standard MIR methods (librosa beat tracking, Krumhansl-Schmuckler
key profiles). The genre/style label is a transparent rule-based estimate from
audio descriptors — there is no trained genre classifier bundled — and is always
returned with `method: "heuristic"` so the UI can say so.
"""
from __future__ import annotations

import numpy as np
import librosa

ANALYSIS_SR = 22050
PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles.
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _to_mono(audio: np.ndarray, sr: int) -> np.ndarray:
    mono = audio.mean(axis=0) if audio.ndim == 2 else audio
    if sr != ANALYSIS_SR:
        mono = librosa.resample(mono, orig_sr=sr, target_sr=ANALYSIS_SR)
    return mono.astype(np.float32)


def estimate_tempo(y: np.ndarray) -> tuple[float | None, np.ndarray]:
    """Beat-track, then refine: snap each beat to its local onset peak and fit a
    line through beat times. Removes the frame-grid quantisation of raw tempo."""
    hop = 128
    onset_env = librosa.onset.onset_strength(y=y, sr=ANALYSIS_SR, hop_length=hop)
    if not np.any(onset_env > 0):
        return None, onset_env
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=ANALYSIS_SR, hop_length=hop)
    bpm = float(np.atleast_1d(tempo)[0])
    if len(beats) >= 8:
        w = int(0.04 * ANALYSIS_SR / hop)
        snapped = [max(0, f - w) + int(np.argmax(onset_env[max(0, f - w):f + w + 1])) for f in beats]
        slope = np.polyfit(np.arange(len(snapped)), np.array(snapped) * hop / ANALYSIS_SR, 1)[0]
        if slope > 0 and abs(60 / slope - bpm) < 0.08 * bpm:
            bpm = 60 / slope
    if bpm <= 0:
        return None, onset_env
    # Fold into a conventional 70–180 BPM range.
    while bpm < 70:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(bpm, 1), onset_env


def estimate_key(y: np.ndarray) -> dict:
    chroma = librosa.feature.chroma_cqt(y=y, sr=ANALYSIS_SR, hop_length=2048)
    profile = chroma.mean(axis=1)
    if not np.any(profile > 0):
        return {"key": None, "short": None, "confidence": 0.0}
    scores = []
    for i in range(12):
        scores.append((np.corrcoef(profile, np.roll(_MAJOR, i))[0, 1], i, "major"))
        scores.append((np.corrcoef(profile, np.roll(_MINOR, i))[0, 1], i, "minor"))
    scores.sort(reverse=True)
    best, runner = scores[0], scores[1]
    tonic = PITCHES[best[1]]
    mode = best[2]
    # Gap between best and runner-up correlation, scaled into 0..1.
    confidence = float(np.clip((best[0] - runner[0]) * 5 + 0.3 * max(best[0], 0), 0, 1))
    return {
        "key": f"{tonic} {mode}",
        "short": f"{tonic}{'maj' if mode == 'major' else 'min'}",
        "confidence": round(confidence, 2),
    }


def estimate_style(y: np.ndarray, bpm: float | None, onset_env: np.ndarray) -> dict:
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=1024))
    harm, perc = librosa.decompose.hpss(S, kernel_size=15)
    total = float(S.sum()) + 1e-9
    perc_ratio = float(perc.sum()) / total
    freqs = librosa.fft_frequencies(sr=ANALYSIS_SR, n_fft=2048)
    power = S ** 2
    low_ratio = float(power[freqs < 150].sum() / (power.sum() + 1e-9))
    centroid = float(np.mean(librosa.feature.spectral_centroid(S=S, sr=ANALYSIS_SR)))
    flatness = float(np.mean(librosa.feature.spectral_flatness(S=S)))
    onset_rate = float(np.mean(onset_env > (onset_env.mean() + onset_env.std()))) if onset_env.size else 0.0

    features = {
        "percussive_ratio": round(perc_ratio, 3),
        "low_end_ratio": round(low_ratio, 3),
        "spectral_centroid_hz": round(centroid, 1),
        "spectral_flatness": round(flatness, 4),
        "onset_density": round(onset_rate, 3),
    }
    b = bpm or 0.0
    rules: list[tuple[float, str]] = [
        (perc_ratio * 2 + low_ratio * 3 + (1.0 if 118 <= b <= 132 else 0) + onset_rate, "Electronic / House"),
        (low_ratio * 4 + (1.0 if (130 <= b <= 160 or 65 <= b <= 80) else 0) + perc_ratio, "Hip-Hop / Trap"),
        (low_ratio * 3 + (1.0 if 80 <= b < 105 else 0) + (0.5 if centroid < 2200 else 0), "Hip-Hop / R&B"),
        ((1.0 if centroid > 2400 else 0) + flatness * 20 + (0.8 if 100 <= b <= 160 else 0) + perc_ratio, "Rock / Alternative"),
        ((1.0 - perc_ratio) * 1.5 + (0.8 if centroid < 1800 else 0) + (0.5 if b < 100 else 0), "Acoustic / Ballad"),
        ((1.0 - perc_ratio) * 2 + (1.0 if onset_rate < 0.05 else 0) + (0.5 if low_ratio < 0.1 else 0), "Ambient / Cinematic"),
        ((0.8 if 95 <= b <= 125 else 0) + perc_ratio + (0.6 if 1800 <= centroid <= 3000 else 0), "Pop"),
    ]
    rules.sort(reverse=True)
    top, second = rules[0], rules[1]
    confidence = float(np.clip((top[0] - second[0]) / (abs(top[0]) + 1e-6) * 2, 0.05, 0.6))
    return {
        "label": top[1],
        "alternatives": [r[1] for r in rules[1:3]],
        "confidence": round(confidence, 2),
        "method": "heuristic",
        "features": features,
    }


def analyze(audio: np.ndarray, sr: int) -> dict:
    duration = audio.shape[-1] / float(sr)
    y = _to_mono(audio, sr)
    bpm, onset_env = estimate_tempo(y)
    key = estimate_key(y)
    style = estimate_style(y, bpm, onset_env)
    return {
        "duration_sec": round(duration, 2),
        "bpm": bpm,
        "key": key["key"],
        "key_short": key["short"],
        "key_confidence": key["confidence"],
        "style": style,
    }
