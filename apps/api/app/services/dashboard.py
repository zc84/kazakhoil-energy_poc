import json
import math
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import DatasetKind, ImportBatch, ImportStatus, StagingRow
from .weather import load_weather_context

MONTHS = {
    "январ": (1, "Янв"),
    "феврал": (2, "Фев"),
    "март": (3, "Мар"),
    "апрел": (4, "Апр"),
    "май": (5, "Май"),
    "июн": (6, "Июн"),
    "июл": (7, "Июл"),
    "август": (8, "Авг"),
    "сентябр": (9, "Сен"),
    "октябр": (10, "Окт"),
    "ноябр": (11, "Ноя"),
    "декабр": (12, "Дек"),
}
MONTHS_PREPOSITIONAL = {
    1: "январе",
    2: "феврале",
    3: "марте",
    4: "апреле",
    5: "мае",
    6: "июне",
    7: "июле",
    8: "августе",
    9: "сентябре",
    10: "октябре",
    11: "ноябре",
    12: "декабре",
}

COMPANY_ALIASES = {
    "gasproces comp": "GasProces.Comp",
    "gasprocscomp": "GasProces.Comp",
    "gasproscomp": "GasProces.Comp",
    "кар тел": "КАР-ТЕЛ",
    "мобтелсервис": "МобТелСервис",
    "моб тел сервис": "МобТелСервис",
    "gsm казахстан": "GSM Казахстан",
    "казахтелеком": "Казахтелеком",
    "каспий нефть": "Каспий нефть",
    "казтрансойл": "КазТрансОйл",
}

SUMMARY_EXTERNAL_METERS = {
    "касп нефть 1": "51616744",
    "касп нефть 2": "51555226",
    "казтрансойл 1": "51555218",
    "казтрансойл 2": "51555151",
}

SUBSTATION_BY_METER = {
    "51097674": "ПС 35/6 кВ Север",
    "51259257": "ПС 35/6 кВ Север",
    "51097603": "ПС 35/6 кВ Южная",
    "51097590": "ПС 35/6 кВ Южная",
    "51100980": "ПС 35/6 кВ Южная",
    "51097623": "ПС 35/6 кВ Южная",
    "51259238": "ПС 35/6 кВ Кожасай",
    "51259324": "ПС 35/6 кВ Кожасай",
    "51431297": "ПС 35/6 кВ БКНС Кожасай",
    "51431332": "ПС 35/6 кВ БКНС Кожасай",
    "51431357": "ПС Южный Жанажол",
    "51616744": "ПС 110/35/6 кВ Казахойл",
    "51555226": "ПС 110/35/6 кВ Казахойл",
    "51555218": "ПС 35/6 кВ Южная",
    "51555151": "ПС 35/6 кВ Южная",
}


def _period_from_filename(filename: str) -> tuple[str, str, int, int] | None:
    normalized = filename.casefold().replace("ё", "е")
    year_match = re.search(r"(20\d{2})", normalized)
    if year_match is None:
        return None
    year = int(year_match.group(1))
    for stem, (month, label) in MONTHS.items():
        if stem in normalized:
            return f"{year:04d}-{month:02d}", label, year, month
    return None


def parse_period_start_from_filename(filename: str) -> date | None:
    period_info = _period_from_filename(filename)
    if period_info is None:
        return None
    _, _, year, month = period_info
    return date(year, month, 1)


def is_period_in_range(period_start: date | None, date_from: date | None, date_to: date | None) -> bool:
    if period_start is None:
        return True
    if date_from and period_start < date(date_from.year, date_from.month, 1):
        return False
    if date_to and period_start > date(date_to.year, date_to.month, 1):
        return False
    return True


def build_import_backed_dashboard(
    db: Session,
    dataset_kind: DatasetKind,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict[str, object]:
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.dataset_kind == dataset_kind)
        .where(ImportBatch.status == ImportStatus.published)
        .order_by(ImportBatch.created_at.desc())
    ).all()
    filtered_batches = [
        batch
        for batch in batches
        if is_period_in_range(parse_period_start_from_filename(batch.original_filename), date_from, date_to)
    ]

    total_rows = sum(batch.accepted_rows for batch in filtered_batches)
    total_files = len(filtered_batches)

    return {
        "meta": {
            "dataset_kind": dataset_kind.value,
            "published_batches": total_files,
        },
        "kpis": {
            "published_rows": total_rows,
            "published_batches": total_files,
        },
        "series": [],
        "breakdowns": [],
        "table": [
            {
                "batch_id": batch.id,
                "filename": batch.original_filename,
                "accepted_rows": batch.accepted_rows,
                "published_at": batch.published_at.isoformat() if batch.published_at else None,
            }
            for batch in filtered_batches
        ],
        "insight": "Экран собран по опубликованным файлам и обработанным данным.",
        "warnings": [],
    }


def _row_cells(raw_json: str) -> list[object]:
    try:
        value = json.loads(raw_json)
    except (TypeError, json.JSONDecodeError):
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return list(value.values())
    return [value]


