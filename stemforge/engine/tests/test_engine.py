import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from stemforge import analysis, audio, cli, hardware, lyrics, separate

SR = 44100


def tone(freq, seconds=3.0, amp=0.3):
    t = np.arange(int(SR * seconds)) / SR
    x = (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    return np.stack([x, x], axis=1)


class FakeBackend:
    """Writes one tone per stem label; records which models ran on which input."""

    LABELS = {
        separate.ROFORMER: ["vocals", "instrumental"],
        separate.DEMUCS_FAST: ["vocals", "drums", "bass", "other"],
        separate.DEMUCS_FINE: ["vocals", "drums", "bass", "other"],
        separate.DEMUCS_6: ["vocals", "drums", "bass", "guitar", "piano", "other"],
    }

    def __init__(self, silent=()):
        self.calls = []
        self.silent = set(silent)

    def run(self, model_file, input_wav, out_dir, prefix):
        self.calls.append((model_file, Path(input_wav).name))
        out = {}
        for i, key in enumerate(self.LABELS[model_file]):
            path = Path(out_dir) / ("%s_%s.wav" % (prefix, key))
            amp = 0.0 if key in self.silent else 0.2
            sf.write(path, tone(200 + 50 * i, amp=amp), SR, subtype="FLOAT")
            out[key] = path
        return out


@pytest.fixture
def mix(tmp_path):
    path = tmp_path / "mix.wav"
    sf.write(path, tone(220), SR, subtype="FLOAT")
    return path


@pytest.mark.parametrize("mode,quality,models", [
    ("vocals", "fast", [separate.DEMUCS_FAST]),
    ("4stem", "fast", [separate.DEMUCS_FAST]),
    ("6stem", "fast", [separate.DEMUCS_6]),
    ("vocals", "best", [separate.ROFORMER]),
    ("4stem", "best", [separate.ROFORMER, separate.DEMUCS_FINE]),
    ("6stem", "best", [separate.ROFORMER, separate.DEMUCS_6]),
])
def test_pipeline_runs_expected_models_and_returns_requested_stems(tmp_path, mix, mode, quality, models):
    backend = FakeBackend()
    stems = separate.separate(mix, tmp_path / "work", mode, quality, backend)
    assert [m for m, _ in backend.calls] == models
    assert list(stems) == separate.STEMS[mode] or set(stems) == set(separate.STEMS[mode])
    assert separate.models_for(mode, quality) == models


def test_best_quality_feeds_roformer_instrumental_to_demucs(tmp_path, mix):
    backend = FakeBackend()
    separate.separate(mix, tmp_path / "work", "4stem", "best", backend)
    assert backend.calls[1] == (separate.DEMUCS_FINE, "pass1_instrumental.wav")


def test_best_quality_folds_demucs_vocal_residue_into_other(tmp_path, mix):
    backend = FakeBackend()
    stems = separate.separate(mix, tmp_path / "work", "4stem", "best", backend)
    other, _ = audio.read(stems["other"])
    plain, _ = audio.read(tmp_path / "work" / "pass2_other.wav")
    residue, _ = audio.read(tmp_path / "work" / "pass2_vocals.wav")
    np.testing.assert_allclose(other, plain + residue, atol=1e-4)


def test_fast_vocals_mode_sums_non_vocal_stems(tmp_path, mix):
    stems = separate.separate(mix, tmp_path / "work", "vocals", "fast", FakeBackend())
    inst, _ = audio.read(stems["instrumental"])
    parts = sum(audio.read(tmp_path / "work" / ("pass1_%s.wav" % k))[0] for k in ("drums", "bass", "other"))
    np.testing.assert_allclose(inst, parts, atol=1e-4)


def test_drop_silent_keeps_vocals_and_drops_empty_stems(tmp_path, mix):
    stems = separate.separate(mix, tmp_path / "work", "6stem", "fast", FakeBackend(silent={"piano", "vocals"}))
    kept, dropped = separate.drop_silent(stems, audio.rms_db(audio.read(mix)[0]))
    assert dropped == ["piano"]
    assert "vocals" in kept


def test_auto_quality_depends_on_device():
    assert hardware.resolve_quality("auto", "cuda") == "best"
    assert hardware.resolve_quality("auto", "mps") == "best"
    assert hardware.resolve_quality("auto", "cpu") == "fast"
    assert hardware.resolve_quality("fast", "cuda") == "fast"


def test_key_detects_a_minor_triad():
    chord = tone(220.0, 4) + tone(261.63, 4) + tone(329.63, 4)  # A C E
    assert analysis.key(chord, SR) == "A minor"


def test_key_detects_c_major_triad():
    chord = tone(261.63, 4) + tone(329.63, 4) + tone(392.0, 4)  # C E G
    assert analysis.key(chord, SR) == "C major"


def test_tempo_on_click_track():
    seconds, bpm = 12, 120
    x = np.zeros(SR * seconds, dtype=np.float32)
    click = (np.sin(2 * np.pi * 1000 * np.arange(2000) / SR) * np.exp(-np.arange(2000) / 300)).astype(np.float32)
    for beat in np.arange(0.5, seconds - 0.1, 60 / bpm):
        i = int(beat * SR)
        x[i:i + 2000] += click
    found, first = analysis.tempo(np.stack([x, x], 1), SR)
    assert abs(found - bpm) < 2
    # clicks start at 0.5 s on a 0.5 s grid, so the grid phase is ~0 (allow for onset latency)
    assert min(first, 60 / found - first) < 0.06


def test_lrc_format():
    out = lyrics.to_lrc({"lines": [{"start": 5.5, "end": 7, "text": "hello"},
                                   {"start": 65.25, "end": 70, "text": "world"}]}, "Song")
    assert out == "[ti:Song]\n[00:05.50]hello\n[01:05.25]world\n"


def test_safe_name_strips_windows_illegal_characters():
    assert cli.safe_name('AC/DC: "Back" In Black?') == "AC_DC_ _Back_ In Black_"
    assert cli.safe_name("...") == "song"


def test_collect_inputs_walks_folders(tmp_path):
    (tmp_path / "a.mp3").write_bytes(b"")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.FLAC").write_bytes(b"")
    (tmp_path / "notes.txt").write_text("x")
    assert [p.name for p in cli.collect_inputs([tmp_path])] == ["a.mp3", "b.FLAC"]


def test_split_end_to_end_with_fake_backend(tmp_path, monkeypatch):
    src = tmp_path / "My Song.wav"
    sf.write(src, tone(220, 5), SR)
    monkeypatch.setattr(separate, "AudioSeparatorBackend", lambda models: FakeBackend())
    monkeypatch.setattr(hardware, "detect", lambda: {"device": "cpu", "name": "test"})
    out = tmp_path / "out"
    code = cli.main(["--json", "split", str(src), "--mode", "4stem", "--out", str(out), "--no-lyrics"])
    assert code == 0
    song = out / "My Song"
    manifest = json.loads((song / "manifest.json").read_text())
    assert [s["file"] for s in manifest["stems"]] == ["01 Vocals.wav", "02 Drums.wav", "03 Bass.wav", "04 Other.wav"]
    assert manifest["quality"] == "fast" and "bpm" in manifest and manifest["key"]
    assert all((song / s["file"]).exists() for s in manifest["stems"])
    assert not (song / ".work").exists()


# ---- model downloads -------------------------------------------------------------------------

import http.server
import threading


class FlakyServer:
    """Serves PAYLOAD with Range support; the first `drops` responses die halfway through."""

    PAYLOAD = bytes(range(256)) * 4096  # 1 MiB

    def __init__(self, drops=1, honor_range=True):
        outer = self
        self.drops, self.requests = drops, []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_HEAD(self):
                self.send_response(200)
                self.send_header("Content-Length", str(len(outer.PAYLOAD)))
                self.end_headers()

            def do_GET(self):
                outer.requests.append(self.headers.get("Range"))
                start = 0
                rng = self.headers.get("Range")
                if rng and honor_range:
                    start = int(rng.split("=")[1].split("-")[0])
                body = outer.PAYLOAD[start:]
                self.send_response(206 if start else 200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if outer.drops > 0:
                    outer.drops -= 1
                    self.wfile.write(body[:len(body) // 2])
                    self.wfile.flush()
                    self.connection.shutdown(2)
                    return
                self.wfile.write(body)

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d/model.ckpt" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


@pytest.fixture
def no_sleep(monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)


@pytest.mark.parametrize("honor_range", [True, False])
def test_download_resumes_after_dropped_connection(tmp_path, no_sleep, honor_range):
    srv = FlakyServer(drops=2, honor_range=honor_range)
    try:
        out = tmp_path / "model.ckpt"
        separate.robust_download(srv.url, out)
        assert out.read_bytes() == FlakyServer.PAYLOAD
        assert not (tmp_path / "model.ckpt.part").exists()
        assert len(srv.requests) == 3
        if honor_range:
            assert srv.requests[0] is None and srv.requests[1].startswith("bytes=")
    finally:
        srv.close()


def test_download_gives_up_and_leaves_no_final_file(tmp_path, no_sleep):
    srv = FlakyServer(drops=99)
    try:
        out = tmp_path / "model.ckpt"
        with pytest.raises(RuntimeError, match="failed after 3 attempts"):
            separate.robust_download(srv.url, out, attempts=3)
        assert not out.exists()  # a truncated model must never sit under the real name
    finally:
        srv.close()


def test_verify_replaces_truncated_existing_file(tmp_path, no_sleep):
    srv = FlakyServer(drops=0)
    try:
        out = tmp_path / "model.ckpt"
        out.write_bytes(FlakyServer.PAYLOAD[:1000])  # what the old installer left behind
        separate.robust_download(srv.url, out)       # split path: trusts existing files
        assert out.stat().st_size == 1000
        separate.robust_download(srv.url, out, verify_existing=True)
        assert out.read_bytes() == FlakyServer.PAYLOAD
    finally:
        srv.close()


def test_make_separator_routes_downloads_through_robust_download(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(separate, "robust_download", lambda url, path, verify, log: calls.append((url, path, verify)))
    sep = separate.make_separator(verify_existing=True, model_file_dir=str(tmp_path), output_dir=str(tmp_path), info_only=True)
    sep.download_file_if_not_exists("http://x/a.ckpt", str(tmp_path / "a.ckpt"))
    assert calls == [("http://x/a.ckpt", str(tmp_path / "a.ckpt"), True)]
