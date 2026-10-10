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


def test_plugin_endpoints(client):
    meta = _upload(client, "Groove.wav", _wav_bytes(6, bpm=120))
    tid = meta["id"]
    assert "grid_offset_sec" in meta["analysis"]
    assert client.post(f"/api/tracks/{tid}/render", json={}).status_code == 409  # not separated yet
    client.post(f"/api/tracks/{tid}/separate")
    done = _wait_done(client, tid)
    ok_ids = {s["id"] for s in done["stems"] if s["status"] == "ok"}

    # Original tempo: paths point at the separated stems.
    r = client.post(f"/api/tracks/{tid}/render", json={"bpm": None}).json()
    assert not r["stretched"] and {s["id"] for s in r["stems"]} == ok_ids
    for s in r["stems"]:
        assert sf.info(s["path"]).frames == 6 * SR

    # Host tempo 132 -> every stem stretched, filename carries the new BPM.
    r = client.post(f"/api/tracks/{tid}/render", json={"bpm": 132}).json()
    orig = done["analysis"]["bpm"]
    assert r["stretched"] and r["bpm"] == 132 and abs(r["ratio"] - 132 / orig) < 1e-4
    for s in r["stems"]:
        assert "_132BPM_" in s["file_name"]
        frames = sf.info(s["path"]).frames
        assert abs(frames - 6 * SR / r["ratio"]) < 0.02 * SR, (s["id"], frames)

    assert client.post(f"/api/tracks/{tid}/render", json={"bpm": 400}).status_code == 400

    p = client.get(f"/api/tracks/{tid}/peaks?buckets=400").json()
    assert p["buckets"] == 400 and len(p["mix"]) == 800 and set(p["stems"]) == ok_ids
    assert max(p["mix"]) <= 1000 and max(p["mix"]) > 100

    path = client.get(f"/api/tracks/{tid}/stems/vocals/path").json()["path"]
    assert path.endswith(".wav")
    rc = client.post(f"/api/tracks/{tid}/recombine?as_path=true",
                     json={"levels": {i: 1.0 for i in ok_ids}}).json()
    assert rc["file_name"].startswith("Groove_Recombined_") and sf.info(rc["path"]).frames == 6 * SR