def _number(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        return number if math.isfinite(number) else None
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("\u00a0", "").replace(" ", "").replace(",", ".")
    if not normalized:
        return None
    try:
        number = float(normalized)
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _label(cells: list[object]) -> str:
    for index in (0, 1):
        if index < len(cells) and isinstance(cells[index], str) and cells[index].strip():
            return " ".join(cells[index].split())
    return ""


def _normalized_label(cells: list[object]) -> str:
    return _label(cells).casefold().replace("ё", "е")


def _consumption(cells: list[object]) -> float | None:
    if len(cells) < 7:
        return None
    coefficient = _number(cells[4])
    current_reading = _number(cells[5])
    next_reading = _number(cells[6])
    if coefficient is None or current_reading is None or next_reading is None:
        return None
    return (next_reading - current_reading) * coefficient


def _reported_consumption(cells: list[object]) -> float | None:
    return _number(cells[7]) if len(cells) > 7 else None


def _normalize_meter_number(value: object) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else format(value, "g")
    normalized = re.sub(r"\s+", "", str(value)).strip()
    if not normalized or normalized.casefold() in {"№пу", "потребление"}:
        return None
    return normalized


def _slug(value: str) -> str:
    return re.sub(
        r"[^a-zа-я0-9]+",
        "-",
        value.casefold().replace("ё", "е"),
    ).strip("-")


def _company_from_label(label: str) -> str:
    normalized = " ".join(
        re.sub(r"[«»\"'.,()№/_-]+", " ", label.casefold().replace("ё", "е")).split()
    )
    for alias, canonical in COMPANY_ALIASES.items():
        if alias in normalized:
            return canonical

    legal_match = re.search(
        r"\b(?:тоо|ип|кх)\s+(.+?)(?:\s+(?:пл|площадка|кожасай|алис?бекмола|ввод|вахт|в гор|яч|упн|цпнг|ппн|0 4кв|35 6)|$)",
        normalized,
    )
    if legal_match:
        company = legal_match.group(1).strip()
        if company:
            return " ".join(part.capitalize() for part in company.split())

    for marker, canonical in (
        ("халиб", "Halliburton"),
        ("сан др", "Сан-Дриллинг"),
        ("25 корпус", "25 корпус"),
        ("атжаксы", "Атжаксы"),
        ("актобе техникс", "Актобе Техникс"),
        ("шлюмберже", "Schlumberger"),
    ):
        if marker in normalized:
            return canonical
    return "Требует уточнения"


def _substation_from_group(group: str) -> str:
    normalized = group.casefold().replace("ё", "е")
    if "газзавод" in normalized:
        return "ПС 35/6 кВ Газзавод"
    if "кожасай" in normalized:
        return "ПС 110/35/6 кВ Кожасай"
    if "площадка №4" in normalized:
        return "ПС 110/35/6 кВ Казахойл"
    return "Требует уточнения"


def _substation_from_label(label: str, meter_number: str | None = None) -> str | None:
    if meter_number and meter_number in SUBSTATION_BY_METER:
        return SUBSTATION_BY_METER[meter_number]
    normalized = label.casefold().replace("ё", "е")
    if "южный жанажол" in normalized:
        return "ПС Южный Жанажол"
    if "бкнс" in normalized and "кожасай" in normalized:
        return "ПС 35/6 кВ БКНС Кожасай"
    if "кожасай" in normalized:
        return "ПС 35/6 кВ Кожасай"
    if "газзавод" in normalized:
        return "ПС 35/6 кВ Газзавод"
    if "пс север" in normalized or 'п/с север' in normalized:
        return "ПС 35/6 кВ Север"
    if "пс 35/6" in normalized and ("южн" in normalized or "юг" in normalized):
        return "ПС 35/6 кВ Южная"
    return None


def _rows_by_sheet(db: Session, batch_id: int) -> dict[str, list[tuple[StagingRow, list[object]]]]:
    grouped: dict[str, list[tuple[StagingRow, list[object]]]] = defaultdict(list)
    rows = db.scalars(
        select(StagingRow)
        .where(StagingRow.batch_id == batch_id)
        .order_by(StagingRow.id.asc())
    ).all()
    for row in rows:
        grouped[row.sheet_name].append((row, _row_cells(row.raw_json)))
    return grouped


def _is_controlled_supply(label: str) -> bool:
    normalized = label.casefold().replace("ё", "е")
    return normalized.startswith("ввод 110кв от") or (
        "южный жанажол" in normalized and normalized.startswith(("ввод 35", "ввод-35"))
    )


def _external_group(label: str) -> str:
    normalized = label.casefold().replace("ё", "е")
    if "кожасай" in normalized:
        return "Кожасай"
    if "газзавод" in normalized:
        return "Газзавод"
    if "площадка №4" in normalized or "площадка n4" in normalized:
        return "Площадка №4"
    return "Площадка №22 / СУПС"


def _controlled_supply_source(label: str) -> dict[str, str] | None:
    normalized = label.casefold().replace("ё", "е")
    if "эмба" in normalized:
        return {"id": "emba", "name": "ПС Эмба"}
    if "кенкияк" in normalized:
        return {"id": "kenkiyak", "name": "ПС Кенкияк"}
    if "южный жанажол" in normalized:
        return {"id": "yuzhny-zhanazhol", "name": "Южный Жанажол"}
    if _is_controlled_supply(label):
        return {"id": re.sub(r"[^a-zа-я0-9]+", "-", normalized).strip("-"), "name": label}
    return None


def _is_daily_load_section_start(label: str) -> bool:
    normalized = label.casefold().replace("ё", "е").strip()
    return (
        ("отходящ" in normalized and "итого" not in normalized)
        or normalized.startswith("итого по ввод")
        or normalized.startswith("итого получено")
        or normalized in {"итого:", "итого"}
    )


def _is_daily_load_section_end(label: str) -> bool:
    normalized = label.casefold().replace("ё", "е").strip()
    return "итого" in normalized and (
        "отходящ" in normalized
        or re.search(r"\bпо\s+яч", normalized) is not None
    )


def _is_daily_load_point(label: str) -> bool:
    normalized = label.casefold().replace("ё", "е").strip()
    if not normalized or _is_controlled_supply(label):
        return False
    if any(marker in normalized for marker in ("итого", "наименование", "реактив")):
        return False
    if normalized.startswith(("ввод", "юг. ввод", "пс север вв")):
        return False
    if re.match(r"^яч[^а-яa-z0-9]*[\d№.\s-]*ввод\b", normalized):
        return False
    return True


def _daily_load_group(label: str) -> str:
    normalized = label.casefold().replace("ё", "е")
    if normalized.startswith("вл ") or " 35 кв" in normalized:
        return "Отходящая линия 35 кВ"
    if "6 кв" in normalized or normalized.startswith(("яч", "яч.")):
        return "Объект нагрузки 6 кВ"
    return "Объект нагрузки"


def _daily_load_id(cells: list[object], label: str) -> str:
    meter_number = _normalize_meter_number(cells[2] if len(cells) > 2 else None)
    if meter_number:
        channel = "reactive" if "реактив" in label.casefold() else "active"
        return f"daily-meter-{_slug(meter_number)}-{channel}"
    return f"daily-load-{_slug(label)}"


def _add_month(period: str) -> tuple[int, int, str]:
    year, month = (int(part) for part in period.split("-"))
    if month == 12:
        return year + 1, 1, f"{year + 1:04d}-01"
    return year, month + 1, f"{year:04d}-{month + 1:02d}"


def _days_in_period(period: str) -> int:
    year, month = (int(part) for part in period.split("-"))
    return monthrange(year, month)[1]


def _mean(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    avg = _mean(values)
    return math.sqrt(sum((value - avg) ** 2 for value in values) / (len(values) - 1))


def _clamp(value: float, low: float, high: float) -> float:
    return min(high, max(low, value))


def _solve_linear_system(matrix: list[list[float]], vector: list[float]) -> list[float] | None:
    size = len(vector)
    augmented = [matrix[row][:] + [vector[row]] for row in range(size)]
    for column in range(size):
        pivot = max(range(column, size), key=lambda row: abs(augmented[row][column]))
        if abs(augmented[pivot][column]) < 1e-9:
            return None
        augmented[column], augmented[pivot] = augmented[pivot], augmented[column]
        divisor = augmented[column][column]
        augmented[column] = [value / divisor for value in augmented[column]]
        for row in range(size):
            if row == column:
                continue
            factor = augmented[row][column]
            augmented[row] = [
                current - factor * pivot_value
                for current, pivot_value in zip(augmented[row], augmented[column])
            ]
    return [augmented[row][-1] for row in range(size)]


def _fit_weather_model(
    daily_by_period: dict[str, list[dict[str, object]]],
    weather_history: dict[str, dict[str, object]],
) -> dict[str, object]:
    features: list[list[float]] = []
    targets: list[float] = []
    for points in daily_by_period.values():
        for point in points:
            day = str(point["date"])
            weather = weather_history.get(day)
            value = float(point.get("value") or 0)
            if not weather or value <= 0 or weather.get("temperature_2m_mean") is None:
                continue
            temperature = float(weather["temperature_2m_mean"])
            item_date = date.fromisoformat(day)
            features.append(
                [
                    1.0,
                    max(0.0, 18.0 - temperature),
                    max(0.0, temperature - 22.0),
                    1.0 if item_date.weekday() >= 5 else 0.0,
                ]
            )
            targets.append(value)

    if len(features) < 14:
        return {
            "status": "insufficient_data",
            "observations": len(features),
            "heating_kwh_per_degree_day": 0.0,
            "cooling_kwh_per_degree_day": 0.0,
        }

    size = len(features[0])
    matrix = [[0.0] * size for _ in range(size)]
    vector = [0.0] * size
    for row, target in zip(features, targets):
        for left in range(size):
            vector[left] += row[left] * target
            for right in range(size):
                matrix[left][right] += row[left] * row[right]
    for index in range(size):
        matrix[index][index] += 1e-6
    coefficients = _solve_linear_system(matrix, vector)
    if coefficients is None:
        return {
            "status": "insufficient_data",
            "observations": len(features),
            "heating_kwh_per_degree_day": 0.0,
            "cooling_kwh_per_degree_day": 0.0,
        }

    predictions = [sum(value * coefficient for value, coefficient in zip(row, coefficients)) for row in features]
    target_mean = _mean(targets)
    total_variance = sum((value - target_mean) ** 2 for value in targets)
    residual_variance = sum((actual - predicted) ** 2 for actual, predicted in zip(targets, predictions))
    r_squared = 1 - residual_variance / total_variance if total_variance else 0.0
    daily_mean = max(1.0, target_mean)
    return {
        "status": "ready",
        "observations": len(features),
        "heating_kwh_per_degree_day": _clamp(coefficients[1], -daily_mean * 0.08, daily_mean * 0.08),
        "cooling_kwh_per_degree_day": _clamp(coefficients[2], -daily_mean * 0.08, daily_mean * 0.08),
        "weekend_kwh": coefficients[3],
        "r_squared": _clamp(r_squared, 0.0, 1.0),
    }


def _monthly_backtest(monthly_series: list[dict[str, object]]) -> dict[str, object]:
    errors: list[float] = []
    points: list[dict[str, object]] = []
    for previous, actual in zip(monthly_series, monthly_series[1:]):
        previous_total = float(previous.get("total_kwh") or 0)
        actual_total = float(actual.get("total_kwh") or 0)
        if previous_total <= 0 or actual_total <= 0:
            continue
        predicted = previous_total / _days_in_period(str(previous["period"])) * _days_in_period(str(actual["period"]))
        error = abs(predicted - actual_total) / actual_total
        errors.append(error)
        points.append(
            {
                "period": actual["period"],
                "predicted_kwh": predicted,
                "actual_kwh": actual_total,
                "absolute_error_pct": error,
            }
        )
    mape = _mean(errors) if errors else None
    return {
        "status": "ready" if errors else "insufficient_data",
        "mape": mape,
        "accuracy": _clamp(1 - mape, 0.0, 1.0) if mape is not None else None,
        "periods": len(errors),
        "points": points,
    }


def _adjustment_delta(
    item_date: date,
    adjustments: list[dict[str, object]],
) -> tuple[float, list[str]]:
    total = 0.0
    active: list[str] = []
    signs = {"outage": -1.0, "derating": -1.0, "addition": 1.0}
    for adjustment in adjustments:
        try:
            start = date.fromisoformat(str(adjustment["start_date"]))
            end = date.fromisoformat(str(adjustment["end_date"]))
        except (KeyError, ValueError):
            continue
        if not start <= item_date <= end:
            continue
        capacity_kw = max(0.0, float(adjustment.get("capacity_kw") or 0))
        utilization = _clamp(float(adjustment.get("utilization") or 0), 0.0, 1.0)
        sign = signs.get(str(adjustment.get("kind")), 0.0)
        total += sign * capacity_kw * 24 * utilization
        active.append(str(adjustment.get("name") or "Операционное событие"))
    return total, active


def _build_energy_forecast(
    monthly_series: list[dict[str, object]],
    daily_by_period: dict[str, list[dict[str, object]]],
    *,
    adjustments: list[dict[str, object]] | None = None,
    with_weather: bool = False,
    weather_locations: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    if not monthly_series:
        derived_monthly_series = [
            {
                "period": period,
                "total_kwh": sum(float(item.get("value") or 0) for item in points),
                "own_share": 1.0,
                "external_share": 0.0,
            }
            for period, points in sorted(daily_by_period.items())
            if any(float(item.get("value") or 0) > 0 for item in points)
        ]
        if not derived_monthly_series:
            return {
                "status": "insufficient_data",
                "message": "Нет суточной истории или месячного технического баланса для прогноза.",
                "period": None,
                "source_period": None,
                "series": [],
                "scenarios": [],
                "method": [],
            }
        monthly_series = derived_monthly_series
        data_basis = "daily_summary"
    else:
        data_basis = "technical_balance"

    adjustments = adjustments or []
    latest = monthly_series[-1]
    source_period = str(latest["period"])
    forecast_year, forecast_month, forecast_period = _add_month(source_period)
    source_days = _days_in_period(source_period)
    forecast_days = monthrange(forecast_year, forecast_month)[1]
    latest_total = float(latest.get("total_kwh") or 0)
    latest_own_share = float(latest.get("own_share") or 0)
    latest_external_share = float(latest.get("external_share") or 0)

    month_rates: list[float] = []
    for current, previous in zip(monthly_series[1:], monthly_series):
        current_value = float(current.get("total_kwh") or 0)
        previous_value = float(previous.get("total_kwh") or 0)
        if previous_value > 0:
            month_rates.append((current_value - previous_value) / previous_value)
    recent_rates = month_rates[-3:]
    if len(recent_rates) >= 2:
        weights = [0.25, 0.35, 0.4][-len(recent_rates):]
        trend_rate = sum(rate * weight for rate, weight in zip(recent_rates, weights)) / sum(weights)
    else:
        trend_rate = recent_rates[-1] if recent_rates else 0.0
    trend_rate = _clamp(trend_rate, -0.15, 0.15)

    source_daily = list(daily_by_period.get(source_period, []))
    if not source_daily:
        latest_daily_period = max(daily_by_period.keys(), default="")
        source_daily = list(daily_by_period.get(latest_daily_period, []))
    source_daily.sort(key=lambda item: str(item["date"]))
    daily_values = [float(item.get("value") or 0) for item in source_daily if float(item.get("value") or 0) > 0]
    source_daily_total = sum(daily_values)
    source_daily_avg = _mean(daily_values)
    daily_volatility = _stdev(daily_values) / source_daily_avg if source_daily_avg else 0.0

    day_count_adjustment = forecast_days / source_days if source_days else 1.0
    baseline_total = max(0.0, latest_total * day_count_adjustment * (1 + trend_rate))

    weekday_values: dict[int, list[float]] = defaultdict(list)
    for period_points in daily_by_period.values():
        for item in period_points:
            item_date = date.fromisoformat(str(item["date"]))
            value = float(item.get("value") or 0)
            if value > 0:
                weekday_values[item_date.weekday()].append(value)

    forecast_daily_base: list[float] = []
    for day in range(1, forecast_days + 1):
        item_date = date(forecast_year, forecast_month, day)
        weekday_avg = _mean(weekday_values.get(item_date.weekday(), []))
        forecast_daily_base.append(weekday_avg or source_daily_avg or (baseline_total / forecast_days if forecast_days else 0.0))

    profile_total = sum(forecast_daily_base)
    scale = baseline_total / profile_total if profile_total else 1.0

    forecast_start = date(forecast_year, forecast_month, 1)
    forecast_end = date(forecast_year, forecast_month, forecast_days)
    weather_context: dict[str, object] = {
        "status": "disabled",
        "provider": "Open-Meteo",
        "forecast": {},
        "history": {},
    }
    all_daily = [item for points in daily_by_period.values() for item in points]
    if with_weather and all_daily:
        settings = get_settings()
        history_dates = [date.fromisoformat(str(item["date"])) for item in all_daily]
        normalized_locations = [
            {
                "name": str(item.get("name") or item.get("id") or settings.forecast_location_name),
                "latitude": float(item.get("latitude") or settings.forecast_latitude),
                "longitude": float(item.get("longitude") or settings.forecast_longitude),
                "timezone": str(item.get("timezone") or settings.forecast_timezone),
                "weight": max(0.0, float(item.get("weight") or 0)),
            }
            for item in (weather_locations or [])
            if item
        ]
        total_location_weight = sum(float(item["weight"]) for item in normalized_locations)
        if not normalized_locations or total_location_weight <= 0:
            normalized_locations = [
                {
                    "name": settings.forecast_location_name,
                    "latitude": settings.forecast_latitude,
                    "longitude": settings.forecast_longitude,
                    "timezone": settings.forecast_timezone,
                    "weight": 1.0,
                }
            ]
            total_location_weight = 1.0

        location_contexts = [
            (
                item,
                load_weather_context(
                    min(history_dates),
                    max(history_dates),
                    forecast_start,
                    forecast_end,
                    latitude=float(item["latitude"]),
                    longitude=float(item["longitude"]),
                    timezone=str(item["timezone"]),
                    location_name=str(item["name"]),
                ),
            )
            for item in normalized_locations
        ]
        if len(location_contexts) == 1:
            weather_context = location_contexts[0][1]
        else:
            weighted_history: dict[str, dict[str, object]] = {}
            weighted_forecast: dict[str, dict[str, object]] = {}
            for target_name, target in (("history", weighted_history), ("forecast", weighted_forecast)):
                days = sorted({
                    day
                    for _, context in location_contexts
                    for day in (context.get(target_name) or {}).keys()
                })
                for day in days:
                    row: dict[str, object] = {"source": "Open-Meteo · взвешенно по регионам"}
                    for field in (
                        "temperature_2m_mean",
                        "temperature_2m_min",
                        "temperature_2m_max",
                        "precipitation_sum",
                        "wind_speed_10m_max",
                        "temperature_normal",
                    ):
                        values = []
                        for item, context in location_contexts:
                            value = (context.get(target_name) or {}).get(day, {}).get(field)
                            if value is not None:
                                values.append((float(value), float(item["weight"]) / total_location_weight))
                        row[field] = sum(value * weight for value, weight in values) if values else None
                    code_values = [
                        ((context.get(target_name) or {}).get(day, {}).get("weather_code"), float(item["weight"]))
                        for item, context in location_contexts
                        if (context.get(target_name) or {}).get(day, {}).get("weather_code") is not None
                    ]
                    row["weather_code"] = max(code_values, key=lambda entry: entry[1])[0] if code_values else None
                    anomaly_labels = [
                        str((context.get(target_name) or {}).get(day, {}).get("anomaly_label"))
                        for _, context in location_contexts
                        if (context.get(target_name) or {}).get(day, {}).get("is_anomaly")
                    ]
                    row["is_anomaly"] = bool(anomaly_labels)
                    row["anomaly_label"] = anomaly_labels[0] if anomaly_labels else None
                    target[day] = row
            weather_context = {
                "status": "ready" if all((context.get("status") == "ready") for _, context in location_contexts) else "partial",
                "provider": "Open-Meteo",
                "history": weighted_history,
                "forecast": weighted_forecast,
                "location": {
                    "name": f"{len(location_contexts)} регионов · взвешенно",
                    "latitude": None,
                    "longitude": None,
                    "timezone": "mixed",
                },
            }

    weather_history = weather_context.get("history") or {}
    weather_forecast = weather_context.get("forecast") or {}
    weather_model = _fit_weather_model(daily_by_period, weather_history)
    history_daily_mean = source_daily_avg or (_mean([float(item.get("value") or 0) for item in all_daily]) if all_daily else 0)
    model_daily_mean = baseline_total / forecast_days if forecast_days else 0
    boundary_scale = model_daily_mean / history_daily_mean if history_daily_mean else 1.0

    source_boundary_scale = latest_total / source_daily_total if source_daily_total else 1.0
    history_series = []
    for item in source_daily:
        item_date = str(item["date"])
        weather = weather_history.get(item_date) or {}
        metered_value = float(item.get("value") or 0)
        history_series.append(
            {
                "date": item_date,
                "phase": "actual",
                "actual": metered_value * source_boundary_scale,
                "actual_metered": metered_value,
                "temperature": weather.get("temperature_2m_mean"),
                "temperature_actual": weather.get("temperature_2m_mean"),
                "temperature_forecast": None,
                "temperature_min": weather.get("temperature_2m_min"),
                "temperature_max": weather.get("temperature_2m_max"),
                "precipitation": weather.get("precipitation_sum"),
                "wind_speed": weather.get("wind_speed_10m_max"),
                "weather_code": weather.get("weather_code"),
                "weather_source": weather.get("source"),
                "weather_anomaly": bool(weather.get("is_anomaly")),
                "weather_anomaly_label": weather.get("anomaly_label"),
            }
        )

    forecast_series = []
    running_total = 0.0
    weather_effect_total = 0.0
    event_effect_total = 0.0
    for index, base_value in enumerate(forecast_daily_base):
        item_date = forecast_start + timedelta(days=index)
        weather = weather_forecast.get(item_date.isoformat()) or {}
        temperature = weather.get("temperature_2m_mean")
        normal_temperature = weather.get("temperature_normal")
        weather_delta = 0.0
        if (
            weather_model.get("status") == "ready"
            and temperature is not None
            and normal_temperature is not None
        ):
            actual_hdd = max(0.0, 18.0 - float(temperature))
            normal_hdd = max(0.0, 18.0 - float(normal_temperature))
            actual_cdd = max(0.0, float(temperature) - 22.0)
            normal_cdd = max(0.0, float(normal_temperature) - 22.0)
            weather_delta = boundary_scale * (
                float(weather_model["heating_kwh_per_degree_day"]) * (actual_hdd - normal_hdd)
                + float(weather_model["cooling_kwh_per_degree_day"]) * (actual_cdd - normal_cdd)
            )
        scaled_base = base_value * scale
        weather_delta = _clamp(weather_delta, -scaled_base * 0.2, scaled_base * 0.2)
        event_delta, active_events = _adjustment_delta(item_date, adjustments)
        value = max(0.0, scaled_base + weather_delta + event_delta)
        weather_effect_total += weather_delta
        event_effect_total += event_delta
        running_total += value
        forecast_series.append(
            {
                "date": item_date.isoformat(),
                "phase": "forecast",
                "actual": None,
                "value": value,
                "cumulative": running_total,
                "baseline": scaled_base,
                "weather_delta_kwh": weather_delta,
                "event_delta_kwh": event_delta,
                "active_events": active_events,
                "temperature": temperature,
                "temperature_actual": None,
                "temperature_forecast": temperature,
                "temperature_min": weather.get("temperature_2m_min"),
                "temperature_max": weather.get("temperature_2m_max"),
                "precipitation": weather.get("precipitation_sum"),
                "wind_speed": weather.get("wind_speed_10m_max"),
                "weather_code": weather.get("weather_code"),
                "weather_source": weather.get("source"),
                "weather_anomaly": bool(weather.get("is_anomaly")),
                "weather_anomaly_label": weather.get("anomaly_label"),
            }
        )

    forecast_total = sum(float(item["value"]) for item in forecast_series)
    backtest = _monthly_backtest(monthly_series)
    backtest_mape = backtest.get("mape")
    range_pct = _clamp(
        0.045
        + daily_volatility * 0.2
        + (float(backtest_mape) * 0.65 if backtest_mape is not None else 0.06)
        + (0.025 if weather_context.get("status") != "ready" else 0),
        0.06,
        0.25,
    )
    low_total = forecast_total * (1 - range_pct)
    high_total = forecast_total * (1 + range_pct)
    for item in forecast_series:
        item["lower"] = float(item["value"]) * (1 - range_pct)
        item["upper"] = float(item["value"]) * (1 + range_pct)

    confidence = _clamp(
        0.48
        + min(len(monthly_series), 6) * 0.045
        + min(len(daily_values), 31) * 0.003
        + float(weather_model.get("r_squared") or 0) * 0.08
        - (float(backtest_mape) * 0.5 if backtest_mape is not None else 0.06)
        - daily_volatility * 0.12,
        0.4,
        0.75 if data_basis == "daily_summary" else 0.9,
    )
    expected_change = forecast_total / latest_total - 1 if latest_total else None
    source_days_count = len(source_daily)

    return {
        "status": "ready",
        "data_basis": data_basis,
        "period": forecast_period,
        "source_period": source_period,
        "source_days": source_days_count,
        "source_total_kwh": latest_total,
        "forecast_total_kwh": forecast_total,
        "forecast_low_kwh": low_total,
        "forecast_high_kwh": high_total,
        "expected_change_pct": expected_change,
        "trend_rate": trend_rate,
        "day_count_adjustment": day_count_adjustment,
        "confidence": confidence,
        "own_kwh": forecast_total * latest_own_share,
        "external_kwh": forecast_total * latest_external_share,
        "own_share": latest_own_share,
        "external_share": latest_external_share,
        "baseline_total_kwh": baseline_total,
        "weather_effect_kwh": weather_effect_total,
        "event_effect_kwh": event_effect_total,
        "daily_controlled_total_kwh": forecast_total,
        "backtest": backtest,
        "weather": {
            "status": weather_context.get("status"),
            "provider": weather_context.get("provider"),
            "location": weather_context.get("location"),
            "message": weather_context.get("message"),
            "model": weather_model,
            "anomaly_days": sum(1 for item in forecast_series if item["weather_anomaly"]),
            "history_anomaly_days": sum(1 for item in history_series if item["weather_anomaly"]),
        },
        "adjustments": adjustments,
        "history_series": history_series,
        "combined_series": [*history_series, *forecast_series],
        "series": forecast_series,
        "scenarios": [
            {"name": "Экономный", "value": low_total, "delta_pct": low_total / latest_total - 1 if latest_total else None},
            {"name": "Базовый", "value": forecast_total, "delta_pct": expected_change},
            {"name": "Пиковый", "value": high_total, "delta_pct": high_total / latest_total - 1 if latest_total else None},
        ],
        "drivers": [
            {"label": "Последний месяц", "value": source_period},
            {"label": "Дней в прогнозе", "value": forecast_days},
            {"label": "Дней дневного профиля", "value": source_days_count},
            {"label": "Тренд", "value": trend_rate},
            {"label": "Погодная поправка", "value": weather_effect_total / baseline_total if baseline_total else 0},
            {"label": "События мощности", "value": event_effect_total / baseline_total if baseline_total else 0},
        ],
        "method": [
            (
                "База: суточная история по контрольным вводам; без техбаланса надёжность ограничена 75%."
                if data_basis == "daily_summary"
                else "База: последний техбаланс, число дней и взвешенный тренд последних месяцев с ограничением ±15%."
            ),
            "Календарь: профиль каждого дня недели строится по всей доступной ежедневной истории.",
            "Погода: модель градусо-дней оценивает чувствительность нагрузки к холоду и жаре; будущая температура поступает из Open-Meteo.",
            "Сценарий: остановки, ввод и снижение мощности дают датированный эффект мощность × 24 ч × загрузка.",
            "Надёжность: средняя ошибка на исторических данных определяет ширину прогнозного диапазона.",
        ],
    }


def build_available_filters(db: Session) -> dict[str, object]:
    published_batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.status == ImportStatus.published)
        .order_by(ImportBatch.created_at.desc())
    ).all()
    periods: set[str] = set()
    dataset_kinds: set[str] = set()
    for batch in published_batches:
        dataset_kinds.add(batch.dataset_kind.value)
        period_info = _period_from_filename(batch.original_filename)
        if period_info is not None:
            periods.add(period_info[0])

    sorted_periods = sorted(periods)
    return {
        "dataset_kinds": sorted(dataset_kinds),
        "periods": sorted_periods,
        "date_from": f"{sorted_periods[0]}-01" if sorted_periods else None,
        "date_to": f"{sorted_periods[-1]}-31" if sorted_periods else None,
        "stations": [],
        "substations": [],
        "asset_types": [],
    }


def build_energy_business_dashboard(
    db: Session,
    station_id: str | None = None,
    substation_id: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    forecast_adjustments: list[dict[str, object]] | None = None,
    forecast_with_weather: bool = False,
    forecast_weather_locations: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    eligible_statuses = (ImportStatus.ready_to_publish, ImportStatus.published)
    technical_batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.dataset_kind == DatasetKind.technical_balance)
        .where(ImportBatch.status.in_(eligible_statuses))
    ).all()
    daily_batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.dataset_kind == DatasetKind.daily_summary)
        .where(ImportBatch.status.in_(eligible_statuses))
    ).all()

    monthly_series: list[dict[str, object]] = []
    technical_details: dict[str, dict[str, object]] = {}
    formula_mismatches = 0

    for batch in technical_batches:
        period_info = _period_from_filename(batch.original_filename)
        if period_info is None:
            continue
        period, month_label, _, _ = period_info
        if not is_period_in_range(parse_period_start_from_filename(batch.original_filename), date_from, date_to):
            continue

        sheets = _rows_by_sheet(db, batch.id)
        main_rows = sheets.get("Тех.Учёт", [])
        summary_index = next(
            (
                index
                for index, (_, cells) in enumerate(main_rows)
                if "итого общее потребление" in _normalized_label(cells)
            ),
            None,
        )
        if summary_index is None:
            continue

        supply_rows = main_rows[max(0, summary_index - 12):summary_index]
        supply_values = [value for _, cells in supply_rows if (value := _consumption(cells)) is not None]
        total_kwh = sum(supply_values)
        reported_total_kwh = _reported_consumption(main_rows[summary_index][1])
        controlled_kwh = sum(
            value
            for _, cells in supply_rows
            if _is_controlled_supply(_label(cells)) and (value := _consumption(cells)) is not None
        )

        external_reported = next(
            (
                _reported_consumption(cells)
                for _, cells in main_rows[summary_index:summary_index + 5]
                if "сторон" in _normalized_label(cells) and _reported_consumption(cells) is not None
            ),
            None,
        )

        external_rows: list[dict[str, object]] = []
        external_groups: dict[str, float] = defaultdict(float)
        external_substations: dict[str, float] = defaultdict(float)
        active_group = "Прочие"
        in_summary_block = False
        external_sheet_rows = sheets.get("Сторонние организации", [])
        for row, cells in external_sheet_rows:
            label = _label(cells)
            normalized = _normalized_label(cells)
            if normalized == "наименование" and len(cells) > 2 and "потребление" in str(cells[2] or "").casefold():
                in_summary_block = True
                continue
            if normalized.startswith("потребление сторонних организаций"):
                if not in_summary_block:
                    active_group = _external_group(label)
                continue

            if in_summary_block:
                if not label or "итого" in normalized:
                    continue
                summary_value = _number(cells[3] if len(cells) > 3 else None)
                if summary_value is None or summary_value <= 0:
                    summary_value = _number(cells[2] if len(cells) > 2 else None)
                if summary_value is None or summary_value <= 0:
                    continue
                meter_number = next(
                    (
                        value
                        for marker, value in SUMMARY_EXTERNAL_METERS.items()
                        if marker in _slug(label).replace("-", " ")
                    ),
                    None,
                )
                company = _company_from_label(label)
                substation = _substation_from_label(label, meter_number) or "Требует уточнения"
                item = {
                    "id": f"external-{_slug(meter_number or label)}",
                    "meter_number": meter_number,
                    "name": label,
                    "value": summary_value,
                    "group": "Отдельные внешние потребители",
                    "company": company,
                    "substation": substation,
                    "source_row": row.row_index,
                }
                external_rows.append(item)
                external_groups[company] += summary_value
                external_substations[substation] += summary_value
                continue

            value = _consumption(cells)
            if not label or value is None or value <= 0 or "итого" in normalized or normalized == "наименование":
                continue
            meter_number = _normalize_meter_number(cells[2] if len(cells) > 2 else None)
            company = _company_from_label(label)
            substation = _substation_from_label(label, meter_number) or _substation_from_group(active_group)
            item = {
                "id": f"external-{_slug(meter_number or label)}",
                "meter_number": meter_number,
                "name": label,
                "value": value,
                "group": active_group,
                "company": company,
                "substation": substation,
                "source_row": row.row_index,
            }
            external_rows.append(item)
            external_groups[company] += value
            external_substations[substation] += value

        for _, cells in [*main_rows, *external_sheet_rows]:
            calculated = _consumption(cells)
            reported = _reported_consumption(cells)
            if calculated is None or reported is None:
                continue
            tolerance = max(0.01, abs(calculated) * 0.0001)
            if abs(reported - calculated) > tolerance:
                formula_mismatches += 1

        external_calculated = sum(float(item["value"]) for item in external_rows)
        external_kwh = external_reported if external_reported is not None else external_calculated
        own_kwh = total_kwh - external_kwh

        outgoing_35kv: list[dict[str, object]] = []
        seen_outgoing: set[str] = set()
        for _, cells in main_rows:
            label = _label(cells)
            normalized = _normalized_label(cells)
            value = _consumption(cells)
            if not normalized.startswith("вл 35 кв") or value is None or value < 0 or normalized in seen_outgoing:
                continue
            seen_outgoing.add(normalized)
            outgoing_35kv.append({"name": label, "value": value})

        monthly_series.append(
            {
                "period": period,
                "label": month_label,
                "total_kwh": total_kwh,
                "reported_total_kwh": reported_total_kwh,
                "recalculation_difference_kwh": total_kwh - reported_total_kwh if reported_total_kwh is not None else None,
                "own_kwh": own_kwh,
                "external_kwh": external_kwh,
                "controlled_kwh": controlled_kwh,
                "own_share": own_kwh / total_kwh if total_kwh else None,
                "external_share": external_kwh / total_kwh if total_kwh else None,
                "batch_id": batch.id,
            }
        )
        technical_details[period] = {
            "external_rows": external_rows,
            "external_groups": [{"name": name, "value": value} for name, value in external_groups.items()],
            "external_substations": [
                {"name": name, "value": value}
                for name, value in external_substations.items()
            ],
            "outgoing_35kv": outgoing_35kv,
        }

    monthly_series.sort(key=lambda item: str(item["period"]))

    daily_series: list[dict[str, object]] = []
    daily_loads_by_period: dict[str, dict[str, dict[str, object]]] = defaultdict(dict)
    negative_intervals = 0
    incomplete_intervals = 0
    for batch in daily_batches:
        period_info = _period_from_filename(batch.original_filename)
        if period_info is None:
            continue
        _, _, year, _ = period_info
        for sheet_name, rows in _rows_by_sheet(db, batch.id).items():
            match = re.fullmatch(r"(\d{2})\.(\d{2})", sheet_name.strip())
            if match is None:
                continue
            day, month = int(match.group(1)), int(match.group(2))
            try:
                sheet_date = date(year, month, day)
            except ValueError:
                continue
            if date_from and sheet_date < date_from:
                continue
            if date_to and sheet_date > date_to:
                continue

            period = f"{year:04d}-{month:02d}"
            controlled_total = 0.0
            source_totals: dict[str, dict[str, object]] = {}
            in_load_section = False
            active_substation = "ПС 110/35/6 кВ Казахойл"
            for _, cells in rows:
                label = _label(cells)
                meter_number = _normalize_meter_number(cells[2] if len(cells) > 2 else None)
                inferred_substation = _substation_from_label(label, meter_number)
                if inferred_substation:
                    active_substation = inferred_substation
                if _is_daily_load_section_end(label):
                    in_load_section = False
                    continue
                if _is_daily_load_section_start(label):
                    in_load_section = True
                    continue
                coefficient = _number(cells[4]) if len(cells) > 4 else None
                current_reading = _number(cells[5]) if len(cells) > 5 else None
                next_reading = _number(cells[6]) if len(cells) > 6 else None
                value = _consumption(cells)
                if coefficient is not None and _is_controlled_supply(label) and (current_reading is None or next_reading is None):
                    incomplete_intervals += 1
                if value is not None and value < 0:
                    negative_intervals += 1
                if value is not None and _is_controlled_supply(label):
                    controlled_total += value
                    source = _controlled_supply_source(label)
                    if source is not None:
                        source_id = source["id"]
                        current = source_totals.setdefault(
                            source_id,
                            {"id": source_id, "name": source["name"], "value": 0.0},
                        )
                        current["value"] = float(current["value"]) + value
                if (
                    in_load_section
                    and value is not None
                    and value > 0
                    and _is_daily_load_point(label)
                ):
                    load_id = _daily_load_id(cells, label)
                    load = daily_loads_by_period[period].setdefault(
                        load_id,
                        {
                            "id": load_id,
                            "name": label,
                            "value": 0.0,
                            "group": _daily_load_group(label),
                            "company": _company_from_label(label),
                            "meter_number": meter_number,
                            "substation": active_substation,
                            "source": "daily_summary",
                            "kind": "load_point",
                            "period": period,
                            "days": 0,
                        },
                    )
                    load["value"] = float(load["value"]) + value
                    load["days"] = int(load["days"]) + 1

            daily_series.append(
                {
                    "date": sheet_date.isoformat(),
                    "period": period,
                    "value": controlled_total,
                    "sources": sorted(source_totals.values(), key=lambda item: str(item["name"])),
                    "batch_id": batch.id,
                }
            )
    daily_series.sort(key=lambda item: str(item["date"]))

    daily_by_period: dict[str, list[dict[str, object]]] = defaultdict(list)
    for point in daily_series:
        daily_by_period[str(point["period"])].append(point)
    forecast = _build_energy_forecast(
        monthly_series,
        daily_by_period,
        adjustments=forecast_adjustments,
        with_weather=forecast_with_weather,
        weather_locations=forecast_weather_locations,
    )

    reconciliation: list[dict[str, object]] = []
    for month in monthly_series:
        period = str(month["period"])
        daily_total = sum(float(point["value"]) for point in daily_by_period.get(period, []))
        monthly_controlled = float(month["controlled_kwh"])
        difference = daily_total - monthly_controlled
        reconciliation.append(
            {
                "period": period,
                "label": month["label"],
                "daily_kwh": daily_total,
                "monthly_kwh": monthly_controlled,
                "difference_kwh": difference,
                "difference_pct": difference / monthly_controlled if monthly_controlled else None,
                "days": len(daily_by_period.get(period, [])),
            }
        )

    latest = monthly_series[-1] if monthly_series else None
    previous = monthly_series[-2] if len(monthly_series) > 1 else None
    latest_details = technical_details.get(str(latest["period"]), {}) if latest else {}
    technical_consumers = list(latest_details.get("external_rows", []))
    for item in technical_consumers:
        item.setdefault("source", "technical_balance")
        item.setdefault("kind", "external_consumer")
    latest_daily_period = max(daily_loads_by_period.keys(), default="")
    daily_consumers = list(daily_loads_by_period.get(latest_daily_period, {}).values())
    consumers = technical_consumers or daily_consumers
    consumer_source = (
        "technical_balance"
        if technical_consumers
        else "daily_summary"
        if daily_consumers
        else None
    )
    top_external = sorted(consumers, key=lambda item: float(item["value"]), reverse=True)[:8]
    outgoing_35kv = sorted(latest_details.get("outgoing_35kv", []), key=lambda item: float(item["value"]), reverse=True)
    external_groups = sorted(latest_details.get("external_groups", []), key=lambda item: float(item["value"]), reverse=True)
    external_substations = sorted(
        latest_details.get("external_substations", []),
        key=lambda item: float(item["value"]),
        reverse=True,
    )

    latest_total = float(latest["total_kwh"]) if latest else 0.0
    previous_total = float(previous["total_kwh"]) if previous else 0.0
    mom_change = (latest_total - previous_total) / previous_total if previous_total else None
    peak_day = max(daily_series, key=lambda item: float(item["value"])) if daily_series else None
    latest_external = float(latest["external_kwh"]) if latest else 0.0
    latest_reported = float(latest["reported_total_kwh"]) if latest and latest["reported_total_kwh"] is not None else None
    latest_recalculation_difference = latest_total - latest_reported if latest_reported is not None else None
    external_detail_total = sum(float(item.get("value") or 0) for item in external_substations)
    external_detail_difference = latest_external - external_detail_total

    if forecast.get("status") == "ready":
        forecast_total = float(forecast.get("forecast_total_kwh") or 0)
        forecast_own = float(forecast.get("own_kwh") or 0)
        forecast_external = float(forecast.get("external_kwh") or 0)
        forecast["segments"] = [
            {
                "id": "kazakhoil",
                "name": "Казахойл",
                "value": forecast_own,
                "share": forecast_own / forecast_total if forecast_total else 0,
            },
            {
                "id": "external",
                "name": "Внешние потребители",
                "value": forecast_external,
                "share": forecast_external / forecast_total if forecast_total else 0,
            },
        ]
        substation_basis = external_detail_total or latest_external
        forecast["substations"] = [
            {
                "id": _slug(str(item["name"])),
                "name": item["name"],
                "source_kwh": float(item["value"]),
                "share": float(item["value"]) / substation_basis if substation_basis else 0,
                "forecast_kwh": forecast_external * float(item["value"]) / substation_basis if substation_basis else 0,
            }
            for item in external_substations
        ]

    direction = "вырос" if (mom_change or 0) >= 0 else "снизился"
    change_text = f"{abs((mom_change or 0) * 100):.1f}".replace(".", ",")
    external_share_text = f"{latest_external / latest_total * 100 if latest_total else 0:.1f}".replace(".", ",")
    latest_month_name = MONTHS_PREPOSITIONAL.get(int(str(latest["period"])[5:7]), str(latest["label"]).casefold()) if latest else ""
    insight = (
        f"В {latest_month_name} общий вход {direction} на {change_text}% к предыдущему месяцу. "
        f"Сторонние организации занимают {external_share_text}%."
        if latest
        else "Недостаточно данных для бизнес-аналитики."
    )

    return {
        "meta": {
            "technical_batches": len(technical_batches),
            "daily_batches": len(daily_batches),
            "latest_period": latest["period"] if latest else None,
            "latest_label": latest["label"] if latest else None,
            "metric_boundary": "monthly total supply; daily controlled inputs",
            "consumer_source": consumer_source,
            "daily_sources_semantics": "controlled_supply_inputs_not_consumers",
            "filters": {
                "station_id": station_id,
                "substation_id": substation_id,
                "date_from": date_from.isoformat() if date_from else None,
                "date_to": date_to.isoformat() if date_to else None,
            },
        },
        "kpis": {
            "total_kwh": latest_total,
            "own_kwh": float(latest["own_kwh"]) if latest else 0.0,
            "external_kwh": latest_external,
            "own_share": float(latest["own_share"]) if latest and latest["own_share"] is not None else None,
            "external_share": float(latest["external_share"]) if latest and latest["external_share"] is not None else None,
            "mom_change": mom_change,
            "coverage_days": len(daily_series),
            "negative_intervals": negative_intervals,
            "incomplete_intervals": incomplete_intervals,
            "peak_day": peak_day,
        },
        "monthly_series": monthly_series,
        "daily_series": daily_series,
        "outgoing_35kv": outgoing_35kv,
        "external_groups": external_groups,
        "external_substations": external_substations,
        "external_consumers": sorted(consumers, key=lambda item: float(item["value"]), reverse=True),
        "top_external_consumers": top_external,
        "reconciliation": reconciliation,
        "forecast": forecast,
        "data_quality": {
            "negative_intervals": negative_intervals,
            "incomplete_intervals": incomplete_intervals,
            "formula_mismatches": formula_mismatches,
            "reported_total_kwh": latest_reported,
            "recalculation_difference_kwh": latest_recalculation_difference,
            "recalculation_difference_pct": latest_recalculation_difference / latest_reported if latest_reported and latest_recalculation_difference is not None else None,
            "external_detail_total_kwh": external_detail_total,
            "external_detail_difference_kwh": external_detail_difference,
            "external_detail_complete": abs(external_detail_difference) <= max(1.0, abs(latest_external) * 0.0001),
        },
        "insight": insight,
        "warnings": [
            "Стоимость не рассчитана: billable boundary и правило тарификации не утверждены.",
            "Daily/monthly сверка выполнена только по общей контрольной границе трёх вводов.",
        ],
    }


