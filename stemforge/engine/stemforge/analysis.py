"""Tempo and key estimation."""

import librosa
import numpy as np

# Krumhansl-Schmuckler key profiles
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]

ANALYSIS_SR = 22050


def _mono(audio, sr):
    y = audio.mean(axis=1) if audio.ndim == 2 else audio
    return librosa.resample(y.astype(np.float32), orig_sr=sr, target_sr=ANALYSIS_SR)


def tempo(audio, sr, beat_source=None):
    """Return (bpm, first_downbeat_seconds). beat_source (e.g. drums) improves accuracy."""
    y = _mono(beat_source if beat_source is not None else audio, sr)
    bpm, beats = librosa.beat.beat_track(y=y, sr=ANALYSIS_SR, units="time", trim=False)
    bpm = float(np.atleast_1d(bpm)[0])
    if len(beats) >= 8:
        # librosa's tempo is quantised to its frame grid; a line through all beat times is far finer
        period = np.polyfit(np.arange(len(beats)), beats, 1)[0]
        if period > 0:
            bpm = 60.0 / period
    # fold into a DJ-friendly 70-180 range
    while bpm and bpm < 70:
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    if not len(beats) or not bpm:
        return round(bpm, 2), 0.0
    # the tracker can start late, so take the grid phase from all beats instead of the first one
    period = 60.0 / bpm
    phases = np.mod(beats, period)
    angle = np.angle(np.mean(np.exp(2j * np.pi * phases / period)))
    first = (angle / (2 * np.pi) * period) % period
    return round(bpm, 2), round(float(first), 3)


def key(audio, sr, harmonic_source=None):
    """Return a key name like 'A minor' using chroma correlation with key profiles."""
    y = _mono(harmonic_source if harmonic_source is not None else audio, sr)
    chroma = librosa.feature.chroma_cqt(y=y, sr=ANALYSIS_SR).mean(axis=1)
    if not np.any(chroma):
        return None
    best, best_score = None, -np.inf
    for i in range(12):
        for profile, mode in ((_MAJOR, "major"), (_MINOR, "minor")):
            score = np.corrcoef(chroma, np.roll(profile, i))[0, 1]
            if score > best_score:
                best, best_score = "%s %s" % (NOTES[i], mode), score
    return best
