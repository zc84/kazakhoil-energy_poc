from __future__ import annotations

import json
from typing import Any, Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import AIInsight, AIMessage, AISettings, ImportBatch
from .dashboard import build_energy_business_dashboard, build_import_result

LEGACY_DEFAULT_SKILL_PROMPT = """Роль: ведущий энергоаналитик АО «Казахойл Актобе».

Цель: превращать нормализованные данные энергобаланса в короткие управленческие выводы.

Критерии качества:
- опирайся только на переданный контекст и явно отделяй факт от предположения;
- называй период, метрику, единицы измерения и величину отклонения;
- связывай качество данных с надёжностью вывода и прогноза;
- выделяй риск, вероятную причину и одно практическое следующее действие;
- отвечай на русском языке, ясно и без канцелярита.

Формат: сначала вывод, затем подтверждающие цифры и рекомендуемое действие.
Если данных недостаточно, точно укажи, какого файла, периода или показателя не хватает."""

ANALYTIC_EVIDENCE_CONTRACT = """ГРАНИЦЫ ИНТЕРПРЕТАЦИИ ДАННЫХ:
- Бизнес-выводы делай только по энергетическим показателям: кВт·ч, мощности, долям,
  балансу, потерям, пикам, динамике потребления и прогнозу.
- Поля rows, accepted_rows, total_rows, numeric_rows, sheet count, размер и формат
  файла — это технические метаданные импорта. Они не измеряют потребление,
  полноту энергобаланса или количество бизнес-показателей.
- Никогда не сравнивай число строк между файлами как динамику по месяцам, не
  рассчитывай процент изменения строк и не включай такое сравнение в AI-сигналы.
- Меньшее число строк само по себе не доказывает пропуски, ошибки распознавания или
  неполноту данных. Такой вывод допустим только при прямом подтверждении:
  warnings/errors, непринятые строки, отсутствующие обязательные поля или листы,
  либо подтверждённое расхождение энергобаланса.
- Сравнивай только одну и ту же бизнес-метрику, в одинаковых единицах и за
  сопоставимые периоды. Не сравнивай разные типы наборов данных.
- daily_series.sources — это контролируемые питающие вводы (источники поступления),
  а не потребители. Не называй их потребителями и не отвечай ими на вопрос о
  крупнейшем потребителе. Для потребителей используй только top_external_consumers,
  учитывая поля source и kind.
- Для качества импорта сообщай факты нейтрально: принято X из Y строк, N ошибок,
  N предупреждений. Не превращай технические счётчики в экономический риск.
- Причину называй фактом только при прямом подтверждении контекстом. Иначе помечай
  её как гипотезу или сообщай, каких данных не хватает.
- Если корректного бизнес-сравнения нет, прямо скажи об этом. Это лучше, чем
  заполнять бриф сравнением технических метаданных.
- В ответе пользователю говори «файл» или «загрузка», а не «батч». Не показывай
  внутренние идентификаторы и имена полей, если пользователь прямо их не запросил."""

USER_FACING_FIELD_NAMES = {
    "reported_total_kwh": "итоговый объём из исходного файла",
    "monthly_series": "помесячный энергобаланс",
    "daily_series": "суточный ряд",
    "top_external_consumers": "список крупнейших потребителей",
    "reconciliation": "сверка суточных и месячных данных",
    "data_quality": "показатели качества данных",
    "energy_dashboard": "энергетический расчёт",
    "source_total_kwh": "объём исходного периода",
    "forecast_total_kwh": "прогнозный объём",
    "forecast_low_kwh": "нижняя граница прогноза",
    "forecast_high_kwh": "верхняя граница прогноза",
    "recalculation_difference_kwh": "расхождение с итогом из файла",
}


def sanitize_user_facing_ai_text(text: str) -> str:
    cleaned = text
    phrase_replacements = {
        "нет опубликованного reported_total_kwh": (
            "не найден итоговый объём для контрольной сверки из исходного файла"
        ),
        "нет reported_total_kwh": (
            "не найден итоговый объём для контрольной сверки из исходного файла"
        ),
        "по monthly_series": "по данным помесячного энергобаланса",
        "из monthly_series": "из помесячного энергобаланса",
        "подтверждён monthly_series": "подтверждён данными помесячного энергобаланса",
        "подтверждён помесячный энергобаланс": (
            "подтверждён данными помесячного энергобаланса"
        ),
        "daily/monthly": "суточных и месячных данных",
    }
    for internal_phrase, user_facing_phrase in phrase_replacements.items():
        cleaned = cleaned.replace(internal_phrase, user_facing_phrase)
    for internal_name, user_facing_name in USER_FACING_FIELD_NAMES.items():
        cleaned = cleaned.replace(internal_name, user_facing_name)
    return cleaned

