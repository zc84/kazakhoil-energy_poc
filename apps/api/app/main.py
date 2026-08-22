from calendar import monthrange
from datetime import date, datetime, timedelta, timezone
import csv
import io
import json
from pathlib import Path
import re
import shutil
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session, selectinload

from .config import get_settings
from .db import Base, engine, get_db
from .models import (
    AIInsight,
    AIMessage,
    DatasetKind,
    ImportBatch,
    ImportFile,
    ImportStatus,
    StagingRow,
    ValidationIssue,
    ValidationSeverity,
)
from .schemas import (
    AIChatRequest,
    AIChatResponse,
    AIInsightRead,
    AIMessageRead,
    AISettingsRead,
    AISettingsUpdate,
    DashboardRead,
    EnergyBusinessDashboardRead,
    EnergyForecastRequest,
    ImportBatchRead,
    ImportPreviewRead,
    ImportResultRead,
    ValidationIssueRead,
)
from .services.ai import (
    AI_MODELS,
    AI_MODEL_IDS,
    EnergyInsightBrief,
    OverviewForecastBrief,
    ask_energy_ai,
    build_ai_context,
    effective_api_key,
    get_or_create_ai_settings,
    mask_api_key,
)
from .services.dashboard import (
    build_available_filters,
    build_daily_consumption_dashboard,
    build_energy_business_dashboard,
    build_import_backed_dashboard,
    build_import_result,
    build_technical_balance_dashboard,
    is_period_in_range,
    parse_period_start_from_filename,
)
from .services.ingestion import parse_file
from .services.storage import checksum_payload, read_upload_payload, save_payload
from .services.weather import load_weather_context

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


def _is_failed_import(batch: ImportBatch) -> bool:
    return (
        batch.dataset_kind == DatasetKind.unknown
        or batch.error_count > 0
        or batch.status in {ImportStatus.needs_review, ImportStatus.failed, ImportStatus.rejected}
    )


def _delete_stored_import_files(batch: ImportBatch) -> int:
    deleted = 0
    for import_file in batch.files:
        path = Path(import_file.storage_key)
        if path.exists() and path.is_file():
            path.unlink()
            deleted += 1
    return deleted


@app.on_event("startup")
def startup() -> None:
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    _ensure_postgres_dataset_kind_values()


def _ensure_postgres_dataset_kind_values() -> None:
    if engine.dialect.name != "postgresql":
        return
    statements = [
        "ALTER TYPE datasetkind ADD VALUE IF NOT EXISTS 'commercial_consumption'",
    ]
    with engine.connect() as connection:
        autocommit_connection = connection.execution_options(isolation_level="AUTOCOMMIT")
        for statement in statements:
            autocommit_connection.execute(text(statement))


@app.get("/healthz", tags=["system"])
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/admin/reset", tags=["admin"])
def reset_all_data(db: Session = Depends(get_db)) -> dict[str, object]:
    deleted_ai_messages = db.execute(delete(AIMessage)).rowcount or 0
    deleted_ai_insights = db.execute(delete(AIInsight)).rowcount or 0
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
            "ai_messages": deleted_ai_messages,
            "ai_insights": deleted_ai_insights,
            "raw_files": removed_raw_files,
        },
    }


@app.post("/api/v1/imports", response_model=ImportBatchRead, tags=["imports"])
def create_import(
    file: UploadFile = File(...),
    response: Response = None,
    db: Session = Depends(get_db),
) -> ImportBatch:
    payload = read_upload_payload(file)
    checksum = checksum_payload(payload)
    existing = db.scalar(
        select(ImportBatch)
        .where(ImportBatch.checksum_sha256 == checksum)
        .options(selectinload(ImportBatch.files))
    )
    if existing is not None:
        if response is not None:
            response.headers["X-Import-Idempotent-Reuse"] = "true"
            response.headers["X-Import-Batch-Id"] = str(existing.id)
            response.headers["X-Import-Version"] = "1"
        return existing

    storage_path = save_payload(payload, file.filename, checksum=checksum)

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
    if response is not None:
        response.headers["X-Import-Idempotent-Reuse"] = "false"
        response.headers["X-Import-Batch-Id"] = str(batch.id)
        response.headers["X-Import-Version"] = "1"
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
        raise HTTPException(status_code=404, detail="Загрузка не найдена")
    return batch


