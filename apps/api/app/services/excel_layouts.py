from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


LABEL_COL = 0
METER_COL = 2
TRANSFORMER_COL = 3
COEFFICIENT_COL = 4
PREVIOUS_COL = 5
CURRENT_COL = 6
CONSUMPTION_COL = 7

ACT_SERIAL_COL = 1
ACT_CONTRACT_COL = 2
ACT_LABEL_COL = 3
ACT_METER_COL = 4
ACT_PREVIOUS_COL = 5
ACT_CURRENT_COL = 6
ACT_DIFF_COL = 7
ACT_COEFFICIENT_COL = 8
ACT_CONSUMPTION_COL = 9
ACT_TOTAL_COL = 10


@dataclass(frozen=True)
class LayoutIssue:
    rule_code: str
    message: str
    sheet_name: str | None = None
    row_index: int | None = None


@dataclass(frozen=True)
class ExcelBlock:
    id: str
    kind: str
    start_row: int
    end_row: int
    title_row: int
    title_col: int

    def contains(self, row_index: int) -> bool:
        return self.start_row <= row_index <= self.end_row


@dataclass(frozen=True)
class ExternalBlock:
    id: str
    start_row: int
    end_row: int
    title_row: int
    title_col: int
    technical_block_id: str | None = None

    def contains(self, row_index: int) -> bool:
        return self.start_row <= row_index <= self.end_row


TECHNICAL_BLOCKS = (
    ExcelBlock("balance_35kv", "balance_section", 294, 305, 294, 1),
    ExcelBlock("substation_35_6_main", "substation", 307, 328, 307, 1),
    ExcelBlock("substation_35_6_bkns", "substation", 454, 470, 454, 2),
)

EXTERNAL_BLOCKS = (
    ExternalBlock("external_block_1", 2, 27, 2, 0),
    ExternalBlock("external_block_2", 29, 59, 29, 0, "substation_35_6_main"),
    ExternalBlock("external_block_3", 61, 71, 61, 0),
    ExternalBlock("external_block_4", 74, 87, 74, 0),
)

EXTERNAL_SUMMARY_ROWS = {
    92: "external_block_1",
    93: "external_block_2",
    94: "external_block_3",
    95: "external_block_4",
}


def _cell(cells: list[object], index: int) -> object | None:
    return cells[index] if len(cells) > index else None


def _text(value: object | None) -> str:
    return " ".join(str(value or "").replace("\u00a0", " ").split())


def _numberish(value: object | None) -> bool:
    if isinstance(value, (int, float)):
        return True
    if value is None:
        return False
    candidate = _text(value).replace(" ", "").replace(",", ".")
    if not candidate:
        return False
    try:
        float(candidate)
    except ValueError:
        return False
    return True


def _value_or_formula(value: object | None) -> bool:
    return isinstance(value, str) and value.startswith("=") or _numberish(value)


def is_meter_row(cells: list[object]) -> bool:
    return (
        bool(_text(_cell(cells, LABEL_COL)))
        and bool(_text(_cell(cells, METER_COL)))
        and _numberish(_cell(cells, COEFFICIENT_COL))
        and _value_or_formula(_cell(cells, CONSUMPTION_COL))
    )


def is_commercial_consumption_row(cells: list[object]) -> bool:
    return (
        _numberish(_cell(cells, ACT_SERIAL_COL))
        and bool(_text(_cell(cells, ACT_LABEL_COL)))
        and bool(_text(_cell(cells, ACT_METER_COL)))
        and _numberish(_cell(cells, ACT_COEFFICIENT_COL))
        and _numberish(_cell(cells, ACT_PREVIOUS_COL))
        and _numberish(_cell(cells, ACT_CURRENT_COL))
        and _value_or_formula(_cell(cells, ACT_CONSUMPTION_COL))
    )


def _rows_by_index(rows: Iterable[tuple[object, list[object]]]) -> dict[int, list[object]]:
    indexed: dict[int, list[object]] = {}
    for row, cells in rows:
        indexed[getattr(row, "row_index")] = cells
    return indexed


def _count_meter_rows(rows_by_index: dict[int, list[object]], start: int, end: int) -> int:
    return sum(1 for index in range(start, end + 1) if is_meter_row(rows_by_index.get(index, [])))


def technical_sheet_score(rows: list[tuple[object, list[object]]]) -> int:
    by_index = _rows_by_index(rows)
    score = 0
    for block in TECHNICAL_BLOCKS:
        if _text(_cell(by_index.get(block.title_row, []), block.title_col)):
            score += 2
        score += min(_count_meter_rows(by_index, block.start_row, block.end_row), 5)
    return score


def external_sheet_score(rows: list[tuple[object, list[object]]]) -> int:
    by_index = _rows_by_index(rows)
    score = 0
    for block in EXTERNAL_BLOCKS:
        if _text(_cell(by_index.get(block.title_row, []), block.title_col)):
            score += 2
        score += min(_count_meter_rows(by_index, block.start_row, block.end_row), 4)
    return score


def commercial_consumption_sheet_score(rows: list[tuple[object, list[object]]]) -> int:
    by_index = _rows_by_index(rows)
    score = 0
    if 4 in by_index:
        populated_header_cells = sum(
            1
            for index in range(ACT_SERIAL_COL, ACT_TOTAL_COL + 1)
            if _text(_cell(by_index[4], index))
        )
        score += min(populated_header_cells, 6)
    score += min(
        sum(1 for index in range(5, 220) if is_commercial_consumption_row(by_index.get(index, []))),
        20,
    )
    return score


