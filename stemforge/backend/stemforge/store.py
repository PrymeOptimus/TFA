"""On-disk track store + rolling session history (last N tracks)."""
from __future__ import annotations

import json
import shutil
import threading
import time
import uuid
from pathlib import Path

_lock = threading.RLock()


class TrackStore:
    def __init__(self, root: Path, history_limit: int = 10):
        self.root = root / "tracks"
        self.root.mkdir(parents=True, exist_ok=True)
        self.history_limit = history_limit

    def new_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def dir(self, track_id: str) -> Path:
        if not track_id.isalnum():
            raise KeyError(track_id)
        return self.root / track_id

    def stems_dir(self, track_id: str) -> Path:
        return self.dir(track_id) / "stems"

    def load(self, track_id: str) -> dict:
        path = self.dir(track_id) / "meta.json"
        if not path.exists():
            raise KeyError(track_id)
        with _lock:
            return json.loads(path.read_text())

    def save(self, meta: dict) -> None:
        d = self.dir(meta["id"])
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "meta.json.tmp"
        with _lock:
            tmp.write_text(json.dumps(meta, indent=2))
            tmp.replace(d / "meta.json")

    def update(self, track_id: str, **fields) -> dict:
        with _lock:
            meta = self.load(track_id)
            meta.update(fields)
            meta["updated_at"] = time.time()
            self.save(meta)
            return meta

    def history(self) -> list[dict]:
        items = []
        for d in self.root.iterdir():
            meta_path = d / "meta.json"
            if d.is_dir() and meta_path.exists():
                try:
                    items.append(json.loads(meta_path.read_text()))
                except json.JSONDecodeError:
                    continue
        items.sort(key=lambda m: m.get("created_at", 0), reverse=True)
        return items

    def prune(self, keep: set[str] | None = None) -> list[str]:
        """Delete everything beyond the history limit (oldest first)."""
        keep = keep or set()
        removed = []
        with _lock:
            for meta in self.history()[self.history_limit:]:
                if meta["id"] in keep or meta.get("status") == "processing":
                    continue
                shutil.rmtree(self.dir(meta["id"]), ignore_errors=True)
                removed.append(meta["id"])
        return removed

    def delete(self, track_id: str) -> None:
        shutil.rmtree(self.dir(track_id), ignore_errors=True)
