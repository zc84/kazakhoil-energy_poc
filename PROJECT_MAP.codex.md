# Project map for Codex

Last updated: 2026-07-27

Purpose: compact index of the repository so future work can target files directly instead of rescanning the whole project.

## High-level

- Type: frontend + backend MVP foundation
- Frontend: React 18 + Vite 6
- Backend: FastAPI + SQLAlchemy import foundation
- Storage: local raw-file storage under backend data root
- Current runtime data source:
  - `quality`, `overview`, and `Энергобаланс` read real import data from backend API
  - the energy dashboard aggregates three technical balances and three daily summaries
  - other dashboard sections intentionally show empty states until semantic layer is implemented

## Root files

- `package.json` — workspace root scripts
- `pnpm-workspace.yaml` — workspace packages
- `README.md` — run instructions and current project status
- `docs/MVP_IMPLEMENTATION_PLAN.md` — target MVP architecture and execution plan
- `docs/BUSINESS_VALUE_PLAN.md` — dashboard decisions, calculation boundaries, and readiness criteria
- `infra/compose.yaml` — local multi-service environment

## Runtime entrypoints

- `src/main.jsx` — current frontend shell and API-backed pages
- `src/styles.css` — styling system
- `apps/api/app/main.py` — FastAPI application
- `apps/worker/app/main.py` — worker placeholder

## Frontend map

### Shared pieces

- `nav` — sidebar navigation
- `pageTitles` — topbar title/subtitle mapping
- `FilterBar`
- `KpiCard`
- `Card`
- `Status`
- `EmptyState`
- `useImportsState` — shared import history loader

### Screens

- `Overview` — import/API status summary backed by `GET /api/v1/imports`
- `Quality` — real file upload, batch list, preview/issues
- `EnergyBusinessDashboard` — monthly balance, daily profile, 35 kV directions, external consumers, and source reconciliation
- `EnergyBusinessCharts.jsx` — lazy-loaded Recharts visualizations for the business dashboard
- `PlaceholderPage` — empty state for sections whose semantic layer is not implemented yet

### App composition

- `AppShell`
  - state: `page`, `mobile`
  - shared API state: `importsState`
- `Root`
  - theme persistence only

## Backend map

- `apps/api/app/config.py` — settings
- `apps/api/app/db.py` — engine/session/base
- `apps/api/app/models.py` — import batches, files, staging rows, validation issues
- `apps/api/app/schemas.py` — response schemas
- `apps/api/app/services/storage.py` — raw-file persistence
- `apps/api/app/services/ingestion.py` — baseline parsing for `.csv`, `.xlsx`, `.xls`
- `apps/api/app/services/dashboard.py` — independent meter recalculation and business-dashboard aggregation

## Current behavior

- Real API calls are used for import history and quality page operations
- Frontend upload uses `POST /api/v1/imports`
- Preview uses `GET /api/v1/imports/{id}/preview`
- Business visualization uses `GET /api/v1/dashboards/energy-business`
- Issues use `GET /api/v1/imports/{id}/issues`
- Successful upload automatically opens the consolidated energy dashboard
- Non-implemented dashboards do not show fabricated metrics; they render empty states instead

## Structural risks

- `src/main.jsx` is still monolithic
- monthly/daily source coverage is currently limited to January–March 2026
- tariff/cost KPIs are intentionally blocked until billable boundary and rounding rules are approved
- auth/roles are not implemented yet
- client-specific mappings cover the current technical-balance and daily-summary layouts; additional workbook variants need adapters

## Fast lookup anchors

- import UI: `src/main.jsx` → `Quality`
- import overview: `src/main.jsx` → `Overview`
- empty sections: `src/main.jsx` → `PlaceholderPage`
- API entry: `apps/api/app/main.py`
- import models: `apps/api/app/models.py`
- parsing/storage: `apps/api/app/services/`
