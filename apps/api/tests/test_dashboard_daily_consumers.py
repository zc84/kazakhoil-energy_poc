from datetime import date, timedelta
import unittest

from app.services.dashboard import (
    _build_energy_forecast,
    _company_from_label,
    _daily_load_id,
    _is_daily_load_point,
    _is_daily_load_section_end,
    _is_daily_load_section_start,
    _normalize_meter_number,
    _substation_from_label,
)
from app.services.ai import sanitize_user_facing_ai_text


class DailyConsumerExtractionTests(unittest.TestCase):
    def test_daily_sections_distinguish_inputs_from_load_points(self) -> None:
        self.assertTrue(_is_daily_load_section_start("Итого по вводам 6 кВ"))
        self.assertTrue(_is_daily_load_section_start("Отходящие линии 6 кВ"))
        self.assertTrue(_is_daily_load_section_end("Итого по отходящим линиям 6 кВ"))
        self.assertTrue(_is_daily_load_point('Яч.212 "Каспий нефть-2"'))
        self.assertTrue(_is_daily_load_point("Яч. 213 БКНС ввод 2 6 кВ"))
        self.assertFalse(_is_daily_load_point('Ввод 110кВ от ПС "Кенкияк"'))
        self.assertFalse(_is_daily_load_point("яч. №2 Ввод 6 кВ № 1"))
        self.assertFalse(_is_daily_load_point("Итого по яч 6кВ"))

    def test_meter_number_produces_stable_consumer_id(self) -> None:
        first = ["Каспий нефть", None, 51555226]
        renamed = ['Яч.212 "Каспий нефть-2"', None, 51555226.0]
        self.assertEqual(_daily_load_id(first, first[0]), _daily_load_id(renamed, renamed[0]))

    def test_meter_number_normalization_preserves_text_identifiers(self) -> None:
        self.assertEqual(_normalize_meter_number(51555226.0), "51555226")
        self.assertEqual(_normalize_meter_number(" LM 013843 "), "LM013843")
        self.assertEqual(_normalize_meter_number("50886614-24"), "50886614-24")

    def test_company_aliases_merge_gas_process_spellings(self) -> None:
        labels = [
            'ТОО"GasProces.Comp", В/гор 1',
            'ТОО "GasProcsComp" 0,4кВ ввод-1',
            'Ввод-1 35 кВ 35/6 "GasProsComp"',
        ]
        self.assertEqual({_company_from_label(label) for label in labels}, {"GasProces.Comp"})

    def test_known_meter_resolves_substation(self) -> None:
        self.assertEqual(
            _substation_from_label('Яч.212 "Каспий нефть-2"', "51555226"),
            "ПС 110/35/6 кВ Казахойл",
        )
        self.assertEqual(
            _substation_from_label('яч. №11 "Казтрансойл"', "51555151"),
            "ПС 35/6 кВ Южная",
        )

    def test_forecast_can_use_daily_history_without_technical_balance(self) -> None:
        start = date(2026, 1, 1)
        points = [
            {
                "date": (start + timedelta(days=index)).isoformat(),
                "period": "2026-01",
                "value": 100_000 + index * 100,
            }
            for index in range(31)
        ]

        forecast = _build_energy_forecast([], {"2026-01": points})

        self.assertEqual(forecast["status"], "ready")
        self.assertEqual(forecast["data_basis"], "daily_summary")
        self.assertEqual(forecast["source_period"], "2026-01")
        self.assertLessEqual(forecast["confidence"], 0.75)

    def test_ai_output_does_not_expose_internal_field_names(self) -> None:
        text = (
            "Нет reported_total_kwh; вывод опирается на monthly_series "
            "и reconciliation."
        )

        cleaned = sanitize_user_facing_ai_text(text)

        self.assertNotIn("reported_total_kwh", cleaned)
        self.assertNotIn("monthly_series", cleaned)
        self.assertNotIn("reconciliation", cleaned)
        self.assertIn("итоговый объём из исходного файла", cleaned)


if __name__ == "__main__":
    unittest.main()
