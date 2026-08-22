from __future__ import annotations

import csv
import io
import json
from decimal import Decimal, InvalidOperation
from dataclasses import dataclass
from pathlib import Path

from ..models import DatasetKind, ValidationSeverity
from .excel_layouts import (
    commercial_consumption_layout_issues,
    detect_workbook_kind,
    technical_layout_issues,
)

try:
    import openpyxl
except ImportError:  # pragma: no cover - dependency installed at runtime
    openpyxl = None

try:
    import xlrd
except ImportError:  # pragma: no cover - dependency installed at runtime
    xlrd = None


@dataclass
class ParsedRow:
    sheet_name: str
    row_index: int
    raw_json: str


@dataclass
class ParsedIssue:
    severity: ValidationSeverity
    rule_code: str
    message: str
    sheet_name: str | None = None
    row_index: int | None = None


@dataclass
class ParsedWorkbook:
    dataset_kind: DatasetKind
    total_sheets: int
    rows: list[ParsedRow]
    issues: list[ParsedIssue]


def _normalize_decimal_text(value: str) -> str | None:
    normalized = value.strip().replace("\u00a0", " ")
    normalized = " ".join(normalized.split())
    if not normalized:
        return None
    decimal_candidate = normalized.replace(" ", "").replace(",", ".")
    try:
        parsed = Decimal(decimal_candidate)
    except InvalidOperation:
        return None
    return format(parsed, "f")


def _normalize_cell(value: object) -> object:
    if isinstance(value, str):
        decimal_value = _normalize_decimal_text(value)
        if decimal_value is not None:
            return decimal_value
        return " ".join(value.replace("\u00a0", " ").split())
    return value


def _normalize_row_values(values: list[object]) -> list[object]:
    return [_normalize_cell(value) for value in values]


def parse_file(filename: str, payload: bytes) -> ParsedWorkbook:
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        return _parse_csv(payload)
    if suffix == ".xlsx":
        return _parse_xlsx(payload)
    if suffix == ".xls":
        return _parse_xls(payload)
    return ParsedWorkbook(
        dataset_kind=DatasetKind.unknown,
        total_sheets=0,
        rows=[],
        issues=[
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code="UNSUPPORTED_EXTENSION",
                message=f"Формат файла не поддерживается: {suffix or 'расширение не указано'}.",
            )
        ],
    )


def _detect_dataset_kind(sheet_names: list[str], rows: list[ParsedRow]) -> DatasetKind:
    rows_by_sheet: dict[str, list[tuple[ParsedRow, list[object]]]] = {}
    for row in rows:
        rows_by_sheet.setdefault(row.sheet_name, []).append((row, json.loads(row.raw_json)))
    workbook_kind = detect_workbook_kind(sheet_names, rows_by_sheet)
    if workbook_kind == "daily_summary":
        return DatasetKind.daily_summary
    if workbook_kind == "technical_balance":
        return DatasetKind.technical_balance
    if workbook_kind == "commercial_consumption":
        return DatasetKind.commercial_consumption
    return DatasetKind.unknown


def _parse_csv(payload: bytes) -> ParsedWorkbook:
    text = payload.decode("utf-8-sig", errors="replace")
    reader = csv.reader(io.StringIO(text))
    rows = []
    for index, cells in enumerate(reader, start=1):
        normalized_cells = _normalize_row_values(list(cells))
        rows.append(ParsedRow("csv", index, json.dumps(normalized_cells, ensure_ascii=False)))
    dataset_kind = _detect_dataset_kind(["csv"], rows)
    issues = _basic_issues(["csv"], rows) + _dataset_format_issues(dataset_kind, ["csv"], rows)
    return ParsedWorkbook(
        dataset_kind=dataset_kind,
        total_sheets=1,
        rows=rows,
        issues=issues,
    )


def _parse_xlsx(payload: bytes) -> ParsedWorkbook:
    if openpyxl is None:
        return _missing_dependency("openpyxl")
    workbook = openpyxl.load_workbook(io.BytesIO(payload), data_only=False, read_only=True)
    rows: list[ParsedRow] = []
    for sheet_name in workbook.sheetnames:
        sheet = workbook[sheet_name]
        for row_index, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            normalized = _normalize_row_values(list(row))
            rows.append(
                ParsedRow(sheet_name, row_index, json.dumps(normalized, ensure_ascii=False, default=str))
            )
    dataset_kind = _detect_dataset_kind(workbook.sheetnames, rows)
    issues = _basic_issues(workbook.sheetnames, rows) + _dataset_format_issues(dataset_kind, workbook.sheetnames, rows)
    return ParsedWorkbook(
        dataset_kind=dataset_kind,
        total_sheets=len(workbook.sheetnames),
        rows=rows,
        issues=issues,
    )


