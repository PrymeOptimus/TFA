"""Primary (built-in) stem splitters.

`DemucsSeparator` runs Meta's Hybrid Transformer Demucs. The default
`htdemucs_6s` model outputs vocals / drums / bass / guitar / piano / other.

`DspSeparator` is a model-free fallback (HPSS + stereo/band masking) so the app
works end-to-end without PyTorch or model weights. Its output is markedly lower
quality; every stem it produces is confidence-capped so the UI flags it.
"""
from __future__ import annotations

import logging
from typing import Protocol

import numpy as np
import librosa

from .config import Settings

log = logging.getLogger(__name__)

N_FFT = 4096
HOP = 1024


class Separator(Protocol):
    name: str
    confidence_cap: float

    def separate(self, mix: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        """mix: (2, N) float32. Returns stem name -> (2, N)."""


def stft_stereo(x: np.ndarray, n_fft: int = N_FFT, hop: int = HOP) -> np.ndarray:
    return np.stack([librosa.stft(c, n_fft=n_fft, hop_length=hop) for c in x])


def istft_stereo(X: np.ndarray, length: int, hop: int = HOP) -> np.ndarray:
    n_fft = (X.shape[1] - 1) * 2
    return np.stack([librosa.istft(c, hop_length=hop, n_fft=n_fft, length=length) for c in X]).astype(np.float32)


class DemucsSeparator:
    confidence_cap = 1.0

    def __init__(self, settings: Settings):
        import torch  # noqa: F401  (fail fast if unavailable)
        from demucs.pretrained import get_model

        kwargs = {}
        if settings.demucs_repo:
            from pathlib import Path
            kwargs["repo"] = Path(settings.demucs_repo)
        self.model = get_model(settings.demucs_model, **kwargs)
        self.model.eval()
        self.name = f"demucs:{settings.demucs_model}"
        if settings.device == "auto":
            import torch
            self.device = "cuda" if torch.cuda.is_available() else (
                "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu")
        else:
            self.device = settings.device

    def separate(self, mix: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        import torch
        from demucs.apply import apply_model

        audio = mix
        model_sr = self.model.samplerate
        if sr != model_sr:
            audio = np.stack([librosa.resample(c, orig_sr=sr, target_sr=model_sr) for c in mix])
        wav = torch.from_numpy(np.ascontiguousarray(audio))
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        wav = (wav - mean) / std
        with torch.no_grad():
            out = apply_model(self.model, wav[None], device=self.device, shifts=1,
                              split=True, overlap=0.25, progress=False)[0]
        out = (out * std + mean).cpu().numpy()
        stems = {}
        for name, s in zip(self.model.sources, out):
            if sr != model_sr:
                s = np.stack([librosa.resample(c, orig_sr=model_sr, target_sr=sr) for c in s])
            stems[name] = _fit_length(s.astype(np.float32), mix.shape[-1])
        return stems


class DspSeparator:
    """Model-free fallback. Masks partition the STFT, so stems sum to the mix."""

    name = "dsp-fallback"
    confidence_cap = 0.45

    def separate(self, mix: np.ndarray, sr: int) -> dict[str, np.ndarray]:
        X = stft_stereo(mix)
        mag = np.abs(X).mean(axis=0)
        h_mask, p_mask = librosa.decompose.hpss(mag, mask=True, margin=1.0)
        total = h_mask + p_mask + 1e-9
        h_mask, p_mask = h_mask / total, p_mask / total

        freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)[:, None]
        low = 1.0 / (1.0 + (freqs / 180.0) ** 6)            # bass region
        voice_band = np.exp(-0.5 * (np.log2(np.maximum(freqs, 1) / 1200.0) / 1.3) ** 2)

        L, R = np.abs(X[0]), np.abs(X[1])
        center = 1.0 - np.abs(L - R) / (L + R + 1e-9)        # 1 = panned centre
        center = center ** 4

        bass_m = h_mask * low
        vocal_m = h_mask * (1 - low) * center * voice_band
        other_m = h_mask - bass_m - vocal_m
        masks = {"drums": p_mask, "bass": bass_m, "vocals": vocal_m, "other": np.clip(other_m, 0, 1)}
        return {k: istft_stereo(X * m[None], mix.shape[-1]) for k, m in masks.items()}


def _fit_length(x: np.ndarray, n: int) -> np.ndarray:
    if x.shape[-1] >= n:
        return x[..., :n]
    return np.pad(x, ((0, 0), (0, n - x.shape[-1])))


def build_separator(settings: Settings) -> tuple[Separator, str | None]:
    """Return (separator, note). `note` explains any fallback."""
    if settings.engine == "dsp":
        return DspSeparator(), "DSP engine selected (STEMFORGE_ENGINE=dsp)."
    try:
        return DemucsSeparator(settings), None
    except Exception as exc:  # ImportError, weight download failure, etc.
        if settings.engine == "demucs":
            raise
        log.warning("Demucs unavailable, using DSP fallback: %s", exc)
        return DspSeparator(), (
            "Demucs model unavailable on this machine "
            f"({type(exc).__name__}: {str(exc)[:160]}). Using DSP fallback — expect heavy bleed."
        )
