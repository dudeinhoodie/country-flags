# Backend Agent Handoff

Статус: `Ready to start`  
Цель: начать backend-разработку без ожидания production-каталога, credentials и внешних providers.

## 1. Порядок чтения

Backend-агент должен прочитать полностью:

1. [00-product-spec.md](./00-product-spec.md)
2. [01-backend-spec.md](./01-backend-spec.md)
3. [04-content-json-format.md](./04-content-json-format.md)
4. [05-feature-flags.md](./05-feature-flags.md)
5. [06-observability-analytics.md](./06-observability-analytics.md)
6. [07-advertising.md](./07-advertising.md)
7. Этот handoff.

[02-ios-spec.md](./02-ios-spec.md) используется только для проверки API/offline contracts. Реализовывать iOS в backend-задаче запрещено.

При конфликте требований приоритет:

1. Последнее явное решение владельца продукта.
2. Этот handoff и `01-backend-spec.md`.
3. Product spec.
4. Остальные тематические документы.

Нельзя молча выбирать другую семантику. Техническое отклонение фиксируется ADR с причиной, последствиями и migration path.

## 2. Что уже решено

| Область | Зафиксированное решение |
|---|---|
| API | REST JSON `/v1`, contract-first OpenAPI |
| Backend | NestJS, strict TypeScript |
| DB | PostgreSQL + Prisma migrations |
| Package manager | pnpm + lock-file |
| Content flexibility | Normalized entities/relations/cards + validated JSONB |
| Progress | Immutable review events + canonical projections |
| Scheduler | FSRS-6, pinned `ts-fsrs`, desired retention 0.90 |
| Offline conflicts | client sequence + normalized effective time + deterministic replay |
| Scheduler upgrade | immutable definitions + migration checkpoints + reconciliation |
| Multiple choice | server-generated versioned option snapshot; grading by option ID |
| Card changes | technical revision preserves progress; material flag change creates new card |
| Auth | Apple + Google identities, no merge by email |
| Guest import | idempotent event import with migration ID |
| Feature flags | OpenFeature; local static/default provider first |
| Advertising | policy/default-off only; no ad SDK/backend network |
| Analytics/errors | provider adapters and NoOp exporters first |
| Production content | atomic signed/checksummed bundle |

## 3. Отсутствующие данные не блокируют старт

### Каталог и assets

Создать deterministic development fixture:

- минимум 8 geo entities;
- RU/EN;
- минимум одна partially recognized entity;
- одна transcontinental relation;
- колоды `all` и `europe`;
- разные aspect ratios;
- одна technical asset revision;
- одна material card replacement fixture;
- валидные placeholder licenses/sources, явно помеченные `TEST_ONLY`.

Fixture не используется как production seed.

### Apple/Google credentials

- реализовать production verifier interfaces и claim validation;
- unit/integration используют локальные test signers/JWK fixtures;
- не добавлять публичный «dev login» в production application;
- реальные client IDs/JWK network tests включаются позже через environment configuration.

### Object storage

- реализовать `ObjectStorage` interface;
- локально использовать MinIO через compose либо тестовый in-memory adapter;
- production target — S3-compatible storage;
- domain/content modules не зависят от конкретного SDK.

### Feature flags

- использовать OpenFeature Server SDK;
- local/test provider читает version-controlled defaults/static fixture;
- отсутствие Flagsmith не блокирует запуск;
- provider outage возвращает typed defaults.

### Analytics/error providers

- interfaces, structured logs, OpenTelemetry hooks и transactional outbox создаются сразу;
- external exporters по умолчанию NoOp;
- бизнес-операции не зависят от доступности telemetry.

### Advertising

- только `AdvertisingPolicyModule` и `enabled=false` в app-config;
- ad network, creatives, revenue и rewarded callbacks не реализуются.

## 4. Целевая структура monorepo

```text
backend/
├── src/
│   ├── app/
│   ├── common/
│   ├── config/
│   ├── modules/
│   ├── infrastructure/
│   └── main.ts
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
├── test/
├── Dockerfile
└── package.json
contracts/
├── openapi.yaml
├── schemas/
│   ├── content/
│   ├── analytics/
│   └── configuration/
├── registries/
│   ├── feature-flags.json
│   ├── analytics-events.json
│   └── ad-placements.json
└── fixtures/
    ├── scheduler/
    ├── content/
    └── auth/
content/
├── schemas/
├── examples/
└── fixtures/
infrastructure/
└── compose.yaml
docs/
```

Не создавать отдельные microservices. На старте это modular monolith с отдельным worker entrypoint при необходимости.

## 5. Contract-first требования

До бизнес-endpoints должны появиться:

- `contracts/openapi.yaml`;
- общий error envelope;
- pagination/cursor conventions;
- auth security schemes;
- app-config schema;
- content manifest/change cursor schema;
- study session и discriminated review DTO;
- guest import и data export contracts;
- analytics batch schema.

Nest decorators/Swagger generation MAY использоваться, но committed OpenAPI является проверяемым canonical artifact. CI должен обнаруживать несовместимый drift между implementation и contract.

