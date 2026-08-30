"""Canonical catalog of the 10 internal KOA metering points plus the external
supply line, agreed with the client in the ЭнергоПульс review (see
docs/SMART_IMPLEMENTATION_PLAN.md, section 3.1).

Aliases below are normalized (casefold, ё->е) substrings verified against the
real technical-balance titles found across all 7 files in `данные/`
(январь-июль 2026). A title that does not match any alias is surfaced as
"needs_review" rather than silently dropped or guessed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


def normalize_title(value: str) -> str:
    return " ".join(str(value or "").casefold().replace("ё", "е").split())


@dataclass(frozen=True)
class CatalogPoint:
    id: str
    name: str
    site: str
    aliases: tuple[str, ...] = field(default_factory=tuple)

    def matches(self, normalized_title: str) -> bool:
        return any(alias in normalized_title for alias in self.aliases)


CATALOG_POINTS: tuple[CatalogPoint, ...] = (
    CatalogPoint(
        "alibekmola-ps-110-35-6",
        "ПС 110/35/6 кВ Алибекмола",
        "alibekmola",
        ("пс-110/35/6кв", "пс 110/35/6 кв", 'пс-110/35/6 "алибекмола"'),
    ),
    CatalogPoint(
        "alibekmola-sever",
        "ПС 35/6 кВ Северный Алибекмола",
        "alibekmola",
        ('пс 35/6 "северная"', "пс север ввода", 'пс 35/6 "север"', "ячейки №10 и №13 пс 35/6"),
    ),
    CatalogPoint(
        "alibekmola-yug",
        "ПС 35/6 кВ Южный Алибекмола",
        "alibekmola",
        ('пс 35/6 кв "южная"', 'пс 35/6 "южная"'),
    ),
    CatalogPoint(
        "alibekmola-gazzavod-ps",
        "ПС 35/6 кВ Газзавод-Алибекмола",
        "alibekmola",
        ('газзавод алибекмола',),
    ),
    CatalogPoint(
        "alibekmola-bkns",
        "РП-6 кВ БКНС-Алибекмола",
        "alibekmola",
        ("бкнс-алибекмола", "бкнс алибекмола"),
    ),
    CatalogPoint(
        "alibekmola-cpng",
        "РП-1 6 кВ ЦПНГ",
        "alibekmola",
        ('рп -1 6кв "цппнг"', "рп-1 6кв", "цппнг", "цпнг"),
    ),
    CatalogPoint(
        "alibekmola-gazzavod-rp",
        "РП-6 кВ Газзавод",
        "alibekmola",
        ("рп-6 кв газзавод", 'рп 6кв "газзавод"'),
    ),
    CatalogPoint(
        "kozhasai-ps",
        "ПС 35/6 кВ Кожасай",
        "kozhasai",
        ('п/с 35/6 "кожасай"', 'пс 35/6 "кожасай"'),
    ),
    CatalogPoint(
        "kozhasai-bkns",
        "ПС 35/6 кВ БКНС-Кожасай",
        "kozhasai",
        ('п/с 35/6 "бкнс кожасай"', 'бкнс кожасай', 'бкнс-кожасай'),
    ),
    CatalogPoint(
        "kozhasai-nasosnaya",
        "РП-6 кВ Магистральная насосная",
        "kozhasai",
        ('насосная перекачки', 'магистральная насосная'),
    ),
)

EXTERNAL_LINE = CatalogPoint(
    "external-yuzhny-zhanazhol",
    "ПС-110/35/6 кВ Южный Жанажол",
    "external",
    ("южный жанажол",),
)

ALL_POINTS: tuple[CatalogPoint, ...] = (*CATALOG_POINTS, EXTERNAL_LINE)

UNRESOLVED_ID = "needs-review"
UNRESOLVED_NAME = "Требует уточнения"


def resolve_title(title: str) -> CatalogPoint | None:
    normalized = normalize_title(title)
    if not normalized:
        return None
    for point in ALL_POINTS:
        if point.matches(normalized):
            return point
    return None
