from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class ImportStatus(StrEnum):
    uploaded = "uploaded"
    parsing = "parsing"
    validating = "validating"
    needs_review = "needs_review"
    ready_to_publish = "ready_to_publish"
    published = "published"
    rejected = "rejected"
    failed = "failed"


class ValidationSeverity(StrEnum):
    info = "info"
    warning = "warning"
    error = "error"


class DatasetKind(StrEnum):
    unknown = "unknown"
    daily_summary = "daily_summary"
    technical_balance = "technical_balance"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class ImportBatch(TimestampMixin, Base):
    __tablename__ = "import_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    checksum_sha256: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    status: Mapped[ImportStatus] = mapped_column(
        Enum(ImportStatus), default=ImportStatus.uploaded, nullable=False
    )
    dataset_kind: Mapped[DatasetKind] = mapped_column(
        Enum(DatasetKind), default=DatasetKind.unknown, nullable=False
    )
    parser_version: Mapped[str] = mapped_column(String(32), default="0.1.0", nullable=False)
    total_sheets: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accepted_rows: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    warning_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    files: Mapped[list[ImportFile]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    staging_rows: Mapped[list[StagingRow]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )
    issues: Mapped[list[ValidationIssue]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class ImportFile(TimestampMixin, Base):
    __tablename__ = "import_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255))
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)

    batch: Mapped[ImportBatch] = relationship(back_populates="files")


class StagingRow(TimestampMixin, Base):
    __tablename__ = "staging_rows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    sheet_name: Mapped[str] = mapped_column(String(255), nullable=False)
    row_index: Mapped[int] = mapped_column(Integer, nullable=False)
    raw_json: Mapped[str] = mapped_column(Text, nullable=False)

    batch: Mapped[ImportBatch] = relationship(back_populates="staging_rows")


class ValidationIssue(TimestampMixin, Base):
    __tablename__ = "validation_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(ForeignKey("import_batches.id"), nullable=False)
    severity: Mapped[ValidationSeverity] = mapped_column(
        Enum(ValidationSeverity), nullable=False
    )
    rule_code: Mapped[str] = mapped_column(String(64), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    sheet_name: Mapped[str | None] = mapped_column(String(255))
    row_index: Mapped[int | None] = mapped_column(Integer)

    batch: Mapped[ImportBatch] = relationship(back_populates="issues")


class AISettings(TimestampMixin, Base):
    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    api_key: Mapped[str | None] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(64), default="gpt-5.4", nullable=False)
    skill_prompt: Mapped[str] = mapped_column(Text, nullable=False)


class AIInsight(TimestampMixin, Base):
    __tablename__ = "ai_insights"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    batch_id: Mapped[int] = mapped_column(
        ForeignKey("import_batches.id"), nullable=False, unique=True
    )
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)


class AIMessage(TimestampMixin, Base):
    __tablename__ = "ai_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String(64))
    response_id: Mapped[str | None] = mapped_column(String(128))
