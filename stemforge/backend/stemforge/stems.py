"""Canonical stem catalog. Order here is the lane order in the mixer."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class StemDef:
    id: str
    label: str          # shown in the UI
    file_name: str      # used in [Title]_[StemName]_[BPM]_[Key].wav
    description: str
    parent: str | None = None  # sub-stems (e.g. guitar split) sum to their parent


STEMS: list[StemDef] = [
    StemDef("vocals", "Vocals", "Vocals", "Lead + backing vocals"),
    StemDef("drums", "Drums", "Drums", "Kit: kick, snare, hats, cymbals, toms"),
    StemDef("percussion", "Percussion", "Percussion", "Shakers, congas, tambourine, claps, hand percussion"),
    StemDef("bass", "Bass", "Bass", "Bass guitar + synth bass"),
    StemDef("guitar", "Guitar", "Guitar", "Electric, acoustic, lead guitar"),
    StemDef("guitar_electric", "Guitar · Electric", "GuitarElectric", "Electric guitar (sub-split)", parent="guitar"),
    StemDef("guitar_acoustic", "Guitar · Acoustic", "GuitarAcoustic", "Acoustic guitar (sub-split)", parent="guitar"),
    StemDef("piano", "Piano / Keys", "PianoKeys", "Acoustic + electric piano"),
    StemDef("synth", "Synth", "Synth", "Pads, leads, arps (excl. synth bass)"),
    StemDef("organ", "Organ", "Organ", "Hammond, church, combo organ"),
    StemDef("aux", "Auxiliary", "Auxiliary", "Strings, brass, woodwinds, mallets, FX"),
    StemDef("residual", "Residual / Other", "Residual", "Everything left over — stems always sum to the original mix"),
]

STEM_BY_ID = {s.id: s for s in STEMS}
TOP_LEVEL_IDS = [s.id for s in STEMS if s.parent is None]

# Confidence below this threshold is flagged in the UI.
LOW_CONFIDENCE_THRESHOLD = 0.5
LOW_CONFIDENCE_LABEL = "Low confidence — may contain bleed"
NOT_DETECTED_LABEL = "Not detected"
