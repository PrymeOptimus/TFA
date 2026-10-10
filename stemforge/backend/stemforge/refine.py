"""Second-pass refinement.

Splits a primary stem into sub-classes without a dedicated neural model:

1. Factorise the stem's magnitude spectrogram with NMF (K spectral templates W,
   K activation curves H).
2. Describe each component with interpretable features (spectral centroid,
   tonality, attack sharpness, sustain, 4–8 Hz amplitude modulation, ...).
3. Score each component against each target class with transparent rules,
   softmax the scores into soft assignments.
4. Build Wiener-style soft masks per class and apply them to the complex STFT.
   The last class is computed as `source - sum(others)` so children always sum
   exactly to their parent.

This is honest-to-goodness signal processing, not a trained classifier — the
per-class confidence it reports is the assignment margin, and the pipeline caps
these stems' confidence so the UI flags likely bleed. Swap `classify_*` for a
model when one is available; the masking/summing contract stays the same.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import librosa

from .separation import HOP, N_FFT, istft_stereo, stft_stereo

EPS = 1e-9


def nmf_kl(V: np.ndarray, k: int, iters: int = 80, seed: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Multiplicative-update NMF with KL divergence. V: (F, T) >= 0."""
    rng = np.random.default_rng(seed)
    F, T = V.shape
    scale = np.sqrt(V.mean() / k + EPS)
    W = (rng.random((F, k)) * scale + EPS).astype(np.float32)
    H = (rng.random((k, T)) * scale + EPS).astype(np.float32)
    V = V.astype(np.float32)
    ones = np.ones_like(V)
    for _ in range(iters):
        WH = W @ H + EPS
        H *= (W.T @ (V / WH)) / (W.T @ ones + EPS)
        WH = W @ H + EPS
        W *= ((V / WH) @ H.T) / (ones @ H.T + EPS)
        # Normalise templates, push scale into activations.
        norm = W.sum(axis=0, keepdims=True) + EPS
        W /= norm
        H *= norm.T
    return W, H


@dataclass
class Component:
    centroid: float
    flatness: float
    low: float          # energy share < 250 Hz
    body: float         # energy share 150–500 Hz
    high: float         # energy share > 5 kHz
    tonality: float     # 0..1, peaky (harmonic) vs. flat (noisy) template
    attack: float       # 0..1, sharpness of onsets in activation
    sustain: float      # 0..1, how much level remains ~250 ms after a peak
    duty: float         # fraction of time the component is active
    am_depth: float     # relative 4–8 Hz amplitude modulation (tremolo / Leslie)
    energy: float       # share of the parent stem's energy


