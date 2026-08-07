# Country Flags

Проект приложения для запоминания флагов и других данных о странах с интервальным повторением.

Backend реализуется как NestJS modular monolith в Yarn workspace. Текущий этап —
foundation первой итерации.

- [Обзор документации](./docs/README.md)
- [Продуктовое ТЗ](./docs/00-product-spec.md)
- [ТЗ для NestJS backend](./docs/01-backend-spec.md)
- [ТЗ для iOS на Swift](./docs/02-ios-spec.md)
- [Открытые вопросы и риски](./docs/03-open-questions.md)
- [JSON-формат каталога](./docs/04-content-json-format.md)
- [Пример JSON-каталога](./content/examples/catalog.sample.json)
- [ТЗ на feature flags](./docs/05-feature-flags.md)
- [ТЗ на логирование, ошибки и аналитику](./docs/06-observability-analytics.md)
- [ТЗ на опциональную рекламу](./docs/07-advertising.md)
- [Стартовый handoff для Backend Agent](./docs/08-backend-agent-handoff.md)
- [Postman Collection для локального API](./postman/README.md)

## Локальный запуск backend

Требования:

- Node.js 22 или новее;
- Corepack;
- Docker с Compose.

```bash
corepack enable
cp backend/.env.example backend/.env
corepack yarn install --immutable
corepack yarn prisma:generate
corepack yarn db:up
corepack yarn prisma:migrate:deploy
corepack yarn study:seed:test
corepack yarn dev
```

Проверка:

```bash
curl http://localhost:3000/v1/health/live
curl http://localhost:3000/v1/health/ready
curl "http://localhost:3000/v1/content/manifest?locale=en"
```

Первые два запроса подтверждают только то, что процесс жив и видит PostgreSQL;
третий — что `study:seed:test` действительно загрузил fixture и она доступна
через реальный API, а не просто что health-check проходит.

Полный локальный стек в контейнерах. `api`-сервис в
[`infrastructure/compose.yaml`](./infrastructure/compose.yaml) не применяет
миграции сам — это отдельный deployment step по дизайну (см.
[11-migration-deployment-runbook.md](./docs/11-migration-deployment-runbook.md)),
поэтому `db:up` и `prisma:migrate:deploy` должны отработать до `app:up`:

```bash
corepack yarn db:up
corepack yarn prisma:migrate:deploy
corepack yarn app:up
curl http://localhost:3000/v1/health/live
curl http://localhost:3000/v1/health/ready
```

Остановка:

```bash
corepack yarn app:down
```

## Quality gates

```bash
corepack yarn format:check
corepack yarn lint
corepack yarn typecheck
corepack yarn test
corepack yarn contracts:check
corepack yarn prisma:validate
corepack yarn prisma:migrate:deploy
corepack yarn build
corepack yarn docker:build
```

`corepack yarn test` использует локальную PostgreSQL из `corepack yarn db:up`
для HTTP E2E-проверки readiness.

`corepack yarn prisma:migrate:deploy` применяет committed migrations без
интерактивных шагов. Правила модели, retention и ручных PostgreSQL constraints
описаны в [`backend/prisma/README.md`](./backend/prisma/README.md).

Полный environment contract находится в `backend/.env.example`. Для production
обязательны отдельный `ACCOUNT_DATA_HASH_SECRET` и канонический
`PUBLIC_BASE_URL`; TTL re-authentication и download URL задаются
`AUTH_REAUTH_TOKEN_TTL_SECONDS` и `DATA_EXPORT_DOWNLOAD_TTL_SECONDS`.

Канонический API-контракт находится в
[`contracts/openapi.yaml`](./contracts/openapi.yaml). Проверки контрактов
валидируют OpenAPI, собирают single-file bundle, проверяют JSON Schema fixtures
и обнаруживают несовместимые изменения относительно base branch.

Решение о структуре и package manager зафиксировано в
[ADR-001](./docs/adr/ADR-001-monorepo-modular-monolith.md).
Provider identities и refresh-token rotation описаны в
[ADR-002](./docs/adr/ADR-002-auth-and-refresh-token-rotation.md).
Правила immutable review ordering и pinned FSRS-6 описаны в
[ADR-003](./docs/adr/ADR-003-review-ordering-and-idempotency.md) и
[ADR-004](./docs/adr/ADR-004-fsrs6-versioning-and-migrations.md).
Хранение и migration path приватных account exports зафиксированы в
[ADR-007](./docs/adr/ADR-007-account-data-export-storage.md). Топология
dev/production deployment (Koyeb/Neon/R2, immutable promotion) зафиксирована в
[ADR-008](./docs/adr/ADR-008-deployment-topology-and-promotion.md).

Известные ограничения текущего MVP сведены в
[12-known-limitations.md](./docs/12-known-limitations.md). Retention-политика,
backup/PITR runbook и migration/deployment runbook — в
[09-retention.md](./docs/09-retention.md),
[10-backup-restore-runbook.md](./docs/10-backup-restore-runbook.md) и
[11-migration-deployment-runbook.md](./docs/11-migration-deployment-runbook.md).
Deployment environments и agent handoff (local/CI/dev/prod, CI/CD, migrations,
backup, rollback) — в [13-deployment-environments.md](./docs/13-deployment-environments.md)
и [14-deployment-agent-handoff.md](./docs/14-deployment-agent-handoff.md).

Команды явно используют `corepack yarn`, чтобы системный Yarn Classic не мог
случайно проигнорировать закреплённую в проекте версию Yarn.
