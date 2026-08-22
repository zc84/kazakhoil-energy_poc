"""add_commercial_consumption_kind

Revision ID: aa2c6b7d4e91
Revises: c43d019f0b4a
"""
from typing import Sequence, Union

from alembic import op


revision: str = "aa2c6b7d4e91"
down_revision: Union[str, Sequence[str], None] = "c43d019f0b4a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE datasetkind ADD VALUE IF NOT EXISTS 'commercial_consumption'")


def downgrade() -> None:
    pass
