"""add energy points catalog (data-driven, replaces the static point list)

Revision ID: 2a7c9f3e5b18
Revises: 1f4a3e2c8b11
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import Session

revision = "2a7c9f3e5b18"
down_revision = "1f4a3e2c8b11"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "energy_points",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("site", sa.String(length=32), nullable=False),
        sa.Column("ownership", sa.String(length=16), nullable=False),
        sa.Column("active_from", sa.Date(), nullable=True),
        sa.Column("active_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "energy_point_aliases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("point_id", sa.Integer(), sa.ForeignKey("energy_points.id"), nullable=False),
        sa.Column("alias", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_energy_point_aliases_point_id", "energy_point_aliases", ["point_id"])

    # Seed from the same DEFAULT_POINTS list the app and its tests use — see
    # docs/SMART_IMPLEMENTATION_PLAN.md section 3.1 for where this list came
    # from. active_from/active_to are left NULL ("active for every period we
    # know of"): nothing indicates any of these points started or stopped
    # operating within the periods already loaded.
    from app.services.energy_catalog import seed_default_energy_points

    session = Session(bind=op.get_bind())
    seed_default_energy_points(session)


def downgrade() -> None:
    op.drop_index("ix_energy_point_aliases_point_id", table_name="energy_point_aliases")
    op.drop_table("energy_point_aliases")
    op.drop_table("energy_points")
