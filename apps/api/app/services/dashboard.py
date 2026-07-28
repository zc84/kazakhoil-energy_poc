import json
import math
import re
from calendar import monthrange
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import DatasetKind, ImportBatch, ImportStatus, StagingRow

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
        "insight": "Dashboard currently reflects published import batches and row counts.",
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


def _build_energy_forecast(
    monthly_series: list[dict[str, object]],
    daily_by_period: dict[str, list[dict[str, object]]],
) -> dict[str, object]:
    if not monthly_series:
        return {
            "status": "insufficient_data",
            "message": "Нет месячного технического баланса для прогноза.",
            "period": None,
            "source_period": None,
            "series": [],
            "scenarios": [],
            "method": [],
        }

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
    base_total = latest_total * day_count_adjustment
    forecast_total = max(0.0, base_total * (1 + trend_rate))
    range_pct = _clamp(0.045 + daily_volatility * 0.25 + (0.045 if len(monthly_series) < 3 else 0.0), 0.06, 0.22)
    low_total = forecast_total * (1 - range_pct)
    high_total = forecast_total * (1 + range_pct)

    weekday_values: dict[int, list[float]] = defaultdict(list)
    for item in source_daily:
        item_date = date.fromisoformat(str(item["date"]))
        value = float(item.get("value") or 0)
        if value > 0:
            weekday_values[item_date.weekday()].append(value)

    forecast_daily_base: list[float] = []
    for day in range(1, forecast_days + 1):
        item_date = date(forecast_year, forecast_month, day)
        weekday_avg = _mean(weekday_values.get(item_date.weekday(), []))
        forecast_daily_base.append(weekday_avg or source_daily_avg or (forecast_total / forecast_days if forecast_days else 0.0))

    latest_controlled = float(latest.get("controlled_kwh") or 0)
    target_daily_total = latest_controlled * day_count_adjustment * (1 + trend_rate)
    if not target_daily_total and source_daily_total:
        target_daily_total = source_daily_total * day_count_adjustment * (1 + trend_rate)
    profile_total = sum(forecast_daily_base)
    scale = target_daily_total / profile_total if profile_total else 1.0

    forecast_series = []
    running_total = 0.0
    for index, base_value in enumerate(forecast_daily_base):
        item_date = date(forecast_year, forecast_month, 1) + timedelta(days=index)
        value = max(0.0, base_value * scale)
        running_total += value
        forecast_series.append(
            {
                "date": item_date.isoformat(),
                "value": value,
                "lower": value * (1 - range_pct),
                "upper": value * (1 + range_pct),
                "cumulative": running_total,
            }
        )

    confidence = _clamp(0.52 + min(len(monthly_series), 6) * 0.045 + min(len(daily_values), 31) * 0.004 - daily_volatility * 0.16, 0.45, 0.88)
    expected_change = forecast_total / latest_total - 1 if latest_total else None
    source_days_count = len(source_daily)

    return {
        "status": "ready",
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
        "daily_controlled_total_kwh": target_daily_total,
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
        ],
        "method": [
            "База: общий расход последнего технического баланса, нормированный на число дней следующего месяца.",
            "Тренд: взвешенное изменение последних месячных итогов с ограничением ±15%.",
            "Дневной профиль: форма нагрузки последнего доступного месяца по дням недели.",
            "Коридор: дневная волатильность и длина доступной истории.",
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
        active_group = "Прочие"
        external_sheet_rows = sheets.get("Сторонние организации", [])
        for _, cells in external_sheet_rows:
            label = _label(cells)
            normalized = _normalized_label(cells)
            if normalized.startswith("потребление сторонних организаций"):
                active_group = _external_group(label)
                continue
            value = _consumption(cells)
            if not label or value is None or value <= 0 or "итого" in normalized or normalized == "наименование":
                continue
            external_rows.append({"name": label, "value": value, "group": active_group})
            external_groups[active_group] += value

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
            "outgoing_35kv": outgoing_35kv,
        }

    monthly_series.sort(key=lambda item: str(item["period"]))

    daily_series: list[dict[str, object]] = []
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

            controlled_total = 0.0
            source_totals: dict[str, dict[str, object]] = {}
            for _, cells in rows:
                label = _label(cells)
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

            daily_series.append(
                {
                    "date": sheet_date.isoformat(),
                    "period": f"{year:04d}-{month:02d}",
                    "value": controlled_total,
                    "sources": sorted(source_totals.values(), key=lambda item: str(item["name"])),
                    "batch_id": batch.id,
                }
            )
    daily_series.sort(key=lambda item: str(item["date"]))

    daily_by_period: dict[str, list[dict[str, object]]] = defaultdict(list)
    for point in daily_series:
        daily_by_period[str(point["period"])].append(point)
    forecast = _build_energy_forecast(monthly_series, daily_by_period)

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
    top_external = sorted(latest_details.get("external_rows", []), key=lambda item: float(item["value"]), reverse=True)[:8]
    outgoing_35kv = sorted(latest_details.get("outgoing_35kv", []), key=lambda item: float(item["value"]), reverse=True)
    external_groups = sorted(latest_details.get("external_groups", []), key=lambda item: float(item["value"]), reverse=True)

    latest_total = float(latest["total_kwh"]) if latest else 0.0
    previous_total = float(previous["total_kwh"]) if previous else 0.0
    mom_change = (latest_total - previous_total) / previous_total if previous_total else None
    peak_day = max(daily_series, key=lambda item: float(item["value"])) if daily_series else None
    latest_external = float(latest["external_kwh"]) if latest else 0.0
    latest_reported = float(latest["reported_total_kwh"]) if latest and latest["reported_total_kwh"] is not None else None
    latest_recalculation_difference = latest_total - latest_reported if latest_reported is not None else None

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
        },
        "insight": insight,
        "warnings": [
            "Стоимость не рассчитана: billable boundary и правило тарификации не утверждены.",
            "Daily/monthly сверка выполнена только по общей контрольной границе трёх вводов.",
        ],
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
