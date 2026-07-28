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
corepack yarn dev
```

Проверка:

```bash
curl http://localhost:3000/v1/health/live
curl http://localhost:3000/v1/health/ready
```

Полный локальный стек в контейнерах:

```bash
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

Канонический API-контракт находится в
[`contracts/openapi.yaml`](./contracts/openapi.yaml). Проверки контрактов
валидируют OpenAPI, собирают single-file bundle, проверяют JSON Schema fixtures
и обнаруживают несовместимые изменения относительно base branch.

Решение о структуре и package manager зафиксировано в
[ADR-001](./docs/adr/ADR-001-monorepo-modular-monolith.md).

Команды явно используют `corepack yarn`, чтобы системный Yarn Classic не мог
случайно проигнорировать закреплённую в проекте версию Yarn.
