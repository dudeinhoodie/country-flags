# iOS development handoff

Статус: ready for issue execution

Baseline: Swift 6, SwiftUI, iOS 17+, SwiftData

Этот раздел разбивает общее iOS ТЗ на независимые agent-ready work packages.
Перед любой iOS-задачей агент MUST:

1. прочитать GitHub Issue целиком;
2. прочитать соответствующий документ из `docs/ios/tasks/`;
3. прочитать релевантные разделы `docs/02-ios-spec.md`;
4. проверить зависимости Issue;
5. создать ветку `dev/<issue-number>-<short-slug>`;
6. не придумывать DTO, отсутствующие в `contracts/openapi.yaml`.

## Порядок выполнения

| Код | Задача | Документ | Блокирующие зависимости |
| --- | --- | --- | --- |
| IOS-000 | Backend/client readiness gate | [IOS-000](./tasks/IOS-000-backend-readiness-gate.md) | — |
| IOS-001 | Xcode project и CI foundation | [IOS-001](./tasks/IOS-001-project-foundation.md) | — |
| IOS-002 | Generated OpenAPI client | [IOS-002](./tasks/IOS-002-openapi-client.md) | IOS-000, IOS-001 |
| IOS-003 | SwiftData и account scopes | [IOS-003](./tasks/IOS-003-persistence-account-scopes.md) | IOS-001 |
| IOS-004 | Feature flags и platform policies | [IOS-004](./tasks/IOS-004-platform-policies.md) | IOS-001, IOS-002, IOS-003 |
| IOS-005 | Content bootstrap и browse | [IOS-005](./tasks/IOS-005-content-browse.md) | IOS-002, IOS-003, IOS-004 |
| IOS-006 | Guest self-rated study | [IOS-006](./tasks/IOS-006-self-rated-study.md) | IOS-003, IOS-005 |
| IOS-007 | Multiple-choice study | [IOS-007](./tasks/IOS-007-multiple-choice.md) | IOS-002, IOS-003, IOS-005, IOS-006 |
| IOS-008 | Outbox и SyncCoordinator | [IOS-008](./tasks/IOS-008-sync-outbox.md) | IOS-002, IOS-003, IOS-006, IOS-007 |
| IOS-009 | Apple/Google auth и guest migration | [IOS-009](./tasks/IOS-009-auth-guest-migration.md) | IOS-002, IOS-003, IOS-008 |
| IOS-010 | Progress, achievements и settings | [IOS-010](./tasks/IOS-010-progress-settings.md) | IOS-008, IOS-009 |
| IOS-011 | Account lifecycle | [IOS-011](./tasks/IOS-011-account-lifecycle.md) | IOS-009, IOS-010 |
| IOS-012 | Analytics, diagnostics и privacy | [IOS-012](./tasks/IOS-012-analytics-diagnostics-privacy.md) | IOS-004, IOS-008, IOS-009 |
| IOS-013 | UX hardening и release readiness | [IOS-013](./tasks/IOS-013-release-readiness.md) | IOS-005…IOS-012 |

## Общие quality gates

- чистая сборка не использует локальные абсолютные пути;
- Swift 6 strict concurrency warnings не подавляются массово;
- каждый PR добавляет тесты для своих acceptance criteria;
- UI читает состояние из локального store, а не прямо из network response;
- tokens/PII не попадают в SwiftData, UserDefaults, logs или analytics;
- Mock scheme детерминирован и не обращается к сети;
- изменения API сначала вносятся в канонический OpenAPI;
- один Issue соответствует одной ветке и одному PR.

Общее ТЗ: [02-ios-spec.md](../02-ios-spec.md).

OpenAPI: [contracts/openapi.yaml](../../contracts/openapi.yaml).

Результат readiness gate: [15-ios-client-readiness.md](../15-ios-client-readiness.md) —
сопоставление каждого flow с операцией, форма контракта для генерируемых клиентов
([ADR-009](../adr/ADR-009-generated-client-contract-shape.md)), fixtures в
`contracts/fixtures/openapi/` и открытые вопросы.
