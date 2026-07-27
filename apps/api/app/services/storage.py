from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi import UploadFile

from ..config import get_settings


def save_upload(file: UploadFile) -> tuple[bytes, str, Path]:
    settings = get_settings()
    payload = file.file.read()
    checksum = hashlib.sha256(payload).hexdigest()
    target_dir = settings.storage_root / "raw-imports"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / f"{checksum}_{file.filename}"
    target_path.write_bytes(payload)
    return payload, checksum, target_path
