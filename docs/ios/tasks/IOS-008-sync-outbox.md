# IOS-008 — Outbox и SyncCoordinator

## Метаданные

- Тип: iOS synchronization
- Приоритет: P0
- Зависимости: IOS-002, IOS-003, IOS-006, IOS-007
- Рекомендуемый slug: `ios-sync-outbox`

## Результат

Локальные review не теряются при offline, crash или повторных ответах API.
Один coordinator синхронизирует account scope и заменяет локальную
консервативную projection каноническим server state.

## API

- `POST /v1/reviews/batch`;
- `GET /v1/me/changes`;
- `GET /v1/content/changes`;
- `GET /v1/me/settings`;
- `GET /v1/me/progress`;
- `GET /v1/me/achievements`;
- `POST /v1/study-sessions/{sessionId}/complete`.

Guest scope хранит durable local outbox, но не отправляется до входа/import.
Authenticated scope синхронизируется отдельно.

## Scope

- actor `SyncCoordinator`;
- single sync per account scope;
- ordered outbox batching;
- per-event acknowledgement/rejection;
- canonical card state application;
- user/content cursor storage;
- partial failure;
- bounded retry/backoff;
- foreground/network/pull-to-refresh/session-complete triggers;
- cancellable status publication в UI;
- crash recovery;
- background task hook без гарантий точного времени.

## Инварианты

- pending item удаляется только после server acknowledgement;
- stable event UUID сохраняется при retry/import;
- cursor обновляется после transactional page apply;
- rejected event не блокирует подтверждённые события;
- stale server responses не откатывают более новую local version;
- scopes не синхронизируются вместе;
- network monitor — trigger/hint, не доказательство доступности API.

## Acceptance criteria

- параллельные triggers создают один sync выбранного scope;
- repeated batch не дублирует review;
- partial response очищает только acknowledged items;
- recoverable rejection остаётся pending с диагностикой/retry policy;
- non-recoverable rejection не создаёт infinite loop;
- kill/relaunch во время request не теряет outbox;
- canonical server state заменяет local projection;
- cursor replay идемпотентен;
- offline banner не блокирует study;
- active session не меняется из-за sync.

## Тесты

- trigger coalescing;
- ordered batch;
- duplicate replay;
- partial success;
- 409/422/429/5xx;
- cursor transaction failure;
- kill/relaunch;
- account switch during sync;
- canonical projection replacement;
- background expiration cancellation.

## Вне задачи

- OAuth UI;
- guest import endpoint;
- analytics upload;
- гарантированный periodic background execution;
- изменение backend reconciliation algorithm.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:297-346`, review/outbox schemas и backend
reconciliation tests. Coordinator не должен напрямую владеть View state:
публиковать компактный status и записывать canonical данные в repositories.