def _parse_xls(payload: bytes) -> ParsedWorkbook:
    if xlrd is None:
        return _missing_dependency("xlrd")
    workbook = xlrd.open_workbook(file_contents=payload)
    rows: list[ParsedRow] = []
    for sheet in workbook.sheets():
        for row_index in range(sheet.nrows):
            normalized = _normalize_row_values(list(sheet.row_values(row_index)))
            rows.append(
                ParsedRow(
                    sheet.name,
                    row_index + 1,
                    json.dumps(normalized, ensure_ascii=False, default=str),
                )
            )
    sheet_names = workbook.sheet_names()
    dataset_kind = _detect_dataset_kind(sheet_names, rows)
    issues = _basic_issues(sheet_names, rows) + _dataset_format_issues(dataset_kind, sheet_names, rows)
    return ParsedWorkbook(
        dataset_kind=dataset_kind,
        total_sheets=len(sheet_names),
        rows=rows,
        issues=issues,
    )


def _basic_issues(sheet_names: list[str], rows: list[ParsedRow]) -> list[ParsedIssue]:
    issues: list[ParsedIssue] = []
    if not rows:
        issues.append(
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code="EMPTY_FILE",
                message="В загруженном файле нет строк, доступных для чтения.",
            )
        )
    if not sheet_names:
        issues.append(
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code="NO_SHEETS",
                message="В книге нет доступных листов.",
            )
        )
    return issues


def _dataset_format_issues(
    dataset_kind: DatasetKind,
    sheet_names: list[str],
    rows: list[ParsedRow],
) -> list[ParsedIssue]:
    if not rows:
        return []
    rows_by_sheet: dict[str, list[tuple[ParsedRow, list[object]]]] = {}
    for row in rows:
        rows_by_sheet.setdefault(row.sheet_name, []).append((row, json.loads(row.raw_json)))
    if dataset_kind == DatasetKind.technical_balance:
        return [
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code=issue.rule_code,
                message=issue.message,
                sheet_name=issue.sheet_name,
                row_index=issue.row_index,
            )
            for issue in technical_layout_issues(rows_by_sheet)
        ]
    if dataset_kind == DatasetKind.commercial_consumption:
        return [
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code=issue.rule_code,
                message=issue.message,
                sheet_name=issue.sheet_name,
                row_index=issue.row_index,
            )
            for issue in commercial_consumption_layout_issues(rows_by_sheet)
        ]
    if dataset_kind != DatasetKind.unknown:
        return []
    sheets = ", ".join(sheet_names[:5]) if sheet_names else "нет листов"
    if len(sheet_names) > 5:
        sheets = f"{sheets}, …"
    return [
        ParsedIssue(
            severity=ValidationSeverity.error,
            rule_code="UNSUPPORTED_DATASET_FORMAT",
            message=(
                "Структура файла не соответствует поддерживаемым шаблонам. "
                "Загрузите акт потребления с заголовками в строке 4 и данными с 5-й строки, "
                "ежедневную сводку с дневными листами вида 01.01 или техбаланс "
                "в утверждённом Excel-шаблоне: строки 294:305 для баланса 35 кВ, "
                "строки 307:328 для первого блока ПС 35/6, колонки A/C/E/F/G/H для "
                f"наименования, номера прибора, коэффициента, показаний и расхода. Найденные листы: {sheets}."
            ),
        )
    ]


def _missing_dependency(name: str) -> ParsedWorkbook:
    return ParsedWorkbook(
        dataset_kind=DatasetKind.unknown,
        total_sheets=0,
        rows=[],
        issues=[
            ParsedIssue(
                severity=ValidationSeverity.error,
                rule_code="MISSING_DEPENDENCY",
            message=f"Сервис не готов к обработке этого формата: отсутствует компонент {name}.",
            )
        ],
    )
