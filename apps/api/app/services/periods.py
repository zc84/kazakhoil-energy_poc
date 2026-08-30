from __future__ import annotations

import re
import unicodedata
from calendar import monthrange
from datetime import date, datetime

from ..models import DatasetKind

MONTHS = {
    "январ": 1, "феврал": 2, "март": 3, "апрел": 4, "май": 5,
    "июн": 6, "июл": 7, "август": 8, "сентябр": 9, "октябр": 10,
    "ноябр": 11, "декабр": 12,
}


def parse_date_value(value: object) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        return None
    for pattern in ("%d.%m.%Y", "%d.%m.%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), pattern).date()
        except ValueError:
            pass
    return None


def extract_daily_sheet_date(cells: list[object], sheet_name: str) -> date | None:
    """Extract the end date from a daily sheet header, normally G2."""
    candidates = ([cells[6]] if len(cells) > 6 else []) + cells
    for value in candidates:
        if parsed := parse_date_value(value):
            return parsed
    return None


def period_from_filename(filename: str) -> date | None:
    normalized = unicodedata.normalize("NFC", filename).casefold().replace("ё", "е")
    year_match = re.search(r"(20\d{2})", normalized)
    if not year_match:
        return None
    year = int(year_match.group(1))
    for stem, month in MONTHS.items():
        if stem in normalized:
            return date(year, month, 1)
    return None


def infer_workbook_period(dataset_kind: DatasetKind, filename: str, rows_by_sheet: dict[str, list[list[object]]]):
    issues: list[tuple[str, str, str | None, int | None]] = []
    if dataset_kind != DatasetKind.daily_summary:
        start = period_from_filename(filename)
        end = date(start.year, start.month, monthrange(start.year, start.month)[1]) if start else None
        return start, end, "filename" if start else None, issues

    dates: list[tuple[str, date]] = []
    for sheet_name, rows in rows_by_sheet.items():
        value = extract_daily_sheet_date(rows[1] if len(rows) > 1 else [], sheet_name)
        if value is None:
            issues.append(("PERIOD_NOT_DETECTED", f"Не удалось определить дату листа {sheet_name} из заголовка.", sheet_name, 2))
            continue
        dates.append((sheet_name, value))
        match = re.fullmatch(r"\s*(\d{1,2})\.(\d{1,2})\s*", sheet_name)
        if match and (int(match.group(1)), int(match.group(2))) != (value.day, value.month):
            issues.append(("SHEET_DATE_NAME_MISMATCH", f"Имя листа {sheet_name} не совпадает с датой заголовка {value.isoformat()}.", sheet_name, 2))
    if not dates:
        start = period_from_filename(filename)
        end = date(start.year, start.month, monthrange(start.year, start.month)[1]) if start else None
        return start, end, "filename" if start else None, issues
    unique_dates = sorted({value for _, value in dates})
    if len(unique_dates) != len(dates):
        issues.append(("DUPLICATE_DAILY_DATE", "В книге повторяется дата ежедневной сводки.", None, None))
    start = date(unique_dates[0].year, unique_dates[0].month, 1)
    end = date(unique_dates[-1].year, unique_dates[-1].month, monthrange(unique_dates[-1].year, unique_dates[-1].month)[1])
    return start, end, "workbook_header", issues
