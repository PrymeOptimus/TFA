"""StemForge HTTP API + static frontend."""
from __future__ import annotations

import logging
import shutil
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import analysis, pipeline, stretch
from .audio_io import DecodeError, probe_title, read_wav, transcode_to_wav
from .config import ALLOWED_EXTENSIONS, Settings, get_settings
from .separation import Separator, build_separator
from .stems import STEMS
from .store import TrackStore

log = logging.getLogger("stemforge")

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
REMIX_TARGETS = {"replace", "extend", "cover"}


class SendRequest(BaseModel):
    target: str


class RenderRequest(BaseModel):
    # Target tempo. None / missing = original tempo (no stretching).
    bpm: float | None = None


class RecombineRequest(BaseModel):
    # stem id -> linear gain (0 = muted). Stems not listed are treated as muted.
    levels: dict[str, float]


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    store = TrackStore(settings.data_dir, settings.history_limit)
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="separator")
    sep_lock = threading.Lock()
    sep_cache: dict[str, tuple[Separator, str | None]] = {}

    def get_separator() -> tuple[Separator, str | None]:
        with sep_lock:
            if "sep" not in sep_cache:
                sep_cache["sep"] = build_separator(settings)
            return sep_cache["sep"]

    app = FastAPI(title="StemForge", version="1.0.0")
    app.state.store = store
    app.state.settings = settings

    # Any job left "processing" by a previous crash can never finish.
    for meta in store.history():
        if meta.get("status") in ("processing", "queued"):
            store.update(meta["id"], status="error", error="Interrupted (server restarted)")

    @app.get("/api/health")
    def health():
        return {"ok": True, "engine_setting": settings.engine, "demucs_model": settings.demucs_model,
                "remix_configured": bool(settings.remix_webhook), "history_limit": settings.history_limit,
                "stems": [{"id": s.id, "label": s.label, "parent": s.parent} for s in STEMS]}

    @app.post("/api/tracks")
    async def upload(file: UploadFile = File(...)):
        name = Path(file.filename or "track").name
        ext = Path(name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(415, f"Unsupported file type '{ext}'. Use WAV, MP3, M4A or FLAC.")
        track_id = store.new_id()
        d = store.dir(track_id)
        d.mkdir(parents=True)
        src = d / f"source{ext}"
        limit = settings.max_upload_mb * 1024 * 1024
        size = 0
        try:
            with src.open("wb") as fh:
                while chunk := await file.read(1 << 20):
                    size += len(chunk)
                    if size > limit:
                        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB limit")
                    fh.write(chunk)
            decoded = d / "decoded.wav"
            transcode_to_wav(src, decoded, settings.sample_rate)
            audio, sr = read_wav(decoded)
            if audio.shape[-1] < sr:  # under one second
                raise HTTPException(422, "Audio is shorter than 1 second")
            info = analysis.analyze(audio, sr)
        except DecodeError as exc:
            shutil.rmtree(d, ignore_errors=True)
            raise HTTPException(422, str(exc))
        except HTTPException:
            shutil.rmtree(d, ignore_errors=True)
            raise

        title = probe_title(src) or Path(name).stem
        now = time.time()
        meta = {
            "id": track_id, "title": title, "original_filename": name, "created_at": now,
            "updated_at": now, "status": "uploaded", "progress": 0.0, "stage": "Analysed",
            "error": None, "analysis": info, "engine": None, "engine_note": None, "stems": [],
            "size_bytes": size,
        }
        store.save(meta)
        store.prune(keep={track_id})
        return meta

    def _job(track_id: str):
        try:
            meta = store.load(track_id)
            store.update(track_id, status="processing", progress=0.02, stage="Loading separation engine")
            separator, note = get_separator()
            store.update(track_id, engine=separator.name, engine_note=note)
            audio, sr = read_wav(store.dir(track_id) / "decoded.wav")
            a = meta["analysis"]

            def progress(p: float, stage: str):
                store.update(track_id, progress=round(p, 3), stage=stage)

            stems_dir = store.stems_dir(track_id)
            shutil.rmtree(stems_dir, ignore_errors=True)
            (store.dir(track_id) / "stems.zip").unlink(missing_ok=True)
            (store.dir(track_id) / "peaks.json").unlink(missing_ok=True)
            shutil.rmtree(store.dir(track_id) / "rendered", ignore_errors=True)
            results = pipeline.run(audio, sr, separator, stems_dir, meta["title"], a.get("bpm"),
                                   a.get("key_short"), settings, progress)
            store.update(track_id, status="done", progress=1.0, stage="Done", stems=results,
                         completed_at=time.time())
        except Exception as exc:  # surfaced to the UI
            log.exception("Separation failed for %s", track_id)
            store.update(track_id, status="error", error=f"{type(exc).__name__}: {exc}")

    @app.post("/api/tracks/{track_id}/separate")
    def separate(track_id: str):
        meta = _load(store, track_id)
        if meta["status"] in ("processing", "queued"):
            return meta
        meta = store.update(track_id, status="queued", progress=0.0, stage="Queued", error=None, stems=[])
        executor.submit(_job, track_id)
        return meta

    @app.get("/api/tracks/{track_id}")
    def get_track(track_id: str):
        return _load(store, track_id)

    @app.delete("/api/tracks/{track_id}")
    def delete_track(track_id: str):
        meta = _load(store, track_id)
        if meta["status"] in ("processing", "queued"):
            raise HTTPException(409, "Track is still processing")
        store.delete(track_id)
        return {"deleted": track_id}

    @app.get("/api/tracks/{track_id}/mix")
    def get_mix(track_id: str):
        _load(store, track_id)
        return FileResponse(store.dir(track_id) / "decoded.wav", media_type="audio/wav")

    @app.get("/api/tracks/{track_id}/stems/{stem_id}")
    def get_stem(track_id: str, stem_id: str, download: bool = False):
        meta = _load(store, track_id)
        entry = _stem_entry(meta, stem_id)
        path = store.stems_dir(track_id) / entry["download_name"]
        if not path.exists():
            raise HTTPException(404, "Stem file missing")
        if download:
            return FileResponse(path, media_type="audio/wav", filename=entry["download_name"])
        return FileResponse(path, media_type="audio/wav")

    @app.get("/api/tracks/{track_id}/zip")
    def get_zip(track_id: str):
        meta = _load(store, track_id)
        if meta["status"] != "done":
            raise HTTPException(409, "Separation not finished")
        zpath = store.dir(track_id) / "stems.zip"
        if not zpath.exists():
            tmp = zpath.with_suffix(".tmp")
            with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_STORED) as zf:
                for e in meta["stems"]:
                    if e["status"] == "ok":
                        zf.write(store.stems_dir(track_id) / e["download_name"], e["download_name"])
            tmp.replace(zpath)
        from .audio_io import safe_token
        return FileResponse(zpath, media_type="application/zip",
                            filename=f"{safe_token(meta['title'])}_StemForge_Stems.zip")

    @app.post("/api/tracks/{track_id}/stems/{stem_id}/send")
    def send_stem(track_id: str, stem_id: str, req: SendRequest):
        target = req.target.lower()
        if target not in REMIX_TARGETS:
            raise HTTPException(400, f"target must be one of {sorted(REMIX_TARGETS)}")
        meta = _load(store, track_id)
        entry = _stem_entry(meta, stem_id)
        if not settings.remix_webhook:
            return JSONResponse(status_code=501, content={
                "detail": "No remix integration configured. Set STEMFORGE_REMIX_WEBHOOK to the endpoint "
                          "that accepts stems for Replace / Extend / Cover.",
                "download_url": f"/api/tracks/{track_id}/stems/{stem_id}?download=true",
            })
        path = store.stems_dir(track_id) / entry["download_name"]
        a = meta["analysis"]
        headers = {"Authorization": f"Bearer {settings.remix_token}"} if settings.remix_token else {}
        try:
            with path.open("rb") as fh:
                r = httpx.post(settings.remix_webhook, headers=headers, timeout=60, data={
                    "action": target, "stem": stem_id, "title": meta["title"],
                    "bpm": str(a.get("bpm") or ""), "key": a.get("key") or "",
                }, files={"file": (entry["download_name"], fh, "audio/wav")})
        except httpx.HTTPError as exc:
            raise HTTPException(502, f"Remix endpoint unreachable: {exc}")
        body: object
        try:
            body = r.json()
        except ValueError:
            body = r.text[:500]
        if r.status_code >= 400:
            raise HTTPException(502, f"Remix endpoint returned {r.status_code}: {body}")
        return {"sent": True, "target": target, "stem": stem_id, "response": body}

    @app.post("/api/tracks/{track_id}/recombine")
    def recombine(track_id: str, req: RecombineRequest, as_path: bool = False):
        import numpy as np
        from .audio_io import stem_filename, write_wav
        meta = _load(store, track_id)
        if meta["status"] != "done":
            raise HTTPException(409, "Separation not finished")
        mix = None
        sr = settings.sample_rate
        for e in meta["stems"]:
            gain = float(req.levels.get(e["id"], 0.0))
            if e["status"] != "ok" or gain <= 0:
                continue
            audio, sr = read_wav(store.stems_dir(track_id) / e["download_name"])
            audio *= min(gain, 4.0)
            mix = audio if mix is None else mix + audio
        if mix is None:
            raise HTTPException(400, "Nothing to bounce — every stem is muted")
        peak = float(np.abs(mix).max())
        if peak > 1.0:  # avoid clipping on export
            mix /= peak
        a = meta["analysis"]
        name = stem_filename(meta["title"], "Recombined", a.get("bpm"), a.get("key_short"))
        out = store.dir(track_id) / name
        write_wav(out, mix, sr, settings.wav_subtype)
        if as_path:
            return {"path": str(out), "file_name": name, "peak_normalized": peak > 1.0}
        return FileResponse(out, media_type="audio/wav", filename=name,
                            headers={"X-Peak-Normalized": "1" if peak > 1.0 else "0"})

    @app.post("/api/tracks/{track_id}/render")
    def render(track_id: str, req: RenderRequest):
        """Absolute paths of every written stem, optionally time-stretched to `bpm`.
        Used by the DAW plugin (local playback, drag-out at host tempo)."""
        meta = _load(store, track_id)
        if meta["status"] != "done":
            raise HTTPException(409, "Separation not finished")
        try:
            return stretch.render(store, meta, req.bpm, settings)
        except stretch.StretchError as exc:
            raise HTTPException(400, str(exc))

    @app.get("/api/tracks/{track_id}/stems/{stem_id}/path")
    def stem_path(track_id: str, stem_id: str):
        meta = _load(store, track_id)
        entry = _stem_entry(meta, stem_id)
        return {"path": str(store.stems_dir(track_id) / entry["download_name"]),
                "file_name": entry["download_name"]}

    @app.get("/api/tracks/{track_id}/peaks")
    def peaks(track_id: str, buckets: int = 1600):
        # Before separation finishes this returns the mix only (and is not cached).
        meta = _load(store, track_id)
        return stretch.peaks(store, meta, max(200, min(buckets, 4000)))

    @app.get("/api/history")
    def history():
        out = []
        for m in store.history()[: settings.history_limit]:
            a = m.get("analysis") or {}
            out.append({k: m.get(k) for k in ("id", "title", "status", "created_at", "original_filename")}
                       | {"bpm": a.get("bpm"), "key": a.get("key"), "duration_sec": a.get("duration_sec")})
        return out

    if FRONTEND_DIR.exists():
        app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
    return app


def _load(store: TrackStore, track_id: str) -> dict:
    try:
        return store.load(track_id)
    except KeyError:
        raise HTTPException(404, "Track not found")


def _stem_entry(meta: dict, stem_id: str) -> dict:
    for e in meta.get("stems", []):
        if e["id"] == stem_id:
            if e["status"] != "ok":
                raise HTTPException(404, f"Stem '{stem_id}' was not detected in this track")
            return e
    raise HTTPException(404, "Stem not found")