def _latest_eligible_batch(db: Session, dataset_kind: DatasetKind) -> ImportBatch | None:
    batches = db.scalars(
        select(ImportBatch)
        .where(ImportBatch.dataset_kind == dataset_kind)
        .where(ImportBatch.status.in_((ImportStatus.ready_to_publish, ImportStatus.published)))
    ).all()
    dated = [
        (period_info[0], batch)
        for batch in batches
        if (period_info := _period_from_filename(batch.original_filename)) is not None
    ]
    return max(dated, key=lambda item: item[0])[1] if dated else None


def build_technical_balance_dashboard(db: Session) -> dict[str, object]:
    batch = _latest_eligible_batch(db, DatasetKind.technical_balance)
    energy = build_energy_business_dashboard(db)
    if batch is None:
        return {
            "meta": {"dataset_kind": DatasetKind.technical_balance.value},
            "kpis": {},
            "series": [],
            "breakdowns": [],
            "table": [],
            "insight": "Технический баланс ещё не загружен.",
            "warnings": ["Загрузите технический баланс."],
        }

    main_rows = _rows_by_sheet(db, batch.id).get("Тех.Учёт", [])
    active_substation = "ПС 110/35/6 кВ Казахойл"
    table: list[dict[str, object]] = []
    for row, cells in main_rows:
        label = _label(cells)
        normalized = _normalized_label(cells)
        meter_number = _normalize_meter_number(cells[2] if len(cells) > 2 else None)
        inferred_substation = _substation_from_label(label, meter_number)
        if inferred_substation:
            active_substation = inferred_substation
        value = _consumption(cells)
        if (
            not label
            or value is None
            or "итого" in normalized
            or normalized.startswith(("потери", "сторонние организации"))
        ):
            continue
        table.append(
            {
                "id": f"technical-{row.row_index}-{_slug(meter_number or label)}",
                "row": row.row_index,
                "name": label,
                "meter_number": meter_number,
                "meter_type": cells[1] if len(cells) > 1 else None,
                "coefficient": _number(cells[4] if len(cells) > 4 else None),
                "previous": _number(cells[5] if len(cells) > 5 else None),
                "current": _number(cells[6] if len(cells) > 6 else None),
                "value": value,
                "substation": active_substation,
            }
        )

    ranked = sorted(table, key=lambda item: abs(float(item["value"])), reverse=True)
    kpis = energy.get("kpis") or {}
    period_info = _period_from_filename(batch.original_filename)
    return {
        "meta": {
            "dataset_kind": DatasetKind.technical_balance.value,
            "batch_id": batch.id,
            "filename": batch.original_filename,
            "period": period_info[0] if period_info else None,
        },
        "kpis": {
            "total_kwh": kpis.get("total_kwh", 0),
            "own_kwh": kpis.get("own_kwh", 0),
            "external_kwh": kpis.get("external_kwh", 0),
            "objects": len(table),
        },
        "series": [
            {"name": item["name"], "value": item["value"], "substation": item["substation"]}
            for item in ranked[:30]
        ],
        "breakdowns": energy.get("external_substations") or [],
        "table": ranked,
        "insight": "Показания пересчитаны независимо по коэффициенту каждого прибора учёта.",
        "warnings": energy.get("warnings") or [],
    }


