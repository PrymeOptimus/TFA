"""Settings loader. All paths resolve to the local machine; nothing is sent off-box
except the browser session the staff member drives into Jane App."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONFIG_DIR = Path(os.environ.get("INTAKE_BRIDGE_CONFIG", REPO_ROOT / "config"))


def _default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(Path.home(), ".local", "share")
    return Path(base) / "IntakeBridge"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=_default_data_dir)
    jane_base_url: str = "https://YOURCLINIC.janeapp.com"
    # Seconds of inactivity before the web UI locks and drops the vault key from memory.
    idle_lock_seconds: int = 900
    # Delete the encrypted record (and source PDF) this many hours after a successful push.
    # 0 = delete immediately after success.
    retention_hours_after_push: int = 0
    # Records that never get pushed are purged after this many days.
    max_retention_days: int = 7
    # Upload the original Aloha PDF to the patient's Files in Jane.
    upload_source_pdf: bool = True
    # Require a human to click "Approve" in the browser step before any commit step.
    require_review_before_commit: bool = True
    headless: bool = False
    chromium_executable: str | None = None
    watch_folder: Path | None = None
    host: str = "127.0.0.1"
    port: int = 8765

    @property
    def vault_dir(self) -> Path:
        return self.data_dir / "vault"

    @property
    def audit_path(self) -> Path:
        return self.data_dir / "audit.jsonl"

    @property
    def browser_profile_dir(self) -> Path:
        return self.data_dir / "jane-browser-profile"

    @property
    def salt_path(self) -> Path:
        return self.data_dir / "vault.salt"


def load_settings(path: Path | None = None) -> Settings:
    path = path or CONFIG_DIR / "settings.json"
    s = Settings()
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
        for k, v in raw.items():
            if k.startswith("_") or not hasattr(s, k):
                continue
            if k in ("data_dir", "watch_folder") and v:
                v = Path(os.path.expandvars(os.path.expanduser(v)))
            setattr(s, k, v)
    if s.host not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError("host must be a loopback address; this app must not be exposed on the network")
    s.data_dir.mkdir(parents=True, exist_ok=True)
    s.vault_dir.mkdir(parents=True, exist_ok=True)
    try:
        os.chmod(s.data_dir, 0o700)
    except OSError:
        pass
    return s


def load_json_config(name: str) -> dict:
    return json.loads((CONFIG_DIR / name).read_text(encoding="utf-8"))
