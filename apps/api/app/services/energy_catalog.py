"""Catalog of the KOA metering points (substations/RPs) plus the external
supply line, agreed with the client in the ЭнергоПульс review (see
docs/SMART_IMPLEMENTATION_PLAN.md, section 3.1).

The catalog lives in the `energy_points`/`energy_point_aliases` tables, not in
code: a point is added or retired by inserting/updating a row (with
`active_from`/`active_to` scoping which periods it applies to), not by
editing this module. How many points exist is therefore a property of the
period being viewed, derived from the data — never a hardcoded count.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import EnergyPoint, EnergyPointAlias

UNRESOLVED_ID = "needs-review"
UNRESOLVED_NAME = "Требует уточнения"

# The catalog agreed with the client (docs/SMART_IMPLEMENTATION_PLAN.md, 3.1),
# used only to seed `energy_points`/`energy_point_aliases` — by the Alembic
# migration on a real deploy, and directly by tests that build the schema
# with `Base.metadata.create_all()` instead of running migrations. Once
# seeded, a point is added or retired by editing the table, not this list.
DEFAULT_POINTS: tuple[tuple[str, str, str, str, tuple[str, ...]], ...] = (
    ("alibekmola-ps-110-35-6", "ПС 110/35/6 кВ Алибекмола", "alibekmola", "koa",
     ("пс-110/35/6кв", "пс 110/35/6 кв", 'пс-110/35/6 "алибекмола"')),
    ("alibekmola-sever", "ПС 35/6 кВ Северный Алибекмола", "alibekmola", "koa",
     ('пс 35/6 "северная"', "пс север ввода", 'пс 35/6 "север"', "ячейки №10 и №13 пс 35/6")),
    ("alibekmola-yug", "ПС 35/6 кВ Южный Алибекмола", "alibekmola", "koa",
     ('пс 35/6 кв "южная"', 'пс 35/6 "южная"')),
    ("alibekmola-gazzavod-ps", "ПС 35/6 кВ Газзавод-Алибекмола", "alibekmola", "koa",
     ("газзавод алибекмола",)),
    ("alibekmola-bkns", "РП-6 кВ БКНС-Алибекмола", "alibekmola", "koa",
     ("бкнс-алибекмола", "бкнс алибекмола")),
    ("alibekmola-cpng", "РП-1 6 кВ ЦПНГ", "alibekmola", "koa",
     ('рп -1 6кв "цппнг"', "рп-1 6кв", "цппнг", "цпнг")),
    ("alibekmola-gazzavod-rp", "РП-6 кВ Газзавод", "alibekmola", "koa",
     ("рп-6 кв газзавод", 'рп 6кв "газзавод"')),
    ("kozhasai-ps", "ПС 35/6 кВ Кожасай", "kozhasai", "koa",
     ('п/с 35/6 "кожасай"', 'пс 35/6 "кожасай"')),
    ("kozhasai-bkns", "ПС 35/6 кВ БКНС-Кожасай", "kozhasai", "koa",
     ('п/с 35/6 "бкнс кожасай"', "бкнс кожасай", "бкнс-кожасай")),
    ("kozhasai-nasosnaya", "РП-6 кВ Магистральная насосная", "kozhasai", "koa",
     ("насосная перекачки", "магистральная насосная")),
    ("external-yuzhny-zhanazhol", "ПС-110/35/6 кВ Южный Жанажол", "external", "external",
     ("южный жанажол",)),
)


def seed_default_energy_points(db: Session) -> None:
    """Insert the default catalog if `energy_points` is empty. Idempotent."""
    if db.scalar(select(EnergyPoint.id).limit(1)) is not None:
        return
    for code, name, site, ownership, aliases in DEFAULT_POINTS:
        point = EnergyPoint(code=code, name=name, site=site, ownership=ownership)
        point.aliases = [EnergyPointAlias(alias=alias) for alias in aliases]
        db.add(point)
    db.commit()


def normalize_title(value: str) -> str:
    return " ".join(str(value or "").casefold().replace("ё", "е").split())


def _is_active(point: EnergyPoint, period_start: date | None, period_end: date | None) -> bool:
    if period_start is None and period_end is None:
        return point.active_to is None
    if point.active_from is not None and period_end is not None and point.active_from > period_end:
        return False
    if point.active_to is not None and period_start is not None and point.active_to < period_start:
        return False
    return True


def active_points(
    db: Session, period_start: date | None = None, period_end: date | None = None
) -> list[EnergyPoint]:
    """Points whose active_from/active_to window covers the given period.

    With no period given, returns the points active today (open-ended
    active_to) — used where a specific dataset period isn't available.
    """
    points = db.scalars(
        select(EnergyPoint).options(selectinload(EnergyPoint.aliases)).order_by(EnergyPoint.id)
    ).all()
    return [point for point in points if _is_active(point, period_start, period_end)]


def resolve_title_against(points: list[EnergyPoint], title: str) -> EnergyPoint | None:
    normalized = normalize_title(title)
    if not normalized:
        return None
    for point in points:
        point_name = normalize_title(point.name)
        if point_name and point_name in normalized:
            return point
        for alias in point.aliases:
            normalized_alias = normalize_title(alias.alias)
            if normalized_alias and normalized_alias in normalized:
                return point
    return None