def build_daily_consumption_dashboard(db: Session) -> dict[str, object]:
    batch = _latest_eligible_batch(db, DatasetKind.daily_summary)
    if batch is None:
        return {
            "meta": {"dataset_kind": DatasetKind.daily_summary.value},
            "kpis": {},
            "series": [],
            "breakdowns": [],
            "table": [],
            "insight": "Ежедневная сводка ещё не загружена.",
            "warnings": ["Загрузите ежедневную сводку."],
        }

    loads: dict[str, dict[str, object]] = {}
    daily_totals: list[dict[str, object]] = []
    sheets = _rows_by_sheet(db, batch.id)
    period_info = _period_from_filename(batch.original_filename)
    period = period_info[0] if period_info else None
    for sheet_name, rows in sheets.items():
        controlled_total = 0.0
        in_load_section = False
        active_substation = "ПС 110/35/6 кВ Казахойл"
        for _, cells in rows:
            label = _label(cells)
            meter_number = _normalize_meter_number(cells[2] if len(cells) > 2 else None)
            inferred_substation = _substation_from_label(label, meter_number)
            if inferred_substation:
                active_substation = inferred_substation
            if _is_daily_load_section_end(label):
                in_load_section = False
                continue
            if _is_daily_load_section_start(label):
                in_load_section = True
                continue
            value = _consumption(cells)
            if value is not None and _is_controlled_supply(label):
                controlled_total += value
            if not in_load_section or value is None or value <= 0 or not _is_daily_load_point(label):
                continue
            load_id = _daily_load_id(cells, label)
            load = loads.setdefault(
                load_id,
                {
                    "id": load_id,
                    "name": label,
                    "meter_number": meter_number,
                    "substation": active_substation,
                    "value": 0.0,
                    "days": 0,
                },
            )
            load["value"] = float(load["value"]) + value
            load["days"] = int(load["days"]) + 1
        daily_totals.append({"date": sheet_name, "value": controlled_total})

    table = sorted(loads.values(), key=lambda item: float(item["value"]), reverse=True)
    substation_totals: dict[str, float] = defaultdict(float)
    for item in table:
        substation_totals[str(item["substation"])] += float(item["value"])
    peak = max(daily_totals, key=lambda item: float(item["value"]), default=None)
    return {
        "meta": {
            "dataset_kind": DatasetKind.daily_summary.value,
            "batch_id": batch.id,
            "filename": batch.original_filename,
            "period": period,
        },
        "kpis": {
            "days": len(sheets),
            "objects": len(table),
            "total_kwh": sum(float(item["value"]) for item in table),
            "peak_day": peak,
        },
        "series": [
            {"name": item["name"], "value": item["value"], "substation": item["substation"]}
            for item in table[:30]
        ],
        "breakdowns": [
            {"name": name, "value": value}
            for name, value in sorted(substation_totals.items(), key=lambda item: item[1], reverse=True)
        ],
        "table": table,
        "insight": "Счётчики ранжированы по суммарному расходу за последний загруженный месяц.",
        "warnings": [],
    }


