"""Encrypted-at-rest staging store (HIPAA §164.312(a)(2)(iv) encryption).

Each intake record (extracted fields + original PDF bytes) is stored as one
Fernet (AES-128-CBC + HMAC-SHA256) blob. The key is derived from a staff
passphrase with scrypt and only ever lives in memory."""
from __future__ import annotations

import base64
import json
import os
import secrets
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

CANARY = b"intake-bridge-vault-v1"


class VaultLocked(Exception):
    pass


class BadPassphrase(Exception):
    pass


def derive_key(passphrase: str, salt: bytes) -> bytes:
    kdf = Scrypt(salt=salt, length=32, n=2**15, r=8, p=1)
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))


def secure_delete(path: Path) -> None:
    """Best-effort overwrite before unlink. On SSDs overwrite is not guaranteed,
    which is why full-disk encryption (BitLocker/FileVault) is a deployment requirement."""
    if not path.exists():
        return
    try:
        size = path.stat().st_size
        with path.open("r+b") as f:
            f.write(secrets.token_bytes(size))
            f.flush()
            os.fsync(f.fileno())
    finally:
        path.unlink(missing_ok=True)


@dataclass
class Record:
    id: str
    created: float
    status: str  # extracted | reviewed | pushing | pushed | failed
    fields: dict
    source_name: str
    pdf: bytes = b""
    warnings: list = field(default_factory=list)
    pushed_at: float | None = None
    last_error: str = ""

    def to_bytes(self) -> bytes:
        d = self.__dict__.copy()
        d["pdf"] = base64.b64encode(self.pdf).decode()
        return json.dumps(d).encode()

    @classmethod
    def from_bytes(cls, b: bytes) -> "Record":
        d = json.loads(b)
        d["pdf"] = base64.b64decode(d["pdf"])
        return cls(**d)


class Vault:
    def __init__(self, vault_dir: Path, salt_path: Path):
        self.dir = vault_dir
        self.salt_path = salt_path
        self._fernet: Fernet | None = None

    # ---- key management -------------------------------------------------
    @property
    def initialized(self) -> bool:
        return self.salt_path.exists() and (self.dir / ".canary").exists()

    def initialize(self, passphrase: str) -> None:
        if self.initialized:
            raise RuntimeError("vault already initialized")
        if len(passphrase) < 12:
            raise ValueError("passphrase must be at least 12 characters")
        salt = secrets.token_bytes(16)
        self.salt_path.write_bytes(salt)
        self._fernet = Fernet(derive_key(passphrase, salt))
        (self.dir / ".canary").write_bytes(self._fernet.encrypt(CANARY))

    def unlock(self, passphrase: str) -> None:
        f = Fernet(derive_key(passphrase, self.salt_path.read_bytes()))
        try:
            if f.decrypt((self.dir / ".canary").read_bytes()) != CANARY:
                raise BadPassphrase()
        except InvalidToken as e:
            raise BadPassphrase() from e
        self._fernet = f

    def lock(self) -> None:
        self._fernet = None

    @property
    def unlocked(self) -> bool:
        return self._fernet is not None

    def _f(self) -> Fernet:
        if not self._fernet:
            raise VaultLocked()
        return self._fernet

    # ---- records --------------------------------------------------------
    def _path(self, rid: str) -> Path:
        if not rid.replace("-", "").isalnum():
            raise ValueError("bad record id")
        return self.dir / f"{rid}.bin"

    def create(self, fields: dict, pdf: bytes, source_name: str, warnings: list) -> Record:
        rec = Record(id=uuid.uuid4().hex[:12], created=time.time(), status="extracted",
                     fields=fields, source_name=source_name, pdf=pdf, warnings=warnings)
        self.save(rec)
        return rec

    def save(self, rec: Record) -> None:
        tmp = self._path(rec.id).with_suffix(".tmp")
        tmp.write_bytes(self._f().encrypt(rec.to_bytes()))
        os.replace(tmp, self._path(rec.id))

    def get(self, rid: str) -> Record:
        return Record.from_bytes(self._f().decrypt(self._path(rid).read_bytes()))

    def list(self) -> list[Record]:
        out = []
        for p in sorted(self.dir.glob("*.bin")):
            try:
                out.append(self.get(p.stem))
            except InvalidToken:
                continue
        return sorted(out, key=lambda r: r.created, reverse=True)

    def delete(self, rid: str) -> None:
        secure_delete(self._path(rid))

    def purge(self, retention_hours_after_push: int, max_retention_days: int) -> list[str]:
        now = time.time()
        purged = []
        for rec in self.list():
            pushed_expired = rec.status == "pushed" and rec.pushed_at and \
                now - rec.pushed_at >= retention_hours_after_push * 3600
            stale = now - rec.created >= max_retention_days * 86400
            if pushed_expired or stale:
                self.delete(rec.id)
                purged.append(rec.id)
        return purged