@app.delete("/api/v1/imports/{batch_id}", tags=["imports"])
def delete_failed_import(batch_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    batch = get_import(batch_id, db)
    if not _is_failed_import(batch):
        raise HTTPException(status_code=409, detail="Можно удалить только файл, который не прошёл валидацию")

    deleted_raw_files = _delete_stored_import_files(batch)
    deleted_ai_insights = db.execute(delete(AIInsight).where(AIInsight.batch_id == batch.id)).rowcount or 0
    db.delete(batch)
    db.commit()
    return {
        "deleted": {
            "batch_id": batch_id,
            "raw_files": deleted_raw_files,
            "ai_insights": deleted_ai_insights,
        }
    }


@app.get("/api/v1/imports/{batch_id}/issues", response_model=list[ValidationIssueRead], tags=["imports"])
def get_import_issues(batch_id: int, db: Session = Depends(get_db)) -> list[ValidationIssue]:
    return db.scalars(
        select(ValidationIssue)
        .where(ValidationIssue.batch_id == batch_id)
        .order_by(ValidationIssue.id.asc())
    ).all()


@app.get(
    "/api/v1/imports/{batch_id}/issues/export",
    response_class=PlainTextResponse,
    tags=["imports"],
)
def export_import_issues_csv(batch_id: int, db: Session = Depends(get_db)) -> str:
    _ = get_import(batch_id, db)
    issues = get_import_issues(batch_id, db)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "severity", "rule_code", "message", "sheet_name", "row_index"])
    for issue in issues:
        writer.writerow(
            [
                issue.id,
                issue.severity.value,
                issue.rule_code,
                issue.message,
                issue.sheet_name or "",
                issue.row_index if issue.row_index is not None else "",
            ]
        )
    return buffer.getvalue()


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
        raise HTTPException(status_code=409, detail="Файл нельзя опубликовать, пока есть ошибки проверки")
    batch.status = ImportStatus.published
    batch.published_at = datetime.now(timezone.utc)
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


