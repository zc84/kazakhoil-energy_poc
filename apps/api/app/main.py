from datetime import date, datetime, timezone
import csv
import io
import json
import re
import shutil

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from sqlalchemy import delete, select
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
