# ADR-004: FSRS-6 versioning and migrations

- Status: Accepted
- Date: 2026-07-29

## Context

Изменение scheduler package или параметров способно молча изменить due dates
при replay. Review history должна воспроизводиться после restart и во время
поэтапного scheduler upgrade.

## Decision

Canonical adapter использует:

- algorithm: FSRS-6;
- package: `ts-fsrs`;
- package version: `5.4.1`;
- license: MIT;
- Node.js requirement: `>=20`;
- parameters version: `fsrs-6-default-21-v1` — активной с 2026-08-21 является
  `fsrs-6-default-21-v2`, см. ADR-013; v1 остаётся ради replay истории;
- desired retention: `0.90`;
- 21 default FSRS-6 weights из pinned package;
- fuzz: disabled для deterministic server projection.

Точная dependency закреплена в `backend/package.json` и `yarn.lock`. Импорт
`ts-fsrs` разрешён только scheduler adapter. `scheduler_definitions` хранит
algorithm/package/parameters metadata; published fields защищены PostgreSQL
trigger. Package или parameters меняются только новой definition.

Каждый review сохраняет scheduler и parameters version, использованные при
приёме. Replay применяет события в canonical order их сохранёнными definitions,
поэтому новая active definition не переписывает immutable history.

Если projection переходит на новую active definition, в той же transaction
создаётся или пересчитывается `scheduler_migration_checkpoint`: source/target
version, cutoff event, migrated projection и SHA-256 checksum. Projection
публикуется только вместе с checkpoint; unsupported package/version приводит к
rollback review, projection и outbox.

FSRS-6 memory state (`difficulty`, `stability`, learning state, repetitions,
lapses и last review) переносится между совместимыми definitions. После
перехода новые reviews используют target definition. Late event до cutoff
запускает полный replay и обновляет checkpoint checksum. Старый adapter и
definition должны оставаться доступными, пока возможны late offline events.

## Upgrade procedure

1. Добавить новую immutable definition в `DRAFT`.
2. Запустить golden fixture и replay production-like histories.
3. Включить canary и проверить projection/checkpoint.
4. Перевести старую definition в `RETIRED`, новую — в `ACTIVE`.
5. Не удалять старый adapter до завершения reconciliation window.

Частичный upgrade безопасно откатывается переводом definition status; review
history не изменяется.

## Alternatives

- Обновление package без definition отклонено как невоспроизводимое.
- Хранение только текущей projection отклонено: late/offline replay был бы
  невозможен.
- Пользовательская оптимизация parameters отложена и не входит в MVP.

## Consequences

Repository хранит golden fixture с точными числовыми результатами. Новая
package/parameters version требует отдельного fixture, definition и migration
path. Checkpoints являются производными и могут пересчитываться; review rows
остаются immutable.
