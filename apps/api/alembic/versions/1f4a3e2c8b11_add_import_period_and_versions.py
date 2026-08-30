"""add import period and version metadata

Revision ID: 1f4a3e2c8b11
Revises: aa2c6b7d4e91
"""
from alembic import op
import sqlalchemy as sa

revision = "1f4a3e2c8b11"
down_revision = "aa2c6b7d4e91"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("import_batches", sa.Column("period_start", sa.Date(), nullable=True))
    op.add_column("import_batches", sa.Column("period_end", sa.Date(), nullable=True))
    op.add_column("import_batches", sa.Column("period_source", sa.String(length=32), nullable=True))
    op.add_column("import_batches", sa.Column("content_fingerprint", sa.String(length=64), nullable=True))
    op.add_column("import_batches", sa.Column("supersedes_batch_id", sa.Integer(), nullable=True))
    op.add_column("import_batches", sa.Column("superseded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("import_batches", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.create_index("ix_import_batches_kind_period_active", "import_batches", ["dataset_kind", "period_start", "is_active"])
    op.create_index("ix_import_batches_content_fingerprint", "import_batches", ["content_fingerprint"])


def downgrade() -> None:
    op.drop_index("ix_import_batches_content_fingerprint", table_name="import_batches")
    op.drop_index("ix_import_batches_kind_period_active", table_name="import_batches")
    for name in ("is_active", "superseded_at", "supersedes_batch_id", "content_fingerprint", "period_source", "period_end", "period_start"):
        op.drop_column("import_batches", name)
