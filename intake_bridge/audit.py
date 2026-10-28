"""Append-only, hash-chained audit log (HIPAA §164.312(b) audit controls).

Entries never contain PHI: only record IDs, actions, actor (OS user), and outcomes.
Tampering with or deleting a line breaks the chain, which `verify()` detects."""
from __future__ import annotations

import getpass
import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

_lock = threading.Lock()
GENESIS = "0" * 64


def _hash(entry: dict) -> str:
    body = json.dumps({k: v for k, v in entry.items() if k != "hash"}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()


def _last_hash(path: Path) -> str:
    if not path.exists() or path.stat().st_size == 0:
        return GENESIS
    with path.open("rb") as f:
        f.seek(0, 2)
        size = f.tell()
        f.seek(max(0, size - 4096))
        last = f.read().splitlines()[-1]
    return json.loads(last)["hash"]


class AuditLog:
    def __init__(self, path: Path):
        self.path = path

    def write(self, action: str, record_id: str | None = None, outcome: str = "ok", detail: str = "") -> None:
        with _lock:
            entry = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "actor": getpass.getuser(),
                "action": action,
                "record_id": record_id,
                "outcome": outcome,
                "detail": detail[:500],
                "prev": _last_hash(self.path),
            }
            entry["hash"] = _hash(entry)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, sort_keys=True) + "\n")

    def verify(self) -> tuple[bool, int, str]:
        """Return (ok, entries_checked, message)."""
        if not self.path.exists():
            return True, 0, "no audit log yet"
        prev = GENESIS
        n = 0
        for n, line in enumerate(self.path.read_text(encoding="utf-8").splitlines(), 1):
            entry = json.loads(line)
            if entry.get("prev") != prev:
                return False, n, f"chain broken at line {n}"
            if _hash(entry) != entry.get("hash"):
                return False, n, f"entry modified at line {n}"
            prev = entry["hash"]
        return True, n, "audit chain intact"
