import json
from datetime import date
from pathlib import Path
import tempfile
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import DatasetKind, EnergyPoint, ImportBatch, ImportFile, ImportStatus, StagingRow, ValidationIssue, ValidationSeverity
from app.services.dashboard import build_energy_business_dashboard
from app.services.energy_catalog import seed_default_energy_points


class DashboardEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        with self.Session() as db:
            seed_default_energy_points(db)
        self._seed()

        def override_db():
            with self.Session() as db:
                yield db

        app.dependency_overrides[get_db] = override_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.engine.dispose()

    def _seed(self) -> None:
        with self.Session() as db:
            technical = ImportBatch(
                original_filename="Тех. баланс за март 2026.xls",
                checksum_sha256="a" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                total_sheets=2,
                total_rows=6,
                accepted_rows=6,
            )
            daily = ImportBatch(
                original_filename="Ежедневная сводка потребления март 2026.xlsx",
                checksum_sha256="b" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.daily_summary,
                total_sheets=1,
                total_rows=3,
                accepted_rows=3,
            )
            db.add_all([technical, daily])
            db.flush()
            rows = [
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=1,
                    raw_json=json.dumps(['Ввод 110кВ от ПС "Эмба"', "ARTM", 1001, None, 10, 0, 10, 100]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=2,
                    raw_json=json.dumps(["ИТОГО общее потребление:", None, None, None, None, None, None, 100]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=3,
                    raw_json=json.dumps(["ИТОГО сторонние организации:", None, None, None, None, None, None, 20]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=4,
                    raw_json=json.dumps([None] * 12 + ["ИТОГО - КОА", 5206021.8]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=7,
                    raw_json=json.dumps([None] * 12 + ["скважины, АГЗУ, ТБО", 29498.2]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=12,
                    raw_json=json.dumps([None] * 12 + ["ППН, УДН тыс.кВт.ч.", 214044.48]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=294,
                    raw_json=json.dumps([None] * 12 + ['Месторождение "Кожасай" тыс.кВт.ч., в том числе:', 599460.12]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=56,
                    raw_json=json.dumps(['ПС 35/6 "Северная"']),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Тех.Учёт",
                    row_index=57,
                    raw_json=json.dumps(["Линия 6кВ Север-1", "ARTM", 3001, None, 10, 0, 3, 30]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Сторонние организации",
                    row_index=1,
                    raw_json=json.dumps(["Потребление сторонних организаций м/р Кожасай"]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Сторонние организации",
                    row_index=2,
                    raw_json=json.dumps(['ТОО "GasProcsComp" ввод-1', "ARTM", 2001, None, 10, 0, 1, 10]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Сторонние организации",
                    row_index=3,
                    raw_json=json.dumps(["Наименование", None, "Потребление", "Потребление общее"]),
                ),
                StagingRow(
                    batch_id=technical.id,
                    sheet_name="Сторонние организации",
                    row_index=4,
                    raw_json=json.dumps(['М-е Алибек Южный - Касп.нефть 2', None, 10, 10]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=1,
                    raw_json=json.dumps(['ПС 35/6 "Северная"']),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=2,
                    raw_json=json.dumps(["Итого по вводам 6 кВ"]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=3,
                    raw_json=json.dumps(['Яч.212 "АГЗУ Северная"', "ARTM", 51555226, None, 10, 0, 2, 20]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=4,
                    raw_json=json.dumps(["ПС-110/35/6 кВ Южный Жанажол"]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=5,
                    raw_json=json.dumps(['Яч.999 "Внешняя линия"', "ARTM", 51555999, None, 1, 0, 5, 5]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=6,
                    raw_json=json.dumps(["Итого по отходящим линиям 6 кВ"]),
                ),
            ]
            db.add_all(rows)
            db.commit()

    def test_filters_endpoint_surfaces_ready_to_publish_batches_by_kind(self) -> None:
        response = self.client.get("/api/v1/filters")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("2026-03", payload["periods"])
        self.assertEqual(payload["periods_by_kind"].get("technical_balance"), ["2026-03"])
        self.assertEqual(payload["periods_by_kind"].get("daily_summary"), ["2026-03"])

    def test_technical_balance_endpoint_returns_operational_rows(self) -> None:
        response = self.client.get("/api/v1/dashboards/technical-balance")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meta"]["period"], "2026-03")
        self.assertEqual(payload["kpis"]["external_kwh"], 20)
        self.assertGreaterEqual(len(payload["table"]), 1)
        sever_point = next(item for item in payload["breakdowns"] if item["id"] == "alibekmola-sever")
        self.assertEqual(sever_point["value"], 30.0)
        self.assertTrue(sever_point["resolved"])
        self.assertIn({"name": 'ПС 35/6 "Северная"', "value": 30.0}, sever_point["sources"])
        self.assertEqual(payload["kpis"]["catalog_points_total"], 10)
        self.assertEqual(payload["kpis"]["catalog_points_resolved"], 1)
        self.assertEqual(
            payload["financial_summary"][:3],
            [
                {"id": "financial-4-итого-коа", "row": 4, "name": "ИТОГО - КОА", "value": 5206021.8},
                {"id": "financial-7-скважины-агзу-тбо", "row": 7, "name": "скважины, АГЗУ, ТБО", "value": 29498.2},
                {"id": "financial-12-ппн-удн-тыс-квт-ч", "row": 12, "name": "ППН, УДН тыс.кВт.ч.", "value": 214044.48},
            ],
        )
        self.assertNotIn(294, {item["row"] for item in payload["financial_summary"]})

    def test_technical_balance_deduplicates_repeated_meter_rows(self) -> None:
        with self.Session() as db:
            batch = ImportBatch(
                original_filename="Тех. баланс за апрель 2026.xls",
                checksum_sha256="h" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                total_sheets=1,
                total_rows=3,
                accepted_rows=3,
            )
            db.add(batch)
            db.flush()
            db.add_all([
                StagingRow(
                    batch_id=batch.id,
                    sheet_name="Тех.Учёт",
                    row_index=10,
                    raw_json=json.dumps(['Ввод 110кВ от ПС-110/35/6кВ "Кенкияк"', "ARTM", 51555191, None, 132000, 0, 3.457, 3456829.2]),
                ),
                StagingRow(
                    batch_id=batch.id,
                    sheet_name="Тех.Учёт",
                    row_index=307,
                    raw_json=json.dumps([None, 'П/С 35/6 "Кожасай"']),
                ),
                StagingRow(
                    batch_id=batch.id,
                    sheet_name="Тех.Учёт",
                    row_index=474,
                    raw_json=json.dumps(['Ввод 110кВ от ПС-110/35/6кВ "Кенкияк"', "ARTM", 51555191, None, 132000, 0, 3.457, 3456829.2]),
                ),
            ])
            db.commit()

        response = self.client.get("/api/v1/dashboards/technical-balance")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meta"]["period"], "2026-04")
        rows = [item for item in payload["table"] if item["meter_number"] == "51555191"]
        self.assertEqual(len(rows), 2, "both occurrences stay visible for lineage")
        duplicate_rows = [item for item in rows if item["is_duplicate"]]
        original_rows = [item for item in rows if not item["is_duplicate"]]
        self.assertEqual(len(duplicate_rows), 1)
        self.assertEqual(duplicate_rows[0]["duplicate_of_row"], original_rows[0]["row"])
        kozhasai_point = next(item for item in payload["breakdowns"] if item["id"] == "kozhasai-ps")
        self.assertEqual(
            kozhasai_point["value"], 0.0,
            "the duplicate row (attributed to Kozhasai by row position) must not be double-counted",
        )
        self.assertEqual(payload["kpis"]["duplicate_meter_rows"], 1)

    def test_technical_balance_period_filter_selects_matching_batch(self) -> None:
        with self.Session() as db:
            april_batch = ImportBatch(
                original_filename="Тех. баланс за апрель 2026.xls",
                checksum_sha256="i" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                total_sheets=1,
                total_rows=1,
                accepted_rows=1,
            )
            db.add(april_batch)
            db.flush()
            db.add(StagingRow(
                batch_id=april_batch.id,
                sheet_name="Тех.Учёт",
                row_index=1,
                raw_json=json.dumps(['Ввод 110кВ апрель', "ARTM", 9001, None, 10, 0, 5, 50]),
            ))
            db.commit()

        default_response = self.client.get("/api/v1/dashboards/technical-balance")
        self.assertEqual(default_response.json()["meta"]["period"], "2026-04")

        march_response = self.client.get("/api/v1/dashboards/technical-balance?period=2026-03")
        self.assertEqual(march_response.json()["meta"]["period"], "2026-03")

        missing_response = self.client.get("/api/v1/dashboards/technical-balance?period=2026-01")
        self.assertEqual(missing_response.json()["meta"], {"dataset_kind": "technical_balance"})

    def test_catalog_size_reflects_points_added_and_retired_by_period(self) -> None:
        """The catalog is data (energy_points), not a hardcoded count: a point
        retired mid-year must disappear from later periods but stay visible
        for periods it covered, and a point added later must appear only from
        its active_from onward — proven on periods that already exist
        (March, from `_seed()`) plus two more added here (April, May)."""
        with self.Session() as db:
            april = ImportBatch(
                original_filename="Тех. баланс за апрель 2026.xls",
                checksum_sha256="j" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                total_sheets=1, total_rows=1, accepted_rows=1,
            )
            may = ImportBatch(
                original_filename="Тех. баланс за май 2026.xls",
                checksum_sha256="k" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                total_sheets=1, total_rows=1, accepted_rows=1,
            )
            db.add_all([april, may])
            db.flush()
            db.add_all([
                StagingRow(batch_id=april.id, sheet_name="Тех.Учёт", row_index=1,
                           raw_json=json.dumps(['Ввод апрель', "ARTM", 7001, None, 10, 0, 1, 10])),
                StagingRow(batch_id=may.id, sheet_name="Тех.Учёт", row_index=1,
                           raw_json=json.dumps(['Ввод май', "ARTM", 7002, None, 10, 0, 1, 10])),
            ])

            retiring = db.scalar(select(EnergyPoint).where(EnergyPoint.code == "alibekmola-gazzavod-rp"))
            retiring.active_to = date(2026, 3, 31)
            new_point = EnergyPoint(
                code="alibekmola-new-rp", name="РП-Новая", site="alibekmola", ownership="koa",
                active_from=date(2026, 5, 1),
            )
            db.add(new_point)
            db.commit()

        def totals_and_ids(period: str) -> tuple[int, set[str]]:
            payload = self.client.get(f"/api/v1/dashboards/technical-balance?period={period}").json()
            ids = {item["id"] for item in payload["breakdowns"]}
            return payload["kpis"]["catalog_points_total"], ids

        march_total, march_ids = totals_and_ids("2026-03")
        self.assertEqual(march_total, 10)
        self.assertIn("alibekmola-gazzavod-rp", march_ids)
        self.assertNotIn("alibekmola-new-rp", march_ids)

        april_total, april_ids = totals_and_ids("2026-04")
        self.assertEqual(april_total, 9)
        self.assertNotIn("alibekmola-gazzavod-rp", april_ids)
        self.assertNotIn("alibekmola-new-rp", april_ids)

        may_total, may_ids = totals_and_ids("2026-05")
        self.assertEqual(may_total, 10)
        self.assertNotIn("alibekmola-gazzavod-rp", may_ids)
        self.assertIn("alibekmola-new-rp", may_ids)

    def test_daily_consumption_endpoint_returns_meter_ranking(self) -> None:
        response = self.client.get("/api/v1/dashboards/daily-consumption")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["kpis"]["days"], 1)
        self.assertEqual(payload["kpis"]["objects"], 2)
        self.assertEqual(payload["table"][0]["meter_number"], "51555226")
        self.assertEqual(payload["table"][0]["substation"], 'ПС 35/6 "Северная"')
        self.assertEqual(payload["table"][0]["meter_number_source"], "Столбец C")
        self.assertEqual(payload["table"][0]["consumption_source"], "Расчёт: (G - F) × E")
        self.assertEqual(payload["series"][0]["meter_number"], "51555226")

    def test_energy_dashboard_reconciles_external_detail(self) -> None:
        response = self.client.get("/api/v1/dashboards/energy-business")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["data_quality"]["external_detail_complete"])
        self.assertEqual(payload["data_quality"]["external_detail_difference_kwh"], 0)

    def test_forecast_purchase_scope_excludes_subconsumers(self) -> None:
        with self.Session() as db:
            payload = build_energy_business_dashboard(db)

        forecast = payload["forecast"]
        expected_own_forecast = 80 * 30 / 31
        expected_external_forecast = 20 * 30 / 31

        self.assertEqual(forecast["forecast_scope"], "koa_only")
        self.assertEqual(forecast["daily_profile_basis"], "catalog_koa_stations")
        self.assertAlmostEqual(forecast["source_total_kwh"], 80)
        self.assertAlmostEqual(forecast["source_controlled_total_kwh"], 100)
        self.assertAlmostEqual(forecast["source_external_kwh"], 20)
        self.assertAlmostEqual(forecast["forecast_total_kwh"], expected_own_forecast)
        self.assertAlmostEqual(forecast["own_kwh"], expected_own_forecast)
        self.assertAlmostEqual(forecast["external_kwh"], expected_external_forecast)
        self.assertAlmostEqual(
            forecast["controlled_forecast_total_kwh"],
            expected_own_forecast + expected_external_forecast,
        )

        segments = {item["id"]: item for item in forecast["segments"]}
        self.assertTrue(segments["kazakhoil"]["included_in_purchase_forecast"])
        self.assertFalse(segments["external"]["included_in_purchase_forecast"])
        station_by_id = {item["id"]: item for item in forecast["forecast_stations"]}
        self.assertEqual(len(forecast["forecast_stations"]), 10)
        self.assertNotIn("external-yuzhny-zhanazhol", station_by_id)
        self.assertAlmostEqual(station_by_id["alibekmola-sever"]["value"], 20.0)
        self.assertTrue(station_by_id["alibekmola-sever"]["has_daily_profile"])
        self.assertFalse(station_by_id["alibekmola-gazzavod-ps"]["has_daily_profile"])
        self.assertEqual(station_by_id["alibekmola-gazzavod-ps"]["value"], 0.0)

    def test_delete_failed_import_removes_batch_and_raw_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_file = Path(tmpdir) / "bad.xlsx"
            raw_file.write_bytes(b"bad workbook")
            with self.Session() as db:
                batch = ImportBatch(
                    original_filename="unknown.xlsx",
                    checksum_sha256="c" * 64,
                    status=ImportStatus.needs_review,
                    dataset_kind=DatasetKind.unknown,
                    total_sheets=1,
                    total_rows=1,
                    accepted_rows=1,
                    error_count=1,
                )
                db.add(batch)
                db.flush()
                db.add(ImportFile(
                    batch_id=batch.id,
                    storage_key=str(raw_file),
                    original_filename="unknown.xlsx",
                    file_size_bytes=12,
                ))
                db.add(ValidationIssue(
                    batch_id=batch.id,
                    severity=ValidationSeverity.error,
                    rule_code="UNSUPPORTED_DATASET_FORMAT",
                    message="Шаблон не распознан",
                ))
                batch_id = batch.id
                db.commit()

            response = self.client.delete(f"/api/v1/imports/{batch_id}")

            self.assertEqual(response.status_code, 200)
            self.assertFalse(raw_file.exists())
            self.assertEqual(self.client.get(f"/api/v1/imports/{batch_id}").status_code, 404)

    def test_delete_valid_import_is_rejected(self) -> None:
        response = self.client.delete("/api/v1/imports/1")

        self.assertEqual(response.status_code, 409)

    def test_publish_supersedes_previous_active_period_version(self) -> None:
        with self.Session() as db:
            previous = ImportBatch(
                original_filename="Тех. баланс за март 2026.xls",
                checksum_sha256="d" * 64,
                content_fingerprint="e" * 64,
                status=ImportStatus.published,
                dataset_kind=DatasetKind.technical_balance,
                period_start=date(2026, 3, 1),
                period_end=date(2026, 3, 31),
                published_at=None,
            )
            replacement = ImportBatch(
                original_filename="Тех. баланс за март 2026 v2.xls",
                checksum_sha256="f" * 64,
                content_fingerprint="g" * 64,
                status=ImportStatus.ready_to_publish,
                dataset_kind=DatasetKind.technical_balance,
                period_start=date(2026, 3, 1),
                period_end=date(2026, 3, 31),
            )
            db.add_all([previous, replacement])
            db.commit()
            previous_id = previous.id
            replacement_id = replacement.id

        response = self.client.post(f"/api/v1/imports/{replacement_id}/publish")

        self.assertEqual(response.status_code, 200)
        with self.Session() as db:
            current_previous = db.get(ImportBatch, previous_id)
            current_replacement = db.get(ImportBatch, replacement_id)
            self.assertFalse(current_previous.is_active)
            self.assertEqual(current_replacement.supersedes_batch_id, current_previous.id)
            self.assertTrue(current_replacement.is_active)


if __name__ == "__main__":
    unittest.main()
