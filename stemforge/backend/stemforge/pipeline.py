"""End-to-end separation pipeline.

primary split (Demucs / DSP)
  ├─ drums  ──refine──> Drums (kit) + Percussion
  ├─ other  ──refine──> keys (merged into Piano/Keys) + Synth + Organ + Auxiliary + unclassified
  ├─ guitar ──refine──> Electric / Acoustic sub-stems (only when clearly separable)
  └─ vocals, bass, piano pass through
then: presence detection → "Not detected" stems are not written and their audio
falls into Residual, so the written stems always sum back to the original mix.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

import numpy as np
import librosa

from . import refine
from .audio_io import stem_filename, write_wav
from .config import Settings
from .separation import Separator
from .stems import (LOW_CONFIDENCE_LABEL, LOW_CONFIDENCE_THRESHOLD, NOT_DETECTED_LABEL,
                    STEM_BY_ID, STEMS)

log = logging.getLogger(__name__)

ProgressFn = Callable[[float, str], None]

# Presence thresholds.
MIN_REL_LEVEL_DB = -38.0      # stem RMS relative to mix RMS
MIN_ACTIVE_FRACTION = 0.03    # share of frames where the stem is audible in the mix
REFINED_CONFIDENCE_CAP = 0.75  # rule-based refinement is never reported as "high"
SUBSPLIT_MIN_SHARE = 0.15
SUBSPLIT_MIN_CONFIDENCE = 0.55


def _rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + 1e-20))


def presence(stem: np.ndarray, mix: np.ndarray) -> tuple[bool, float, float]:
    """Return (detected, level_db_rel_mix, active_fraction)."""
    level_db = 20 * np.log10(_rms(stem) / _rms(mix))
    frame, hop = 2048, 1024
    s = librosa.feature.rms(y=stem.mean(axis=0), frame_length=frame, hop_length=hop)[0]
    m = librosa.feature.rms(y=mix.mean(axis=0), frame_length=frame, hop_length=hop)[0]
    active = (s > m * 10 ** (-30 / 20)) & (s > 1e-4)
    frac = float(active.mean()) if active.size else 0.0
    detected = bool(level_db > MIN_REL_LEVEL_DB and frac > MIN_ACTIVE_FRACTION)
    return detected, float(level_db), frac


def dominance_confidence(stems: dict[str, np.ndarray]) -> dict[str, float]:
    """Proxy for separation quality: share of a stem's energy sitting in
    time-frequency bins where it dominates all other stems combined. Stems that
    mostly live underneath other sources are the ones most likely to carry bleed."""
    names = list(stems)
    if not names:
        return {}
    P = np.stack([np.abs(librosa.stft(stems[n].mean(axis=0), n_fft=2048, hop_length=1024)) ** 2 for n in names])
    total = P.sum(axis=0)
    out = {}
    for i, n in enumerate(names):
        others = total - P[i]
        e = P[i].sum() + 1e-12
        dom = float(P[i][P[i] > others].sum() / e)
        out[n] = float(np.clip(0.25 + 0.9 * dom, 0, 1))
    return out


def run(mix: np.ndarray, sr: int, separator: Separator, out_dir: Path, title: str,
        bpm: float | None, key_short: str | None, settings: Settings,
        progress: ProgressFn = lambda p, s: None) -> list[dict]:
    out_dir.mkdir(parents=True, exist_ok=True)
    zeros = np.zeros_like(mix)

    progress(0.10, f"Primary separation ({separator.name})")
    prim = separator.separate(mix, sr)

    progress(0.55, "Refining drums → kit + percussion")
    drums = refine.split(prim.get("drums", zeros), sr, refine.DRUM_CLASSES, refine.classify_drums)

    progress(0.68, "Refining keys/other → piano, synth, organ, auxiliary")
    other = refine.split(prim.get("other", zeros), sr, refine.OTHER_CLASSES, refine.classify_other, k=24)

    progress(0.80, "Analysing guitar character")
    guitar = refine.split(prim.get("guitar", zeros), sr, refine.GUITAR_CLASSES, refine.classify_guitar, k=12)

    candidates: dict[str, np.ndarray] = {
        "vocals": prim.get("vocals", zeros),
        "drums": drums.stems["drums"],
        "percussion": drums.stems["percussion"],
        "bass": prim.get("bass", zeros),
        "guitar": prim.get("guitar", zeros),
        "piano": prim.get("piano", zeros) + other.stems["keys"],
        "synth": other.stems["synth"],
        "organ": other.stems["organ"],
        "aux": other.stems["aux"],
    }
    method = {
        "vocals": "primary", "bass": "primary", "guitar": "primary",
        "piano": "primary+refined" if "piano" in prim else "refined",
        "drums": "refined", "percussion": "refined",
        "synth": "refined", "organ": "refined", "aux": "refined",
    }
    class_conf = {
        "drums": drums.confidence["drums"], "percussion": drums.confidence["percussion"],
        "synth": other.confidence["synth"], "organ": other.confidence["organ"],
        "aux": other.confidence["aux"], "piano": other.confidence["keys"] if "piano" not in prim else None,
    }

    progress(0.88, "Detecting instruments + scoring confidence")
    detection = {k: presence(v, mix) for k, v in candidates.items()}
    detected = {k: v for k, v in candidates.items() if detection[k][0]}
    dom = dominance_confidence(detected)

    progress(0.93, "Writing stems")
    results: list[dict] = []
    written_sum = np.zeros_like(mix)
    for sid, audio in candidates.items():
        ok, level_db, active = detection[sid]
        entry = _entry(sid, title, bpm, key_short)
        entry.update(level_db=round(level_db, 1), active_fraction=round(active, 3), method=method[sid])
        if not ok:
            entry.update(status="not_detected", flag=NOT_DETECTED_LABEL, confidence=None)
            results.append(entry)
            continue
        conf = dom[sid]
        if class_conf.get(sid) is not None:
            conf = min(0.5 * conf + 0.5 * class_conf[sid], REFINED_CONFIDENCE_CAP)
        conf = min(conf, separator.confidence_cap)
        _finish(entry, conf)
        write_wav(out_dir / entry["download_name"], audio, sr, settings.wav_subtype)
        written_sum += audio
        results.append(entry)

    # Guitar sub-split (sub-stems sum to the Guitar stem; they are not added to the residual sum).
    g_ok = detection["guitar"][0]
    g_split = g_ok and all(
        guitar.energy_share[c] >= SUBSPLIT_MIN_SHARE and guitar.confidence[c] >= SUBSPLIT_MIN_CONFIDENCE
        for c in refine.GUITAR_CLASSES
    )
    if g_ok:
        dominant = max(refine.GUITAR_CLASSES, key=lambda c: guitar.energy_share[c])
        guitar_entry = next(e for e in results if e["id"] == "guitar")
        guitar_entry["character"] = (
            "Electric + acoustic" if g_split else
            f"Mostly {'electric' if dominant == 'guitar_electric' else 'acoustic'}"
        )
    for sid in refine.GUITAR_CLASSES:
        entry = _entry(sid, title, bpm, key_short)
        entry["method"] = "refined"
        if not g_split:
            entry.update(status="not_detected", flag=NOT_DETECTED_LABEL, confidence=None,
                         note="Electric/acoustic split not reliably detectable in this track" if g_ok else None)
        else:
            conf = min(0.5 * dom["guitar"] + 0.5 * guitar.confidence[sid], REFINED_CONFIDENCE_CAP,
                       separator.confidence_cap)
            _finish(entry, conf)
            entry["level_db"] = round(20 * np.log10(_rms(guitar.stems[sid]) / _rms(mix)), 1)
            write_wav(out_dir / entry["download_name"], guitar.stems[sid], sr, settings.wav_subtype)
        results.append(entry)

    # Residual: exact remainder, so all written top-level stems + residual == mix.
    residual = (mix - written_sum).astype(np.float32)
    entry = _entry("residual", title, bpm, key_short)
    entry["method"] = "remainder"
    r_ok, r_db, r_active = presence(residual, mix)
    entry.update(level_db=round(r_db, 1), active_fraction=round(r_active, 3))
    # The residual is always written so the stem set can always be summed back
    # to the original; it is just flagged when it is effectively silent.
    write_wav(out_dir / entry["download_name"], residual, sr, settings.wav_subtype)
    entry.update(status="ok", confidence=None, low_confidence=False,
                 flag=None if r_ok else "Near-silent — nothing significant left over")
    results.append(entry)

    order = {s.id: i for i, s in enumerate(STEMS)}
    results.sort(key=lambda e: order[e["id"]])
    progress(1.0, "Done")
    return results


def _entry(sid: str, title: str, bpm: float | None, key_short: str | None) -> dict:
    d = STEM_BY_ID[sid]
    return {
        "id": sid, "label": d.label, "description": d.description, "parent": d.parent,
        "download_name": stem_filename(title, d.file_name, bpm, key_short),
    }


def _finish(entry: dict, conf: float) -> None:
    low = conf < LOW_CONFIDENCE_THRESHOLD
    entry.update(status="ok", confidence=round(float(conf), 2), low_confidence=low,
                 flag=LOW_CONFIDENCE_LABEL if low else None)
