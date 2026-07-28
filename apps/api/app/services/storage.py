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


def read_upload_payload(file: UploadFile) -> bytes:
    return file.file.read()


def checksum_payload(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def save_payload(payload: bytes, filename: str | None, checksum: str | None = None) -> Path:
    settings = get_settings()
    effective_checksum = checksum or checksum_payload(payload)
    target_dir = settings.storage_root / "raw-imports"
    target_dir.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_filename(filename)
    target_path = target_dir / f"{effective_checksum}_{safe_name}"
    target_path.write_bytes(payload)
    return target_path


def save_upload(file: UploadFile) -> tuple[bytes, str, Path]:
    payload = read_upload_payload(file)
    checksum = checksum_payload(payload)
    target_path = save_payload(payload, file.filename, checksum=checksum)
    return payload, checksum, target_path