def select_technical_sheet(
    sheets: dict[str, list[tuple[object, list[object]]]],
) -> list[tuple[object, list[object]]]:
    scored = [(technical_sheet_score(rows), rows) for rows in sheets.values()]
    best_score, best_rows = max(scored, key=lambda item: item[0], default=(0, []))
    if best_score > 0:
        return best_rows
    return next(iter(sheets.values()), [])


def select_external_sheet(
    sheets: dict[str, list[tuple[object, list[object]]]],
    technical_rows: list[tuple[object, list[object]]] | None = None,
) -> list[tuple[object, list[object]]]:
    technical_ids = {id(row) for row in technical_rows or []}
    candidates = [
        rows
        for rows in sheets.values()
        if not technical_ids or not any(id(row) in technical_ids for row in rows)
    ]
    scored = [(external_sheet_score(rows), rows) for rows in candidates]
    best_score, best_rows = max(scored, key=lambda item: item[0], default=(0, []))
    if best_score > 0:
        return best_rows
    return candidates[0] if candidates else []


def _title_from_rows(
    rows_by_index: dict[int, list[object]],
    title_row: int,
    title_col: int,
    fallback: str,
) -> str:
    return _text(_cell(rows_by_index.get(title_row, []), title_col)) or fallback


def technical_context_for_row(
    row_index: int,
    technical_rows: list[tuple[object, list[object]]],
) -> str | None:
    rows_by_index = _rows_by_index(technical_rows)
    for block in TECHNICAL_BLOCKS:
        if block.contains(row_index):
            return _title_from_rows(rows_by_index, block.title_row, block.title_col, block.id)
    return None


def external_context_for_row(
    row_index: int,
    external_rows: list[tuple[object, list[object]]],
    technical_rows: list[tuple[object, list[object]]],
) -> str | None:
    external_by_index = _rows_by_index(external_rows)
    technical_by_id = {block.id: block for block in TECHNICAL_BLOCKS}
    technical_by_index = _rows_by_index(technical_rows)
    block_id = EXTERNAL_SUMMARY_ROWS.get(row_index)
    block = next(
        (
            candidate
            for candidate in EXTERNAL_BLOCKS
            if candidate.id == block_id or candidate.contains(row_index)
        ),
        None,
    )
    if block is None:
        return None
    if block.technical_block_id and block.technical_block_id in technical_by_id:
        technical_block = technical_by_id[block.technical_block_id]
        return _title_from_rows(
            technical_by_index,
            technical_block.title_row,
            technical_block.title_col,
            technical_block.id,
        )
    return _title_from_rows(external_by_index, block.title_row, block.title_col, block.id)


def detect_workbook_kind(
    sheet_names: list[str],
    rows_by_sheet: dict[str, list[tuple[object, list[object]]]],
) -> str:
    if any("." in name.strip() and len(name.strip()) <= 5 for name in sheet_names):
        return "daily_summary"
    if any(technical_sheet_score(rows) >= 8 for rows in rows_by_sheet.values()):
        return "technical_balance"
    if any(commercial_consumption_sheet_score(rows) >= 12 for rows in rows_by_sheet.values()):
        return "commercial_consumption"
    return "unknown"


def technical_layout_issues(
    rows_by_sheet: dict[str, list[tuple[object, list[object]]]],
) -> list[LayoutIssue]:
    technical_rows = select_technical_sheet(rows_by_sheet)
    if not technical_rows:
        return [
            LayoutIssue(
                "TECHNICAL_LAYOUT_NOT_FOUND",
                "Не найден лист технического баланса с ожидаемой сеткой строк и колонок.",
            )
        ]
    by_index = _rows_by_index(technical_rows)
    issues: list[LayoutIssue] = []
    for row_index in (294, 295, 296, 307, 308, 323, 328):
        if row_index not in by_index:
            issues.append(
                LayoutIssue(
                    "TECHNICAL_REQUIRED_ROW_MISSING",
                    f"В шаблоне техбаланса не найдена обязательная строка {row_index}.",
                    row_index=row_index,
                )
            )
    for start, end in ((294, 305), (307, 328)):
        if _count_meter_rows(by_index, start, end) == 0:
            issues.append(
                LayoutIssue(
                    "TECHNICAL_METER_BLOCK_EMPTY",
                    f"В диапазоне строк {start}:{end} не найдены строки приборов с колонками A/C/E/H.",
                    row_index=start,
                )
            )
    return issues


def commercial_consumption_layout_issues(
    rows_by_sheet: dict[str, list[tuple[object, list[object]]]],
) -> list[LayoutIssue]:
    scored = [(commercial_consumption_sheet_score(rows), rows) for rows in rows_by_sheet.values()]
    score, rows = max(scored, key=lambda item: item[0], default=(0, []))
    if score < 12:
        return [
            LayoutIssue(
                "COMMERCIAL_CONSUMPTION_LAYOUT_NOT_FOUND",
                "Не найден лист акта потребления с ожидаемой сеткой: заголовки в строке 4, данные с 5-й строки, колонки B:J.",
            )
        ]
    by_index = _rows_by_index(rows)
    if sum(1 for index in range(5, 220) if is_commercial_consumption_row(by_index.get(index, []))) == 0:
        return [
            LayoutIssue(
                "COMMERCIAL_CONSUMPTION_ROWS_MISSING",
                "В акте потребления не найдены строки приборов с колонками B/D/E/F/G/I/J.",
                row_index=5,
            )
        ]
    return []
