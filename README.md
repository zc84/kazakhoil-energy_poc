# ЭнергоПульс (Kazakhoil Energy)

Монорепозиторий MVP-платформы для аналитики электропотребления:

- импорт ежедневных сводок и техбаланса (`.xlsx/.xls`),
- валидация и публикация данных,
- дэшборды ежедневного/ежемесячного потребления и аномалий.

## Структура репозитория

```text
apps/
  api/                  # FastAPI backend (imports, dashboards, storage metadata)
  web/                  # Vite + React frontend (текущий entrypoint bridge)
  worker/               # background worker placeholder
packages/
  web-api-client/       # заготовка под generated TypeScript API client
infra/
  compose.yaml          # локальный стек web/api/worker/db/redis/minio
docs/
  MVP_IMPLEMENTATION_PLAN.md
  BUSINESS_VALUE_PLAN.md
  data-contract.md
  metric-dictionary.md
```

## Текущий статус

- **API**: реализованы базовые endpoints импорта и preview/publish flow.
- **Хранилище raw-файлов**: загрузки сохраняются с checksum и metadata.
- **Dashboard endpoints**: доступны daily/monthly/anomalies и energy-business view.
- **Web**: `apps/web` использует bridge на существующий UI-прототип (`src/main.jsx`) во время миграции.
- **Worker**: пока heartbeat placeholder для локальной композиции.

## Быстрый старт (локально)

### 1) Frontend

```bash
npm install
npm run dev
```

Dev URL: `http://localhost:5173`

### 2) Backend (без Docker)

```bash
python3 -m venv .venv
.venv/bin/pip install -e apps/api
cd apps/api
../../.venv/bin/uvicorn app.main:app --reload
```

API URL: `http://127.0.0.1:8000`

Проверка health:

```bash
curl http://127.0.0.1:8000/healthz
```

### 3) Полный локальный стек (Docker Compose)

```bash
docker compose -f infra/compose.yaml up
```

Поднимутся сервисы:

- `web` (5173)
- `api` (8000)
- `worker`
- `db` PostgreSQL (5432)
- `redis` (6379)
- `minio` + console (9000/9001)

## Основные API endpoints (MVP)

### Imports

- `POST /api/v1/imports`
- `GET /api/v1/imports`
- `GET /api/v1/imports/{batch_id}`
- `GET /api/v1/imports/{batch_id}/issues`
- `GET /api/v1/imports/{batch_id}/preview`
- `GET /api/v1/imports/{batch_id}/result`
- `POST /api/v1/imports/{batch_id}/publish`

### Dashboards

- `GET /api/v1/dashboards/daily`
- `GET /api/v1/dashboards/monthly`
- `GET /api/v1/dashboards/anomalies`
- `GET /api/v1/dashboards/energy-business`

## Документация

- [docs/MVP_IMPLEMENTATION_PLAN.md](docs/MVP_IMPLEMENTATION_PLAN.md) — полный технический план MVP, модель данных, pipeline и этапы.
- [docs/BUSINESS_VALUE_PLAN.md](docs/BUSINESS_VALUE_PLAN.md) — бизнес-метрики, KPI и правила операционного экрана.
- [docs/data-contract.md](docs/data-contract.md) — контракт данных.
- [docs/metric-dictionary.md](docs/metric-dictionary.md) — словарь метрик и определения.
- [docs/environment-secrets-policy.md](docs/environment-secrets-policy.md) — политика окружений и секретов.

## Environment / Secrets

Базовые переменные окружения:

- `DATABASE_URL`
- `REDIS_URL`
- `S3_ENDPOINT_URL`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_BUCKET_RAW_IMPORTS`
- `APP_ENV`

Секреты храним только в `.env` (локально) и в secret manager целевой платформы. Не коммитим credentials и raw клиентские файлы в Git.
