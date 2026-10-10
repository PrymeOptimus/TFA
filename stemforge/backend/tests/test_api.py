import io
import time
import zipfile

import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from stemforge.app import create_app
from stemforge.config import Settings

from .synth import SR, make_track


def _wav_bytes(seconds=6, bpm=120):
    buf = io.BytesIO()
    sf.write(buf, make_track(seconds, bpm=bpm).T, SR, format="WAV", subtype="PCM_16")
    return buf.getvalue()


@pytest.fixture
def client(tmp_path):
    app = create_app(Settings(data_dir=tmp_path, engine="dsp", history_limit=2))
    with TestClient(app) as c:
        yield c


def _upload(client, name="My Track.wav", data=None):
    r = client.post("/api/tracks", files={"file": (name, data or _wav_bytes(), "audio/wav")})
    assert r.status_code == 200, r.text
    return r.json()


def _wait_done(client, tid, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        meta = client.get(f"/api/tracks/{tid}").json()
        if meta["status"] in ("done", "error"):
            return meta
        time.sleep(0.3)
    raise AssertionError("separation timed out")


def test_full_flow(client):
    meta = _upload(client)
    assert meta["title"] == "My Track"
    assert 115 <= meta["analysis"]["bpm"] <= 125
    assert client.get(f"/api/tracks/{meta['id']}/mix").status_code == 200

    client.post(f"/api/tracks/{meta['id']}/separate")
    done = _wait_done(client, meta["id"])
    assert done["status"] == "done", done.get("error")
    assert done["engine"] == "dsp-fallback"
    stems = {s["id"]: s for s in done["stems"]}
    assert stems["vocals"]["download_name"].startswith("My_Track_Vocals_")

    r = client.get(f"/api/tracks/{meta['id']}/stems/vocals?download=true")
    assert r.status_code == 200
    assert stems["vocals"]["download_name"] in r.headers["content-disposition"]

    nd = next(s for s in done["stems"] if s["status"] == "not_detected")
    assert client.get(f"/api/tracks/{meta['id']}/stems/{nd['id']}").status_code == 404

    z = client.get(f"/api/tracks/{meta['id']}/zip")
    names = zipfile.ZipFile(io.BytesIO(z.content)).namelist()
    assert sorted(names) == sorted(s["download_name"] for s in done["stems"] if s["status"] == "ok")

    levels = {s["id"]: 1.0 for s in done["stems"] if s["parent"] is None}
    r = client.post(f"/api/tracks/{meta['id']}/recombine", json={"levels": levels})
    assert r.status_code == 200 and "_Recombined_" in r.headers["content-disposition"]
    bounced, _ = sf.read(io.BytesIO(r.content))
    assert bounced.shape[0] == 6 * SR
    assert client.post(f"/api/tracks/{meta['id']}/recombine", json={"levels": {}}).status_code == 400

    r = client.post(f"/api/tracks/{meta['id']}/stems/vocals/send", json={"target": "cover"})
    assert r.status_code == 501
    assert client.post(f"/api/tracks/{meta['id']}/stems/vocals/send",
                       json={"target": "nope"}).status_code == 400


def test_rejects_bad_type(client):
    r = client.post("/api/tracks", files={"file": ("x.ogg", b"abc", "audio/ogg")})
    assert r.status_code == 415


def test_rejects_undecodable(client):
    r = client.post("/api/tracks", files={"file": ("x.mp3", b"not audio", "audio/mpeg")})
    assert r.status_code == 422


def test_mp3_and_flac_upload(client, tmp_path):
    import subprocess
    wav = tmp_path / "in.wav"
    wav.write_bytes(_wav_bytes(3))
    for ext in ("mp3", "flac", "m4a"):
        out = tmp_path / f"in.{ext}"
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(wav), str(out)], check=True)
        meta = _upload(client, f"song.{ext}", out.read_bytes())
        assert abs(meta["analysis"]["duration_sec"] - 3.0) < 0.1


def test_history_limit(client):
    ids = [_upload(client, f"t{i}.wav", _wav_bytes(2))["id"] for i in range(3)]
    hist = [h["id"] for h in client.get("/api/history").json()]
    assert hist == [ids[2], ids[1]]
    assert client.get(f"/api/tracks/{ids[0]}").status_code == 404