def describe(W: np.ndarray, H: np.ndarray, sr: int) -> list[Component]:
    freqs = librosa.fft_frequencies(sr=sr, n_fft=(W.shape[0] - 1) * 2)
    frame_rate = sr / HOP
    energies = np.array([np.sum(W[:, i] ** 2) * np.sum(H[i] ** 2) for i in range(W.shape[1])])
    energies = energies / (energies.sum() + EPS)
    lag = max(1, int(round(0.25 * frame_rate)))
    comps = []
    for i in range(W.shape[1]):
        w = W[:, i] + EPS
        p = w ** 2
        ptot = p.sum()
        centroid = float((freqs * w).sum() / w.sum())
        flatness = float(np.exp(np.mean(np.log(w))) / np.mean(w))
        top = np.sort(p)[::-1]
        tonality = float(top[: max(1, len(p) // 50)].sum() / ptot)
        h = H[i]
        hn = h / (h.max() + EPS)
        dh = np.diff(hn, prepend=hn[:1])
        pos = dh[dh > 0]
        attack = float(np.mean(np.sort(pos)[-max(1, len(pos) // 20):])) if pos.size else 0.0
        peaks = np.flatnonzero((hn[1:-1] > hn[:-2]) & (hn[1:-1] >= hn[2:]) & (hn[1:-1] > 0.3)) + 1
        peaks = peaks[peaks + lag < len(hn)]
        sustain = float(np.mean(hn[peaks + lag] / (hn[peaks] + EPS))) if peaks.size else 0.5
        duty = float(np.mean(hn > 0.15))
        comps.append(Component(
            centroid=centroid,
            flatness=flatness,
            low=float(p[freqs < 250].sum() / ptot),
            body=float(p[(freqs >= 150) & (freqs < 500)].sum() / ptot),
            high=float(p[freqs > 5000].sum() / ptot),
            tonality=float(np.clip(tonality * 2.5, 0, 1)),
            attack=float(np.clip(attack * 3, 0, 1)),
            sustain=float(np.clip(sustain, 0, 1)),
            duty=duty,
            am_depth=_am_depth(h, frame_rate),
            energy=float(energies[i]),
        ))
    return comps


def _am_depth(h: np.ndarray, frame_rate: float) -> float:
    if h.size < 64 or frame_rate < 16:
        return 0.0
    x = h - np.convolve(h, np.ones(9) / 9, mode="same")
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size)))
    f = np.fft.rfftfreq(x.size, 1 / frame_rate)
    band = spec[(f >= 4) & (f <= 8)].sum()
    ref = spec[(f >= 0.5) & (f <= min(20, frame_rate / 2))].sum() + EPS
    return float(np.clip(band / ref * 2, 0, 1))


def _softmax(scores: np.ndarray, temp: float) -> np.ndarray:
    z = scores / temp
    z -= z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


# ---- class rules -----------------------------------------------------------

DRUM_CLASSES = ["percussion", "drums"]  # last = catch-all


def classify_drums(c: Component) -> list[float]:
    kit = 1.0 + 3.0 * c.low
    if 1000 < c.centroid < 5000 and c.flatness > 0.25:
        kit += 0.8                               # snare-like broadband
    if c.high > 0.45 and c.sustain < 0.5:
        kit += 0.5                               # hats/cymbals with fast decay
    perc = 0.4
    if c.tonality > 0.45 and 150 < c.centroid < 900 and c.low < 0.3:
        perc += 1.4                              # pitched hand drums (congas, bongos)
    if c.high > 0.55 and c.duty > 0.45 and c.flatness > 0.3:
        perc += 0.9                              # dense noisy high band (shakers, tambourine)
    if 900 < c.centroid < 2500 and c.attack > 0.6 and c.flatness > 0.35 and c.low < 0.1:
        perc += 0.3                              # clap-like
    return [perc, kit]


OTHER_CLASSES = ["keys", "synth", "organ", "residual", "aux"]  # last = catch-all


def classify_other(c: Component) -> list[float]:
    keys = 2.0 * c.attack + 1.5 * (1 - c.sustain) + 0.6 * c.tonality
    organ = 1.2 * c.tonality + 1.6 * c.sustain + 2.5 * c.am_depth + (0.5 if 0.2 < c.attack < 0.7 else 0)
    synth = 0.9 * c.tonality + 0.9 * c.sustain + (0.9 if c.centroid > 1500 else 0) \
        + (0.7 if c.attack > 0.5 and c.duty > 0.35 and c.centroid > 900 else 0)
    residual = 0.2 + (1.8 if c.flatness > 0.4 and c.tonality < 0.25 else 0)
    aux = 1.6
    return [keys, synth, organ, residual, aux]


GUITAR_CLASSES = ["guitar_acoustic", "guitar_electric"]


def classify_guitar(c: Component) -> list[float]:
    acoustic = 1.0 + 2.0 * c.high + 1.0 * c.attack + 1.0 * (1 - c.sustain) + 1.0 * c.body
    electric = 1.0 + (1.2 if 700 < c.centroid < 3500 else 0) + 2.0 * c.flatness + 1.2 * c.sustain
    return [acoustic, electric]


# ---- generic splitter -------------------------------------------------------

@dataclass
class SplitResult:
    stems: dict[str, np.ndarray]
    confidence: dict[str, float]
    energy_share: dict[str, float]


def split(source: np.ndarray, sr: int, classes: list[str], rule, k: int = 20,
          temp: float = 0.45, iters: int = 80) -> SplitResult:
    n = source.shape[-1]
    if not np.any(source):
        zeros = {c: np.zeros_like(source) for c in classes}
        return SplitResult(zeros, {c: 0.0 for c in classes}, {c: 0.0 for c in classes})

    X = stft_stereo(source, N_FFT, HOP)
    V = np.abs(X).mean(axis=0)
    W, H = nmf_kl(V, k=k, iters=iters)
    comps = describe(W, H, sr)
    probs = _softmax(np.array([rule(c) for c in comps], dtype=np.float64), temp)

    # Soft class models -> Wiener masks.
    models = []
    for g in range(len(classes)):
        models.append((W * probs[:, g][None, :]) @ H)
    denom = np.sum(models, axis=0) + EPS

    stems: dict[str, np.ndarray] = {}
    acc = np.zeros_like(source)
    for g, name in enumerate(classes[:-1]):
        y = istft_stereo(X * (models[g] / denom)[None], n, HOP)
        stems[name] = y
        acc += y
    stems[classes[-1]] = (source - acc).astype(np.float32)

    energies = np.array([c.energy for c in comps])
    confidence, share = {}, {}
    winners = probs.argmax(axis=1)
    for g, name in enumerate(classes):
        share[name] = float((energies * probs[:, g]).sum())
        mask = winners == g
        if mask.any():
            confidence[name] = float((energies[mask] * probs[mask, g]).sum() / (energies[mask].sum() + EPS))
        else:
            confidence[name] = 0.0
    return SplitResult(stems, confidence, share)