JSON Schema:

- Draft 2020-12;
- stable `$id`;
- `additionalProperties: false` для registries и security-sensitive payload;
- примеры проходят validation в CI;
- version bump обязателен для breaking schema changes.

## 6. Первые ADR

До или вместе с соответствующим кодом создать:

1. `ADR-001-monorepo-modular-monolith.md`
2. `ADR-002-auth-and-refresh-token-rotation.md`
3. `ADR-003-review-ordering-and-idempotency.md`
4. `ADR-004-fsrs6-versioning-and-migrations.md`
5. `ADR-005-content-bundle-and-card-revisions.md`
6. `ADR-006-openfeature-provider-boundary.md`

ADR не должен повторять всё ТЗ. Он фиксирует конкретную реализацию, альтернативы и последствия.

## 7. Первый вертикальный срез

Первый полезный backend increment работает без внешних credentials:

1. `GET /v1/health/live`
2. `GET /v1/health/ready`
3. `GET /v1/app-config`
4. `GET /v1/content/manifest`
5. `GET /v1/decks`
6. `GET /v1/decks/:id/cards`
7. service-level создание deterministic study session из test user/context
8. приём self-rated review через application service
9. FSRS-6 projection и progress response

До появления production auth HTTP study endpoints тестируются integration/E2E через test auth guard/JWT signer, который невозможно включить при production config validation.

Срез считается готовым, когда:

- пустая БД поднимается миграциями;
- fixture импортируется CLI;
- session из 5 уникальных карточек воспроизводима по seed;
- duplicate review не меняет state;
- restart не теряет progress;
- OpenAPI и schemas проходят CI;
- provider outages заменены safe defaults;
- нет secrets в repository/log output.

## 8. Следующие increments

### Increment 2 — Content

- production bundle schemas;
- validate/preview/publish/rollback CLI;
- assets/source/license validation;
- atomic content version;
- change cursor.

### Increment 3 — Auth и account lifecycle

- Apple/Google verification adapters;
- access/refresh sessions и rotation/reuse detection;
- identity linking conflict;
- devices/settings;
- idempotent guest import;
- logout/logout-all;
- data export;
- deletion workflow.

### Increment 4 — Learning

- online/offline study-session contracts;
- multiple-choice distractor snapshots;
- objective grading;
- time normalization;
- multi-device replay;
- scheduler checkpoints/reconciliation.

### Increment 5 — Progress и operations

- mastery/achievements;
- analytics outbox;
- OpenFeature provider integration boundary;
- observability/dashboards;
- backup/restore runbook;
- load/security/E2E tests.

## 9. Mandatory invariants

- Email не является user identity или merge key.
- Client не задаёт `isCorrect` для objective mode.
- Client не задаёт canonical `dueAt`, mastery или achievement.
- Review UUID нельзя применить дважды.
- Accepted review нельзя редактировать/удалять обычным update.
- Stale/out-of-order event не теряется.
- `clientOccurredAt` не используется для security.
- Published content/scheduler definitions неизменяемы.
- Material flag change не подменяет stimulus старой карточки.
- Feature flag не заменяет authorization/entitlement/privacy.
- Telemetry не является источником progress.
- Provider outage не делает core API недоступным.

Эти invariants должны быть отражены DB constraints, application services и тестами, а не только комментариями.

## 10. Environment contract

Config validation создаётся в первом increment. Категории:

- runtime/environment;
- PostgreSQL;
- JWT signing/issuer/audience;
- Apple/Google allowlists и verifier toggles;
- object storage/CDN;
- OpenFeature provider;
- telemetry exporters;
- content signing/verification keys;
- rate limits и batch limits.

Repository содержит `.env.example` без секретов. Production startup завершается ошибкой при отсутствии обязательных security variables. Test/dev defaults не могут автоматически примениться в production.

## 11. Quality gates

Каждый increment:

- format/lint;
- strict typecheck;
- unit tests;
- integration tests с PostgreSQL;
- Prisma migration validation;
- OpenAPI validation/drift check;
- JSON Schema example validation;
- dependency/security scan;
- build production image;
- проверка отсутствия secrets/PII fixtures в logs.

Не оставлять скрытые TODO в обязательном flow. Разрешённый deferred scope оформляется issue/ADR и не маскируется пустой success response.

## 12. Что не делать сейчас

- iOS/Android/web code;
- microservices;
- MongoDB;
- CloudKit/Google Drive sync;
- собственную CMS;
- собственную feature flag UI;
- реальные advertising integrations;
- paid subscription/entitlements;
- public leaderboards;
- персональную оптимизацию FSRS parameters;
- production analytics/crash vendor до выбора provider;
- генеративное наполнение production-каталога.

## 13. Команда агенту

Начни с foundation и первого вертикального среза. Не пытайся реализовать весь продукт одним изменением. Сначала исследуй состояние repository, создай короткий plan, затем contract/CI/skeleton и только после этого domain modules. После каждого increment запускай все относящиеся quality gates и сообщай точный результат.
