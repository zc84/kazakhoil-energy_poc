from io import BytesIO
import unittest

import openpyxl

from app.models import DatasetKind, ValidationSeverity
from app.services.ingestion import parse_file


def workbook_payload(sheet_name: str, rows: list[list[object]]) -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = sheet_name
    for row in rows:
        sheet.append(row)
    payload = BytesIO()
    workbook.save(payload)
    return payload.getvalue()


class IngestionValidationTests(unittest.TestCase):
    def test_unknown_workbook_template_returns_validation_error(self) -> None:
        payload = workbook_payload(
            "Комм. Июль 2026г.",
            [
                ["№ п/п", "Место установки счетчика", "Заводской номер", "Потребление"],
                [1, "ПС Север", "51555209", 100],
            ],
        )

        parsed = parse_file("7. Акт потребления за июль 2026г_.xlsx", payload)

        self.assertEqual(parsed.dataset_kind, DatasetKind.unknown)
        self.assertEqual(len(parsed.rows), 2)
        self.assertTrue(
            any(
                issue.severity == ValidationSeverity.error
                and issue.rule_code == "UNSUPPORTED_DATASET_FORMAT"
                for issue in parsed.issues
            )
        )

    def test_daily_sheet_names_still_pass_validation(self) -> None:
        payload = workbook_payload(
            "01.07",
            [
                ["Итого по вводам 6 кВ"],
                ['Яч.212 "Каспий нефть-2"', "ARTM", 51555226, None, 10, 0, 2, 20],
            ],
        )

        parsed = parse_file("Ежедневная сводка потребления июль 2026.xlsx", payload)

        self.assertEqual(parsed.dataset_kind, DatasetKind.daily_summary)
        self.assertFalse([issue for issue in parsed.issues if issue.severity == ValidationSeverity.error])


if __name__ == "__main__":
    unittest.main()
