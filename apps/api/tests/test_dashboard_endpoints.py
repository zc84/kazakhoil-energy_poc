import json
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import DatasetKind, ImportBatch, ImportStatus, StagingRow


class DashboardEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
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
                    raw_json=json.dumps(["Итого по вводам 6 кВ"]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=2,
                    raw_json=json.dumps(['Яч.212 "Каспий нефть-2"', "ARTM", 51555226, None, 10, 0, 2, 20]),
                ),
                StagingRow(
                    batch_id=daily.id,
                    sheet_name="01.03",
                    row_index=3,
                    raw_json=json.dumps(["Итого по отходящим линиям 6 кВ"]),
                ),
            ]
            db.add_all(rows)
            db.commit()

    def test_technical_balance_endpoint_returns_operational_rows(self) -> None:
        response = self.client.get("/api/v1/dashboards/technical-balance")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meta"]["period"], "2026-03")
        self.assertEqual(payload["kpis"]["external_kwh"], 20)
        self.assertGreaterEqual(len(payload["table"]), 1)

    def test_daily_consumption_endpoint_returns_meter_ranking(self) -> None:
        response = self.client.get("/api/v1/dashboards/daily-consumption")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["kpis"]["days"], 1)
        self.assertEqual(payload["kpis"]["objects"], 1)
        self.assertEqual(payload["table"][0]["meter_number"], "51555226")

    def test_energy_dashboard_reconciles_external_detail(self) -> None:
        response = self.client.get("/api/v1/dashboards/energy-business")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["data_quality"]["external_detail_complete"])
        self.assertEqual(payload["data_quality"]["external_detail_difference_kwh"], 0)


if __name__ == "__main__":
    unittest.main()