@app.get("/api/v1/dashboards/daily", response_model=DashboardRead, tags=["dashboards"])
def daily_dashboard(
    station_id: str | None = None,
    substation_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    payload = build_import_backed_dashboard(db, DatasetKind.daily_summary, date_from=date_from, date_to=date_to)
    payload["meta"]["filters"] = {
        "station_id": station_id,
        "substation_id": substation_id,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
    }
    return payload


@app.get(
    "/api/v1/dashboards/energy-business",
    response_model=EnergyBusinessDashboardRead,
    tags=["dashboards"],
)
def energy_business_dashboard(
    station_id: str | None = None,
    substation_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return build_energy_business_dashboard(
        db,
        station_id=station_id,
        substation_id=substation_id,
        date_from=date_from,
        date_to=date_to,
    )


@app.post("/api/v1/forecasts/energy", tags=["forecasts"])
def energy_forecast(
    request: EnergyForecastRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    payload = build_energy_business_dashboard(
        db,
        forecast_adjustments=[
            adjustment.model_dump(mode="json")
            for adjustment in request.adjustments
        ],
        forecast_with_weather=True,
        forecast_weather_locations=request.weather_locations,
    )
    return payload["forecast"]


@app.get("/api/v1/dashboards/monthly", response_model=DashboardRead, tags=["dashboards"])
def monthly_dashboard(
    station_id: str | None = None,
    substation_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    payload = build_import_backed_dashboard(db, DatasetKind.technical_balance, date_from=date_from, date_to=date_to)
    payload["meta"]["filters"] = {
        "station_id": station_id,
        "substation_id": substation_id,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
    }
    return payload


@app.get(
    "/api/v1/dashboards/technical-balance",
    response_model=DashboardRead,
    tags=["dashboards"],
)
def technical_balance_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_technical_balance_dashboard(db)


@app.get(
    "/api/v1/dashboards/daily-consumption",
    response_model=DashboardRead,
    tags=["dashboards"],
)
def daily_consumption_dashboard(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_daily_consumption_dashboard(db)


@app.get("/api/v1/dashboards/anomalies", response_model=DashboardRead, tags=["dashboards"])
def anomalies_dashboard(
    station_id: str | None = None,
    substation_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    batches = db.scalars(select(ImportBatch).order_by(ImportBatch.created_at.desc())).all()
    if date_from or date_to:
        filtered_batches = []
        for batch in batches:
            period_start = parse_period_start_from_filename(batch.original_filename)
            if not is_period_in_range(period_start, date_from, date_to):
                continue
            filtered_batches.append(batch)
        batches = filtered_batches
    warnings = []
    if not batches:
        warnings.append("Пока нет загруженных файлов.")
    return {
        "meta": {
            "generated_from": "validation_issues",
            "filters": {
                "station_id": station_id,
                "substation_id": substation_id,
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
            },
        },
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
        "insight": "Экран показывает замечания, найденные при проверке каждого файла.",
        "warnings": warnings,
    }


@app.get("/api/v1/filters", tags=["dashboards"])
def dashboard_filters(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_available_filters(db)


@app.get("/api/v1/ai/settings", response_model=AISettingsRead, tags=["ai"])
def read_ai_settings(db: Session = Depends(get_db)) -> dict[str, object]:
    row = get_or_create_ai_settings(db)
    key = effective_api_key(row)
    return {
        "model": row.model,
        "skill_prompt": row.skill_prompt,
        "has_api_key": bool(key),
        "masked_api_key": mask_api_key(key),
        "models": AI_MODELS,
    }


@app.put("/api/v1/ai/settings", response_model=AISettingsRead, tags=["ai"])
def update_ai_settings(
    request: AISettingsUpdate,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    if request.model not in AI_MODEL_IDS:
        raise HTTPException(status_code=422, detail="Эта модель OpenAI не поддерживается")
    row = get_or_create_ai_settings(db)
    row.model = request.model
    row.skill_prompt = request.skill_prompt.strip()
    if request.clear_api_key:
        row.api_key = None
    elif request.api_key is not None and request.api_key.strip():
        row.api_key = request.api_key.strip()
    db.add(row)
    db.commit()
    db.refresh(row)
    return read_ai_settings(db)


@app.get("/api/v1/ai/context", tags=["ai"])
def read_ai_context(db: Session = Depends(get_db)) -> dict[str, object]:
    return build_ai_context(db)


@app.get(
    "/api/v1/ai/insights/latest",
    response_model=AIInsightRead | None,
    tags=["ai"],
)
def latest_ai_insight(db: Session = Depends(get_db)) -> AIInsight | None:
    return db.scalar(select(AIInsight).order_by(AIInsight.created_at.desc()))


def _average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _overview_weather_summary(
    *,
    target_start: date,
    target_end: date,
    today: date,
) -> dict[str, object]:
    settings = get_settings()
    history_end = min(today - timedelta(days=1), target_start - timedelta(days=1))
    history_start = date(max(1940, history_end.year - 2), 1, 1)
    context = load_weather_context(
        history_start,
        history_end,
        target_start,
        target_end,
        latitude=settings.forecast_latitude,
        longitude=settings.forecast_longitude,
        timezone=settings.forecast_timezone,
        location_name=settings.forecast_location_name,
    )
    forecast_rows = [
        {"date": day, **values}
        for day, values in sorted((context.get("forecast") or {}).items())
        if target_start.isoformat() <= day <= target_end.isoformat()
    ]
    temperatures = [
        float(row["temperature_2m_mean"])
        for row in forecast_rows
        if row.get("temperature_2m_mean") is not None
    ]
    normals = [
        float(row["temperature_normal"])
        for row in forecast_rows
        if row.get("temperature_normal") is not None
    ]
    precipitation = [
        float(row.get("precipitation_sum") or 0)
        for row in forecast_rows
    ]
    winds = [
        float(row.get("wind_speed_10m_max") or 0)
        for row in forecast_rows
    ]
    anomaly_labels = [
        str(row.get("anomaly_label"))
        for row in forecast_rows
        if row.get("is_anomaly") and row.get("anomaly_label")
    ]
    sources = sorted({
        str(row.get("source"))
        for row in forecast_rows
        if row.get("source")
    })
    avg_temp = _average(temperatures)
    normal_temp = _average(normals)
    return {
        "status": context.get("status"),
        "provider": context.get("provider"),
        "location": context.get("location"),
        "period": f"{target_start.isoformat()}..{target_end.isoformat()}",
        "days": len(forecast_rows),
        "temperature_mean_c": round(avg_temp, 1) if avg_temp is not None else None,
        "temperature_normal_c": round(normal_temp, 1) if normal_temp is not None else None,
        "temperature_delta_c": round(avg_temp - normal_temp, 1) if avg_temp is not None and normal_temp is not None else None,
        "temperature_min_c": round(min(temperatures), 1) if temperatures else None,
        "temperature_max_c": round(max(temperatures), 1) if temperatures else None,
        "precipitation_total_mm": round(sum(precipitation), 1) if precipitation else None,
        "wet_days": sum(1 for value in precipitation if value >= 1.0),
        "windy_days": sum(1 for value in winds if value >= 35.0),
        "anomaly_days": len(anomaly_labels),
        "anomaly_labels": sorted(set(anomaly_labels)),
        "sources": sources[:4],
        "message": context.get("message"),
    }


@app.get("/api/v1/ai/overview-forecast", tags=["ai"])
def overview_ai_forecast(db: Session = Depends(get_db)) -> dict[str, object]:
    settings_row = get_or_create_ai_settings(db)
    if not effective_api_key(settings_row):
        return {"available": False, "reason": "openai_api_key_missing"}

    dashboard = build_energy_business_dashboard(db)
    monthly_series = dashboard.get("monthly_series") or []
    forecast = dashboard.get("forecast") or {}
    backtest = forecast.get("backtest") or {}
    forecast_timezone = get_settings().forecast_timezone
    today = datetime.now(ZoneInfo(forecast_timezone)).date()
    target_year = today.year + (1 if today.month == 12 else 0)
    target_month = 1 if today.month == 12 else today.month + 1
    target_forecast_period = f"{target_year:04d}-{target_month:02d}"
    target_start = date(target_year, target_month, 1)
    target_end = date(target_year, target_month, monthrange(target_year, target_month)[1])
    weather_summary = _overview_weather_summary(
        target_start=target_start,
        target_end=target_end,
        today=today,
    )
    forecast_period = str(forecast.get("period") or "")
    forecast_matches_target = forecast_period == target_forecast_period
    forecast_start = date.fromisoformat(f"{forecast_period}-01") if re.fullmatch(r"\d{4}-\d{2}", forecast_period) else None
    forecast_end = (
        date(forecast_start.year + (1 if forecast_start.month == 12 else 0), 1 if forecast_start.month == 12 else forecast_start.month + 1, 1)
        if forecast_start
        else None
    )
    if forecast_end:
        forecast_end = date.fromordinal(forecast_end.toordinal() - 1)
    if forecast_start and forecast_end and forecast_start <= today <= forecast_end:
        forecast_position = "current_month"
    elif forecast_start and today < forecast_start:
        forecast_position = "future_month"
    elif forecast_end and today > forecast_end:
        forecast_position = "past_month"
    else:
        forecast_position = "unknown"
    has_enough_monthly = len(monthly_series) >= 3
    has_ready_forecast = forecast.get("status") == "ready"
    has_backtest = backtest.get("status") == "ready" and int(backtest.get("periods") or 0) >= 2
    if not (has_enough_monthly and has_ready_forecast and has_backtest):
        return {
            "available": False,
            "reason": "insufficient_data",
            "requirements": {
                "monthly_periods": len(monthly_series),
                "forecast_status": forecast.get("status"),
                "backtest_periods": backtest.get("periods") or 0,
            },
        }

    task_instruction = (
        "Сформируй компактную секцию «AI прогноз» для главной страницы. "
        f"Сегодня {today.isoformat()} в таймзоне {forecast_timezone}. "
        f"Целевой период AI-прогноза: {target_forecast_period} — следующий календарный месяц "
        f"после сегодняшней даты, не текущий месяц. Расчётный период модели: "
        f"{forecast_period or 'не определён'}, состояние расчётного периода: {forecast_position}, "
        f"совпадает с целевым периодом: {forecast_matches_target}. "
        "Используй только energy_dashboard: forecast, monthly_series, kpis, "
        "top_external_consumers, reconciliation, data_quality и weather_context_for_target_period. "
        "Погодный контекст уже получен внешним вызовом к Open-Meteo за целевой период: "
        f"{json.dumps(weather_summary, ensure_ascii=False, default=str)}. "
        "Обязательно сделай одну отдельную секцию про погоду в sections: если есть отклонение "
        "температуры, осадки, ветер или аномалии — объясни операционный смысл; если "
        "погода близка к норме — прямо скажи, что погодный фактор не выглядит главным "
        "драйвером. Не придумывай погодные причины сверх weather_context_for_target_period. "
        "Верни только полезные инсайт-секции в sections: каждая секция должна отвечать на вопрос "
        "«что изменится / где риск / что проверить», а не пересказывать наличие данных. "
        "Не добавляй секцию про деньги, если тарифа, цены кВт·ч или денежных данных нет. "
        "Не добавляй секции с очевидными ограничениями вроде «данных недостаточно»; "
        "такие ограничения пиши только в caveat или confidence.basis. Не делай выводы "
        "по пикам, суточному профилю или погоде, если daily_series или weather model "
        "недостаточны. Если расчётный период модели не совпадает с целевым, не выдавай "
        "значения forecast.period за прямой прогноз целевого месяца: используй их как "
        "ближайший модельный ориентир вместе с monthly_series и явно отметь ограничение "
        "в confidence.basis или caveat. В этом случае не используй уверенные формулировки "
        "«ожидается», «прогноз» или «будет» для целевого месяца; пиши «ориентир на "
        "целевой месяц», «предварительная оценка» или «сценарная оценка». В headline "
        "и sections называй целевой месяц, а не текущий месяц. "
        "Не придумывай причины изменений. Пиши коротко для руководителя. "
        "Оптимально 2-3 секции; 4 используй только если каждая несёт отдельное действие. "
        "без имён JSON-полей, слова reported и внутренних терминов."
    )
    try:
        content, response_id, model = ask_energy_ai(
            db,
            include_history=False,
            response_model=OverviewForecastBrief,
            task_instruction=task_instruction,
            user_message="Подготовь AI-прогноз для страницы «Сводка».",
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Не удалось получить ответ OpenAI: {exc}") from exc

    return {
        "available": True,
        "model": model,
        "response_id": response_id,
        "data_basis": {
            "monthly_periods": len(monthly_series),
            "target_forecast_period": target_forecast_period,
            "forecast_period": forecast.get("period"),
            "source_period": forecast.get("source_period"),
            "today": today.isoformat(),
            "timezone": forecast_timezone,
            "forecast_position": forecast_position,
            "forecast_matches_target": forecast_matches_target,
            "weather_status": weather_summary.get("status"),
            "weather_days": weather_summary.get("days"),
            "backtest_periods": backtest.get("periods") or 0,
            "daily_days": dashboard.get("kpis", {}).get("coverage_days") or 0,
        },
        "content": json.loads(content),
    }


def _insight_chat_message(content: str, filename: str) -> str:
    try:
        brief = json.loads(content)
    except json.JSONDecodeError:
        return f"### Разбор файла «{filename}»\n\n{content}"

    def clean(value: object) -> str:
        text = str(value or "")
        text = re.sub(r"\bбатч(?:у|а|е|ом)?\s*#?\d*\b", "загрузке", text, flags=re.IGNORECASE)
        return (
            text.replace("formula mismatches", "расхождения формул")
            .replace("errors", "ошибок")
            .replace("warnings", "предупреждений")
        )

    signals = "\n".join(
        f"- **{clean(item.get('label', 'Сигнал'))}: {clean(item.get('value', '—'))}** — {clean(item.get('context', ''))}"
        for item in brief.get("signals", [])
    )
    action = brief.get("action") or {}
    return (
        f"### {clean(brief.get('headline', 'Разбор новой загрузки'))}\n\n"
        f"{clean(brief.get('summary', ''))}\n\n"
        f"**Что показывают данные**\n\n{signals}\n\n"
        f"### Следующее действие\n\n"
        f"**{clean(action.get('title', 'Проверьте результат'))}.** {clean(action.get('detail', ''))}"
    ).strip()


@app.post(
    "/api/v1/imports/{batch_id}/ai-insight",
    response_model=AIInsightRead,
    tags=["ai"],
)
def generate_ai_insight(
    batch_id: int,
    db: Session = Depends(get_db),
) -> AIInsight:
    batch = get_import(batch_id, db)
    existing = db.scalar(select(AIInsight).where(AIInsight.batch_id == batch_id))
    try:
        content, _, model = ask_energy_ai(
            db,
            include_history=False,
            response_model=EnergyInsightBrief,
            focus_batch_id=batch.id,
            task_instruction=(
                "Собери управленческий бриф по новой загрузке. Приоритет источников: "
                "energy_dashboard.monthly_series, kpis, reconciliation, data_quality и "
                "forecast. Найди один доказуемый энергетический сигнал по периоду файла. "
                "Не используй количество строк, листов или ячеек как динамику, KPI либо "
                "доказательство пропущенных показателей. Дай ровно три сигнала с одной "
                "и той же бизнес-метрикой или явно разными подписями и единицами. Если "
                "сопоставимого энергетического показателя нет, так и скажи вместо "
                "сравнения структуры файлов. Не придумывай причин. Статус risk ставь "
                "только при материальном отклонении или подтверждённых ошибках данных. "
                "Подписи сигналов делай короткими и естественными, до четырёх слов. "
                "Заголовок — до 9 слов. Summary не повторяет заголовок: в 1–2 коротких "
                "предложениях добавь измеримое доказательство и оговорку о качестве данных. "
                "Никогда не вставляй в пользовательский текст имена JSON-полей вроде "
                "reported_total_kwh, monthly_series или reconciliation. Если отдельный итог "
                "из файла отсутствует, скажи: «итоговый объём для контрольной сверки в файле "
                "не найден; использован расчёт по показаниям счётчиков»."
            ),
            user_message=f"Проанализируй новый файл «{batch.original_filename}».",
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Не удалось получить ответ OpenAI: {exc}") from exc

    is_new_insight = existing is None
    if is_new_insight:
        existing = AIInsight(batch_id=batch_id, model=model, content=content)
    else:
        existing.model = model
        existing.content = content
    db.add(existing)
    if is_new_insight:
        db.add(
            AIMessage(
                role="assistant",
                content=_insight_chat_message(content, batch.original_filename),
                model=model,
            )
        )
    db.commit()
    db.refresh(existing)
    return existing


@app.get(
    "/api/v1/ai/messages",
    response_model=list[AIMessageRead],
    tags=["ai"],
)
def list_ai_messages(
    limit: int = 30,
    db: Session = Depends(get_db),
) -> list[AIMessage]:
    safe_limit = min(max(limit, 1), 100)
    messages = list(
        db.scalars(
            select(AIMessage)
            .order_by(AIMessage.id.desc())
            .limit(safe_limit)
        ).all()
    )
    messages.reverse()
    return messages


@app.delete("/api/v1/ai/messages", tags=["ai"])
def clear_ai_messages(
    db: Session = Depends(get_db),
) -> dict[str, int]:
    deleted_messages = db.execute(delete(AIMessage)).rowcount or 0
    db.commit()
    return {"deleted": deleted_messages}


@app.post("/api/v1/ai/chat", response_model=AIChatResponse, tags=["ai"])
def chat_with_energy_ai(
    request: AIChatRequest,
    db: Session = Depends(get_db),
) -> dict[str, object]:
    try:
        content, response_id, model = ask_energy_ai(
            db,
            user_message=request.message.strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Не удалось получить ответ OpenAI: {exc}") from exc

    db.add(AIMessage(role="user", content=request.message.strip()))
    assistant = AIMessage(
        role="assistant",
        content=content,
        model=model,
        response_id=response_id,
    )
    db.add(assistant)
    db.commit()
    db.refresh(assistant)
    return {"message": assistant, "response_id": response_id, "model": model}