DEFAULT_SKILL_PROMPT = f"""Роль: ведущий энергоаналитик АО «Казахойл Актобе».

Цель: находить в нормализованном энергобалансе один наиболее важный и доказуемый
управленческий сигнал.

Успешный ответ:
- начинает с прямого вывода;
- подтверждает его сопоставимыми энергетическими метриками, периодом и единицами;
- отделяет факт от гипотезы;
- учитывает качество данных только в пределах доступных проверок;
- завершает одним практическим следующим действием;
- написан на русском языке, ясно и без канцелярита.

{ANALYTIC_EVIDENCE_CONTRACT}

Формат: вывод, подтверждающие цифры, существенная оговорка и следующее действие.
Если доказательств недостаточно, точно назови недостающую метрику или период."""

AI_MODELS = [
    {"id": "gpt-4o", "label": "GPT-4o", "hint": "быстрый универсальный"},
    {"id": "gpt-4.1", "label": "GPT-4.1", "hint": "точное следование инструкциям"},
    {"id": "gpt-4.1-mini", "label": "GPT-4.1 mini", "hint": "экономичный анализ"},
    {"id": "gpt-5", "label": "GPT-5", "hint": "глубокий анализ"},
    {"id": "gpt-5-mini", "label": "GPT-5 mini", "hint": "быстрый анализ"},
    {"id": "gpt-5.1", "label": "GPT-5.1", "hint": "улучшенное рассуждение"},
    {"id": "gpt-5.2", "label": "GPT-5.2", "hint": "сложные данные"},
    {"id": "gpt-5.4-mini", "label": "GPT-5.4 mini", "hint": "баланс цены и качества"},
    {"id": "gpt-5.4", "label": "GPT-5.4", "hint": "максимальное качество до 5.4"},
]
AI_MODEL_IDS = {item["id"] for item in AI_MODELS}


class InsightSignal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    value: str
    context: str
    tone: Literal["positive", "neutral", "warning", "critical"]


class InsightAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    detail: str


class InsightConfidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    basis: str


