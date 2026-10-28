"""Core operations shared by the web UI and the CLI. Every PHI-touching action is audited."""
from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Callable

from . import jane_bot, pdf_extract
from .audit import AuditLog
from .config import Settings, load_json_config, load_settings
from .vault import Record, Vault, secure_delete

log = logging.getLogger("intake_bridge")
MAX_PDF_BYTES = 25 * 1024 * 1024


class IntakeService:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or load_settings()
        self.vault = Vault(self.settings.vault_dir, self.settings.salt_path)
        self.audit = AuditLog(self.settings.audit_path)
        self.field_map = load_json_config("field_map.json")
        self._push_lock = threading.Lock()

    # ---- vault ----------------------------------------------------------
    def unlock(self, passphrase: str) -> None:
        try:
            self.vault.unlock(passphrase)
        except Exception:
            self.audit.write("vault.unlock", outcome="denied")
            raise
        self.audit.write("vault.unlock")
        purged = self.vault.purge(self.settings.retention_hours_after_push, self.settings.max_retention_days)
        for rid in purged:
            self.audit.write("record.purge", rid, detail="retention policy")

    def lock(self, reason: str = "manual") -> None:
        if self.vault.unlocked:
            self.vault.lock()
            self.audit.write("vault.lock", detail=reason)

    # ---- records --------------------------------------------------------
    def ingest(self, pdf: bytes, source_name: str) -> Record:
        if len(pdf) > MAX_PDF_BYTES:
            raise ValueError("PDF too large")
        if not pdf.startswith(b"%PDF"):
            raise ValueError("file is not a PDF")
        fields, warnings = pdf_extract.extract(pdf, self.field_map)
        rec = self.vault.create(fields, pdf, Path(source_name).name, warnings)
        filled = sum(1 for v in fields.values() if v)
        self.audit.write("record.ingest", rec.id, detail=f"{filled} fields extracted, {len(warnings)} warnings")
        return rec

    def ingest_file(self, path: Path, delete_source: bool = False) -> Record:
        rec = self.ingest(path.read_bytes(), path.name)
        if delete_source:
            secure_delete(path)
            self.audit.write("source.delete", rec.id, detail="source PDF removed from watch folder")
        return rec

    def get(self, rid: str) -> Record:
        rec = self.vault.get(rid)
        self.audit.write("record.view", rid)
        return rec

    def update_fields(self, rid: str, fields: dict) -> Record:
        rec = self.vault.get(rid)
        changed = [k for k in rec.fields if fields.get(k, "") != rec.fields.get(k, "")]
        rec.fields = {k: (fields.get(k, "") or "").strip() for k in rec.fields}
        types = self.field_map.get("types", {})
        rec.fields = pdf_extract.normalize(rec.fields, types)
        rec.warnings = pdf_extract.validate(rec.fields, self.field_map.get("required", []), types)
        rec.status = "reviewed"
        self.vault.save(rec)
        # Field names only, never values.
        self.audit.write("record.edit", rid, detail="changed: " + ",".join(changed) if changed else "no changes")
        return rec

    def delete(self, rid: str) -> None:
        self.vault.delete(rid)
        self.audit.write("record.delete", rid)

    def push(self, rid: str, *, dry_run: bool, on_review: Callable[[str], bool],
             on_status: Callable[[str], None] = lambda s: None) -> jane_bot.RunResult:
        rec = self.vault.get(rid)
        missing = [k for k in self.field_map.get("required", []) if not rec.fields.get(k)]
        if missing:
            raise ValueError("missing required fields: " + ", ".join(missing))
        if not self._push_lock.acquire(blocking=False):
            raise RuntimeError("another push is already running")
        flow = load_json_config("jane_flow.json")
        mode = "dry_run" if dry_run else "live"
        try:
            if not dry_run:
                rec.status = "pushing"
                self.vault.save(rec)
            self.audit.write("jane.push.start", rid, detail=mode)
            result = jane_bot.run_push(self.settings, flow, rec.fields, rec.pdf, rec.source_name,
                                       dry_run=dry_run, on_review=on_review, on_status=on_status)
        except Exception as e:
            rec.status = "failed" if not dry_run else rec.status
            rec.last_error = str(e)[:300]
            self.vault.save(rec)
            self.audit.write("jane.push.end", rid, outcome="error", detail=f"{mode}: {type(e).__name__}: {rec.last_error}")
            raise
        finally:
            self._push_lock.release()
        detail = f"{mode}: {result.steps_run} steps, {result.steps_skipped} skipped, {result.commits_skipped} commits skipped"
        self.audit.write("jane.push.end", rid, detail=detail)
        if not dry_run:
            rec.status = "pushed"
            rec.pushed_at = time.time()
            rec.last_error = ""
            self.vault.save(rec)
            if self.settings.retention_hours_after_push == 0:
                self.delete(rid)
        return result

    # ---- watch folder ---------------------------------------------------
    def watch_once(self, folder: Path) -> list[str]:
        """Ingest every finished PDF in `folder` (where ALOHA exports download), then wipe the source.
        Files that fail to parse are renamed *.rejected and left for staff to handle."""
        folder.mkdir(parents=True, exist_ok=True)
        ids = []
        for p in folder.glob("*.pdf"):
            size = p.stat().st_size
            time.sleep(1)
            if not p.exists() or p.stat().st_size != size:
                continue  # still downloading
            try:
                ids.append(self.ingest_file(p, delete_source=True).id)
            except Exception as e:
                self.audit.write("record.ingest", outcome="error", detail=type(e).__name__)
                p.rename(p.with_suffix(".rejected"))
        return ids