def build_import_result(db: Session, batch: ImportBatch) -> dict[str, object]:
    rows = db.scalars(
        select(StagingRow)
        .where(StagingRow.batch_id == batch.id)
        .order_by(StagingRow.id.asc())
    ).all()
    sheet_rows: dict[str, int] = defaultdict(int)
    sheet_numeric_rows: dict[str, int] = defaultdict(int)
    preview_rows: list[dict[str, object]] = []
    numeric_series: list[dict[str, object]] = []
    non_empty_rows = 0
    numeric_rows = 0

    for row in rows:
        cells = _row_cells(row.raw_json)
        sheet_rows[row.sheet_name] += 1
        visible_cells = [cell for cell in cells if cell not in (None, "")]
        if visible_cells:
            non_empty_rows += 1
            if len(preview_rows) < 24:
                preview_rows.append(
                    {
                        "sheet": row.sheet_name,
                        "row_index": row.row_index,
                        "values": visible_cells[:8],
                    }
                )

        numbers = [number for cell in cells if (number := _number(cell)) is not None]
        if not numbers:
            continue
        numeric_rows += 1
        sheet_numeric_rows[row.sheet_name] += 1
        labels = [
            str(cell).strip()
            for cell in cells
            if isinstance(cell, str) and cell.strip() and _number(cell) is None
        ]
        if labels:
            label = labels[0]
            if len(label) > 72:
                label = f"{label[:69]}…"
            numeric_series.append(
                {
                    "label": label,
                    "value": numbers[-1],
                    "sheet": row.sheet_name,
                    "row_index": row.row_index,
                }
            )

    sheet_distribution = [
        {
            "sheet": sheet,
            "rows": count,
            "numeric_rows": sheet_numeric_rows[sheet],
        }
        for sheet, count in sheet_rows.items()
    ]
    series = sorted(
        numeric_series,
        key=lambda item: abs(float(item["value"])),
        reverse=True,
    )[:12]

    return {
        "batch": batch,
        "summary": {
            "total_rows": len(rows),
            "non_empty_rows": non_empty_rows,
            "numeric_rows": numeric_rows,
            "total_sheets": len(sheet_distribution),
        },
        "sheet_distribution": sheet_distribution,
        "series": series,
        "preview_rows": preview_rows,
    }
