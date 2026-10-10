import numpy as np
import pytest

from stemforge import analysis, pipeline, refine
from stemforge.audio_io import read_wav, stem_filename
from stemforge.config import Settings
from stemforge.separation import DspSeparator
from stemforge.stems import LOW_CONFIDENCE_LABEL, NOT_DETECTED_LABEL

from .synth import SR, make_track


@pytest.mark.parametrize("bpm", [92, 120, 140])
def test_tempo_estimate(bpm):
    a = analysis.analyze(make_track(20, bpm=bpm), SR)
    assert abs(a["bpm"] - bpm) <= 1.0
    assert a["duration_sec"] == 20.0
    assert a["key"] and a["key_short"]
    assert a["style"]["method"] == "heuristic"


def test_filename_format():
    assert stem_filename("My Song (Live)", "Vocals", 127.6, "F#min") == "My_Song_Live_Vocals_128BPM_F#min.wav"
    assert stem_filename("", "Bass", None, None) == "Track_Bass_UnknownBPM_UnknownKey.wav"


def test_refine_split_sums_to_source():
    src = make_track(6)
    res = refine.split(src, SR, refine.OTHER_CLASSES, refine.classify_other, k=8, iters=20)
    total = sum(res.stems.values())
    assert np.allclose(total, src, atol=1e-5)
    assert set(res.confidence) == set(refine.OTHER_CLASSES)


def test_refine_split_silent_input():
    res = refine.split(np.zeros((2, SR), np.float32), SR, refine.DRUM_CLASSES, refine.classify_drums)
    assert all(not np.any(v) for v in res.stems.values())


class FakeSeparator:
    """Returns ground-truth-ish stems: everything as 'other' except a supplied vocal."""
    name = "fake"
    confidence_cap = 1.0

    def __init__(self, vocal):
        self.vocal = vocal

    def separate(self, mix, sr):
        z = np.zeros_like(mix)
        return {"vocals": self.vocal, "drums": z, "bass": z, "guitar": z, "piano": z,
                "other": mix - self.vocal}


def _sum_written(results, out_dir, shape):
    total = np.zeros(shape, np.float32)
    for r in results:
        if r["status"] == "ok" and r["parent"] is None:
            x, _ = read_wav(out_dir / r["download_name"])
            total += x
    return total


def test_pipeline_dsp_sums_to_mix(tmp_path):
    mix = make_track(12)
    res = pipeline.run(mix, SR, DspSeparator(), tmp_path, "Song", 120, "Cmaj",
                       Settings(wav_subtype="FLOAT"))
    ids = [r["id"] for r in res]
    assert ids[0] == "vocals" and ids[-1] == "residual"
    assert len([r for r in res if r["parent"] is None]) == 10
    assert np.allclose(_sum_written(res, tmp_path, mix.shape), mix, atol=1e-5)
    for r in res:
        if r["status"] == "not_detected":
            assert r["flag"] == NOT_DETECTED_LABEL
            assert not (tmp_path / r["download_name"]).exists()
        elif r["id"] != "residual":
            # DSP fallback is confidence-capped -> always flagged
            assert r["low_confidence"] and r["flag"] == LOW_CONFIDENCE_LABEL


def test_absent_instruments_not_detected(tmp_path):
    mix = make_track(8)
    vocal = np.zeros_like(mix)
    res = {r["id"]: r for r in pipeline.run(mix, SR, FakeSeparator(vocal), tmp_path, "S", 120, "Cmaj",
                                            Settings(wav_subtype="FLOAT"))}
    for sid in ("vocals", "bass", "guitar", "guitar_electric", "guitar_acoustic"):
        assert res[sid]["status"] == "not_detected", sid
    assert res["residual"]["status"] == "ok"
    assert np.allclose(_sum_written(list(res.values()), tmp_path, mix.shape), mix, atol=1e-5)
