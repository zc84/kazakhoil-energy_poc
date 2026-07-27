from __future__ import annotations

import hashlib
import re
from pathlib import Path

from fastapi import UploadFile

from ..config import get_settings


def _safe_filename(filename: str | None) -> str:
    original = (filename or "upload").strip()
    # убираем path-компоненты и потенциально опасные символы
    base = Path(original).name
    cleaned = re.sub(r"[^\w.\-()\s]+", "_", base, flags=re.UNICODE).strip()
    return cleaned or "upload"


def save_upload(file: UploadFile) -> tuple[bytes, str, Path]:
    settings = get_settings()
    payload = file.file.read()
    checksum = hashlib.sha256(payload).hexdigest()
    target_dir = settings.storage_root / "raw-imports"
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(file.filename)
    target_path = target_dir / f"{checksum}_{safe_name}"
    target_path.write_bytes(payload)
    return payload, checksum, target_path
