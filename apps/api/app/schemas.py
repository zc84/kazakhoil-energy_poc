from datetime import date, datetime

from pydantic import BaseModel, Field, model_validator

from .models import DatasetKind, ImportStatus, ValidationSeverity


class ImportFileRead(BaseModel):
    id: int
    storage_key: str
    original_filename: str
    content_type: str | None
    file_size_bytes: int

    model_config = {"from_attributes": True}


class ValidationIssueRead(BaseModel):
    id: int
    severity: ValidationSeverity
    rule_code: str
    message: str
    sheet_name: str | None
    row_index: int | None

    model_config = {"from_attributes": True}


class StagingRowRead(BaseModel):
    id: int
    sheet_name: str
    row_index: int
    raw_json: str

    model_config = {"from_attributes": True}


class ImportBatchRead(BaseModel):
    id: int
    original_filename: str
    checksum_sha256: str
    status: ImportStatus
    dataset_kind: DatasetKind
    parser_version: str
    total_sheets: int
    total_rows: int
    accepted_rows: int
    warning_count: int
    error_count: int
    published_at: datetime | None
    created_at: datetime
    updated_at: datetime
    files: list[ImportFileRead] = []

    model_config = {"from_attributes": True}


class ImportPreviewRead(BaseModel):
    batch: ImportBatchRead
    preview_rows: list[StagingRowRead]
    issues: list[ValidationIssueRead]


class ImportResultRead(BaseModel):
    batch: ImportBatchRead
    summary: dict[str, object]
    sheet_distribution: list[dict[str, object]]
    series: list[dict[str, object]]
    preview_rows: list[dict[str, object]]


class EnergyBusinessDashboardRead(BaseModel):
    meta: dict[str, object]
    kpis: dict[str, object]
    monthly_series: list[dict[str, object]]
    daily_series: list[dict[str, object]]
    outgoing_35kv: list[dict[str, object]]
    external_groups: list[dict[str, object]]
    external_consumers: list[dict[str, object]]
    top_external_consumers: list[dict[str, object]]
    reconciliation: list[dict[str, object]]
    forecast: dict[str, object]
    data_quality: dict[str, object]
    insight: str
    warnings: list[str]


class ForecastAdjustment(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=120)
    kind: str = Field(pattern="^(outage|derating|addition)$")
    start_date: date
    end_date: date
    capacity_kw: float = Field(gt=0, le=1_000_000)
    utilization: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def validate_period(self):
        if self.end_date < self.start_date:
            raise ValueError("Дата окончания не может быть раньше даты начала")
        return self


class EnergyForecastRequest(BaseModel):
    adjustments: list[ForecastAdjustment] = Field(default_factory=list, max_length=50)
    weather_locations: list[dict[str, object]] = Field(default_factory=list, max_length=32)


class DashboardRead(BaseModel):
    meta: dict[str, object]
    kpis: dict[str, object]
    series: list[dict[str, object]]
    breakdowns: list[dict[str, object]]
    table: list[dict[str, object]]
    insight: str
    warnings: list[str]


class AISettingsRead(BaseModel):
    model: str
    skill_prompt: str
    has_api_key: bool
    masked_api_key: str | None = None
    models: list[dict[str, str]]


class AISettingsUpdate(BaseModel):
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False
    model: str
    skill_prompt: str = Field(min_length=20, max_length=8000)


class AIChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class AIMessageRead(BaseModel):
    id: int
    role: str
    content: str
    model: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AIChatResponse(BaseModel):
    message: AIMessageRead
    response_id: str | None
    model: str


class AIInsightRead(BaseModel):
    id: int
    batch_id: int
    model: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}
