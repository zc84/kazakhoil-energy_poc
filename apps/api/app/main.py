from datetime import datetime, timezone
import shutil

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from .config import get_settings
from .db import Base, engine, get_db
from .models import (
    DatasetKind,
    ImportBatch,
    ImportFile,
    ImportStatus,
    StagingRow,
    ValidationIssue,
    ValidationSeverity,
)
from .schemas import (
    DashboardRead,
    EnergyBusinessDashboardRead,
    ImportBatchRead,
    ImportPreviewRead,
    ImportResultRead,
    ValidationIssueRead,
)
from .services.dashboard import (
    build_energy_business_dashboard,
    build_import_backed_dashboard,
    build_import_result,
)
from .services.ingestion import parse_file
from .services.storage import save_upload

settings = get_settings()
cors_origins = [origin.strip() for origin in settings.cors_allow_origins.split(",") if origin.strip()]

app = FastAPI(title="EnergoPulse API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_origin_regex=r"https://.*\.onrender\.com",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


@app.get("/healthz", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/admin/reset", tags=["admin"])
def reset_all_data(db: Session = Depends(get_db)) -> dict[str, object]:
    deleted_issues = db.execute(delete(ValidationIssue)).rowcount or 0
    deleted_rows = db.execute(delete(StagingRow)).rowcount or 0
    deleted_files = db.execute(delete(ImportFile)).rowcount or 0
    deleted_batches = db.execute(delete(ImportBatch)).rowcount or 0
    db.commit()

    raw_imports_dir = settings.storage_root / "raw-imports"
    removed_raw_files = 0
    if raw_imports_dir.exists():
        for item in raw_imports_dir.iterdir():
            if item.is_file():
                item.unlink(missing_ok=True)
                removed_raw_files += 1
            elif item.is_dir():
                shutil.rmtree(item, ignore_errors=True)

    return {
        "status": "ok",
        "deleted": {
            "batches": deleted_batches,
            "files": deleted_files,
            "staging_rows": deleted_rows,
            "validation_issues": deleted_issues,
            "raw_files": removed_raw_files,
        },
    }


@app.post("/api/v1/imports", response_model=ImportBatchRead, tags=["imports"])
def create_import(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> ImportBatch:
    payload, checksum, storage_path = save_upload(file)
    existing = db.scalar(
        select(ImportBatch)
        .where(ImportBatch.checksum_sha256 == checksum)
        .options(selectinload(ImportBatch.files))
    )
    if existing is not None:
        return existing

    parsed = parse_file(file.filename or "upload", payload)
    batch = ImportBatch(
        original_filename=file.filename or "upload",
        checksum_sha256=checksum,
        status=ImportStatus.validating,
        dataset_kind=parsed.dataset_kind,
        total_sheets=parsed.total_sheets,
        total_rows=len(parsed.rows),
        accepted_rows=len(parsed.rows),
        warning_count=sum(1 for issue in parsed.issues if issue.severity == ValidationSeverity.warning),
        error_count=sum(1 for issue in parsed.issues if issue.severity == ValidationSeverity.error),
    )
    if batch.error_count:
        batch.status = ImportStatus.needs_review
    else:
        batch.status = ImportStatus.ready_to_publish

    db.add(batch)
    db.flush()

    db.add(
        ImportFile(
            batch_id=batch.id,
            storage_key=str(storage_path),
            original_filename=file.filename or "upload",
            content_type=file.content_type,
            file_size_bytes=len(payload),
        )
    )

    db.add_all(
        [
            StagingRow(
                batch_id=batch.id,
                sheet_name=row.sheet_name,
                row_index=row.row_index,
                raw_json=row.raw_json,
            )
            for row in parsed.rows
        ]
    )
    db.add_all(
        [
            ValidationIssue(
                batch_id=batch.id,
                severity=issue.severity,
                rule_code=issue.rule_code,
                message=issue.message,
                sheet_name=issue.sheet_name,
                row_index=issue.row_index,
            )
            for issue in parsed.issues
        ]
    )
    db.commit()
    db.refresh(batch)
    return db.scalar(
        select(ImportBatch)
        .where(ImportBatch.id == batch.id)
        .options(selectinload(ImportBatch.files))
    )


@app.get("/api/v1/imports", response_model=list[ImportBatchRead], tags=["imports"])
def list_imports(db: Session = Depends(get_db)) -> list[ImportBatch]:
    return db.scalars(
        select(ImportBatch)
        .order_by(ImportBatch.created_at.desc())
        .options(selectinload(ImportBatch.files))
    ).all()


@app.get("/api/v1/imports/{batch_id}", response_model=ImportBatchRead, tags=["imports"])
def get_import(batch_id: int, db: Session = Depends(get_db)) -> ImportBatch:
    batch = db.scalar(
        select(ImportBatch)
        .where(ImportBatch.id == batch_id)
        .options(selectinload(ImportBatch.files))
    )
    if batch is None:
        raise HTTPException(status_code=404, detail="Import batch not found")
    return batch


@app.get("/api/v1/imports/{batch_id}/issues", response_model=list[ValidationIssueRead], tags=["imports"])
def get_import_issues(batch_id: int, db: Session = Depends(get_db)) -> list[ValidationIssue]:
    return db.scalars(
        select(ValidationIssue)
        .where(ValidationIssue.batch_id == batch_id)
        .order_by(ValidationIssue.id.asc())
    ).all()


@app.get("/api/v1/imports/{batch_id}/preview", response_model=ImportPreviewRead, tags=["imports"])
def get_import_preview(batch_id: int, db: Session = Depends(get_db)) -> ImportPreviewRead:
    batch = get_import(batch_id, db)
    preview_rows = db.scalars(
        select(StagingRow).where(StagingRow.batch_id == batch_id).order_by(StagingRow.id.asc()).limit(25)
    ).all()
    issues = get_import_issues(batch_id, db)
    return ImportPreviewRead(batch=batch, preview_rows=preview_rows, issues=issues)


@app.get("/api/v1/imports/{batch_id}/result", response_model=ImportResultRead, tags=["imports"])
def get_import_result(batch_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    batch = get_import(batch_id, db)
    return build_import_result(db, batch)


@app.post("/api/v1/imports/{batch_id}/publish", response_model=ImportBatchRead, tags=["imports"])
def publish_import(batch_id: int, db: Session = Depends(get_db)) -> ImportBatch:
    batch = get_import(batch_id, db)
    if batch.error_count:
        raise HTTPException(status_code=409, detail="Cannot publish batch with validation errors")
    batch.status = ImportStatus.published
    batch.published_at = datetime.now(timezone.utc)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


@app.get("/api/v1/dashboards/daily", response_model=DashboardRead, tags=["dashboards"])
def daily_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_import_backed_dashboard(db, DatasetKind.daily_summary)


@app.get(
    "/api/v1/dashboards/energy-business",
    response_model=EnergyBusinessDashboardRead,
    tags=["dashboards"],
)
def energy_business_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_energy_business_dashboard(db)


@app.get("/api/v1/dashboards/monthly", response_model=DashboardRead, tags=["dashboards"])
def monthly_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_import_backed_dashboard(db, DatasetKind.technical_balance)


@app.get("/api/v1/dashboards/anomalies", response_model=DashboardRead, tags=["dashboards"])
def anomalies_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    batches = db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc())).all()
    warnings = []
    if not batches:
        warnings.append("No import batches loaded yet.")
    return {
        "meta": {"generated_from": "validation_issues"},
        "kpis": {
            "batches": len(batches),
            "warnings": sum(batch.warning_count for batch in batches),
            "errors": sum(batch.error_count for batch in batches),
        },
        "series": [],
        "breakdowns": [],
        "table": [
            {
                "batch_id": batch.id,
                "filename": batch.original_filename,
                "warning_count": batch.warning_count,
                "error_count": batch.error_count,
                "status": batch.status.value,
            }
            for batch in batches
        ],
        "insight": "Anomaly dashboard currently reflects validation issue counts per batch.",
        "warnings": warnings,
    }