class EnergyInsightBrief(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["stable", "watch", "risk"]
    headline: str
    summary: str
    signals: list[InsightSignal] = Field(min_length=3, max_length=3)
    action: InsightAction
    confidence: InsightConfidence


def get_or_create_ai_settings(db: Session) -> AISettings:
    row = db.get(AISettings, 1)
    if row is None:
        row = AISettings(id=1, model="gpt-5.4", skill_prompt=DEFAULT_SKILL_PROMPT)
        db.add(row)
        db.commit()
        db.refresh(row)
    elif row.skill_prompt.strip() == LEGACY_DEFAULT_SKILL_PROMPT.strip():
        row.skill_prompt = DEFAULT_SKILL_PROMPT
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def effective_api_key(row: AISettings) -> str | None:
    return (row.api_key or get_settings().openai_api_key or "").strip() or None


def mask_api_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "••••••••"
    return f"{value[:3]}••••••••{value[-4:]}"


def _forecast_snapshot(forecast: dict[str, Any]) -> dict[str, Any]:
    keys = (
        "status",
        "period",
        "source_period",
        "source_days",
        "source_total_kwh",
        "forecast_total_kwh",
        "forecast_low_kwh",
        "forecast_high_kwh",
        "expected_change_pct",
        "confidence",
        "backtest",
        "scenarios",
        "drivers",
    )
    result = {key: forecast.get(key) for key in keys}
    result["next_days"] = (forecast.get("series") or [])[:10]
    return result


def build_ai_context(db: Session, *, focus_batch_id: int | None = None) -> dict[str, Any]:
    batches = db.scalars(
        select(ImportBatch).order_by(ImportBatch.created_at.desc()).limit(5)
    ).all()
    imports = [
        {
            "id": batch.id,
            "file": batch.original_filename,
            "dataset_kind": batch.dataset_kind.value,
            "status": batch.status.value,
            "technical_row_count": batch.total_rows,
            "accepted_technical_rows": batch.accepted_rows,
            "warnings": batch.warning_count,
            "errors": batch.error_count,
            "loaded_at": batch.created_at.isoformat(),
            "semantic_note": "Технические метаданные импорта; не бизнес-KPI.",
        }
        for batch in batches
    ]
    latest_results = []
    for batch in batches[:3]:
        result = build_import_result(db, batch)
        latest_results.append(
            {
                "batch_id": batch.id,
                "file_structure": result["summary"],
                "sheet_structure": result["sheet_distribution"],
                "candidate_numeric_cells": result["series"][:8],
                "semantic_note": (
                    "Профиль структуры файла. Не использовать количество строк для "
                    "межпериодной динамики; numeric cells требуют бизнес-метрики из dashboard."
                ),
            }
        )

    dashboard = build_energy_business_dashboard(db)
    focus_import = next(
        (item for item in imports if item["id"] == focus_batch_id),
        None,
    )
    latest_insight = db.scalar(
        select(AIInsight).order_by(AIInsight.created_at.desc())
    )
    context = {
        "context_version": 2,
        "focus_import": focus_import,
        "latest_imports": imports,
        "normalized_results": latest_results,
        "energy_dashboard": {
            "meta": dashboard["meta"],
            "kpis": dashboard["kpis"],
            "monthly_series": dashboard["monthly_series"][-6:],
            "daily_series": dashboard["daily_series"][-14:],
            "top_external_consumers": dashboard["top_external_consumers"][:8],
            "reconciliation": dashboard["reconciliation"][-6:],
            "data_quality": dashboard["data_quality"],
            "calculated_insight": dashboard["insight"],
            "forecast": _forecast_snapshot(dashboard["forecast"]),
            "warnings": dashboard["warnings"],
        },
    }
    context["latest_ai_insight"] = (
        {
            "batch_id": latest_insight.batch_id,
            "model": latest_insight.model,
            "content": json.loads(latest_insight.content),
            "created_at": latest_insight.created_at.isoformat(),
        }
        if latest_insight
        else None
    )
    return context


def _history_input(
    db: Session,
    limit: int = 12,
) -> list[dict[str, str]]:
    messages = list(
        db.scalars(
            select(AIMessage).order_by(AIMessage.id.desc()).limit(limit)
        ).all()
    )
    messages.reverse()
    return [{"role": item.role, "content": item.content} for item in messages]


def ask_energy_ai(
    db: Session,
    *,
    user_message: str,
    include_history: bool = True,
    task_instruction: str | None = None,
    response_model: type[BaseModel] | None = None,
    focus_batch_id: int | None = None,
) -> tuple[str, str | None, str]:
    config = get_or_create_ai_settings(db)
    api_key = effective_api_key(config)
    if not api_key:
        raise ValueError("API-ключ OpenAI не настроен")

    context = build_ai_context(db, focus_batch_id=focus_batch_id)
    input_items = _history_input(db) if include_history else []
    input_items.append(
        {
            "role": "user",
            "content": (
                f"{task_instruction}\n\n" if task_instruction else ""
            )
            + "Актуальный контекст данных:\n"
            + json.dumps(context, ensure_ascii=False, default=str)
            + "\n\nЗапрос пользователя:\n"
            + user_message,
        }
    )
    client = OpenAI(api_key=api_key, timeout=75.0)
    instructions = config.skill_prompt
    if "ГРАНИЦЫ ИНТЕРПРЕТАЦИИ ДАННЫХ" not in instructions:
        instructions += f"\n\n{ANALYTIC_EVIDENCE_CONTRACT}"
    if response_model is None:
        instructions += (
            "\n\nФормат ответа в чате: используй Markdown и визуальную иерархию. "
            "Начни с прямого ответа, затем при необходимости добавь короткие разделы "
            "уровня ###, списки и выделение **ключевых цифр**. Таблицу используй только "
            "для сравнения нескольких показателей. Не пиши сплошную простыню текста."
        )
    request = {
        "model": config.model,
        "instructions": instructions,
        "input": input_items,
        "max_output_tokens": 1400,
        "store": False,
    }
    if response_model is not None:
        response = client.responses.parse(**request, text_format=response_model)
        parsed = response.output_parsed
        if parsed is None:
            raise RuntimeError("OpenAI не вернул структурированный ответ")
        text = parsed.model_dump_json()
    else:
        response = client.responses.create(**request)
        text = (response.output_text or "").strip()
    if not text:
        raise RuntimeError("OpenAI вернул пустой ответ")
    return sanitize_user_facing_ai_text(text), getattr(response, "id", None), config.model
