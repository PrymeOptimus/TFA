"""Runtime configuration, all overridable via environment variables."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    # Shared by the web app and the DAW plug-in.
    data_dir: Path = field(default_factory=lambda: Path(
        _env("STEMFORGE_DATA_DIR", str(Path.home() / ".stemforge" / "data"))).expanduser().resolve())
    # auto | demucs | dsp
    engine: str = field(default_factory=lambda: _env("STEMFORGE_ENGINE", "auto"))
    demucs_model: str = field(default_factory=lambda: _env("STEMFORGE_DEMUCS_MODEL", "htdemucs_6s"))
    # Optional local directory holding Demucs weights (offline installs).
    demucs_repo: str = field(default_factory=lambda: _env("STEMFORGE_DEMUCS_REPO", ""))
    device: str = field(default_factory=lambda: _env("STEMFORGE_DEVICE", "auto"))
    history_limit: int = field(default_factory=lambda: int(_env("STEMFORGE_HISTORY_LIMIT", "10")))
    max_upload_mb: int = field(default_factory=lambda: int(_env("STEMFORGE_MAX_UPLOAD_MB", "200")))
    sample_rate: int = 44100
    # WAV subtype for stem exports: PCM_24 (default), PCM_16 or FLOAT.
    wav_subtype: str = field(default_factory=lambda: _env("STEMFORGE_WAV_SUBTYPE", "PCM_24"))
    # Remix hand-off (Replace / Extend / Cover). Unset = feature reports "not configured".
    remix_webhook: str = field(default_factory=lambda: _env("STEMFORGE_REMIX_WEBHOOK", ""))
    remix_token: str = field(default_factory=lambda: _env("STEMFORGE_REMIX_TOKEN", ""))


ALLOWED_EXTENSIONS = {".wav", ".mp3", ".m4a", ".flac"}


def get_settings() -> Settings:
    return Settings()
