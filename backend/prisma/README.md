# Database model and migration policy

`schema.prisma` описывает транзакционную PostgreSQL-модель приложения.
Committed migrations являются единственным способом изменения deployed
database schema.

## Migration workflow

- Новое изменение schema создаёт новую migration; опубликованные migration
  файлы не редактируются.
- Deployment выполняет `corepack yarn prisma:migrate:deploy` отдельным шагом до
  запуска новой версии API.
- `test/migrations.e2e-spec.ts` создаёт временную пустую PostgreSQL database,
  применяет все migrations и проверяет ключевые constraints.
- Check constraints, partial indexes, `NULLS NOT DISTINCT` indexes и immutable
  triggers находятся в migration SQL, потому что Prisma schema не может
  выразить их полностью.

## Test-only fixtures

После применения миграций development/test базу можно наполнить отдельным
детерминированным набором:

```bash
corepack yarn content:import:test
```

Команда идемпотентна, публикует release с marker `TEST_ONLY` и намеренно
завершается ошибкой при `NODE_ENV=production`. Она не является production
seed/publish pipeline.

Для проверки study-session API используется расширенный seed:

```bash
corepack yarn study:seed:test
```

Он также импортирует content fixture, затем создаёт детерминированного test
user, device, active test scheduler и card states для сценариев
overdue/learning/new.
Test JWT можно получить через `corepack yarn study:token:test`. Обе команды
запрещены при `NODE_ENV=production`.

## Time and lifecycle rules

- Момент времени хранится только в PostgreSQL `TIMESTAMPTZ` и передаётся как
  UTC. Календарные даты используют `DATE`; локальное время напоминания —
  `TIME`.
- `users` использует lifecycle `ACTIVE → DELETION_PENDING → DELETED`.
  Обычный запрос не удаляет пользователя физически. Финальный privacy workflow
  удаляет account-scoped строки через объявленные FK cascades.
- Контент не удаляется, если на него ссылаются sessions, review или progress.
  Он переводится в `RETIRED`, `HISTORICAL` или `HIDDEN`; опубликованные content
  releases и change cursor сохраняются для воспроизводимости.
- Review, privacy consent, content change и audit rows запрещено изменять
  обычным `UPDATE`. Их удаление допускается только явным account-deletion или
  retention workflow.
- `analytics_outbox`, `idempotency_records`, `data_export_requests` и
  `audit_events` содержат `expires_at`. Worker удаляет только истёкшие записи
  согласно policy конкретного модуля; доставленные analytics rows не являются
  постоянной копией review history.
- `learning_outbox` атомарно сопровождает принятую review projection и остаётся
  отдельным от analytics operational потоком.
- Refresh sessions используют `expires_at` и `revoked_at`; в базе хранится
  только hash токена.

## Canonical invariants

- Provider identity уникальна по `(provider, provider_subject)` и никогда не
  связывается по email.
- Review UUID уникален в scope пользователя; device sequence также уникален,
  когда device известен. Принятый review является immutable.
- Stable content keys и внешние ISO/M49 codes защищены unique indexes.
- Для одной сущности и card template существует не более одной активной
  learning card.
- Published scheduler payload нельзя изменить; новая версия создаёт отдельную
  definition и migration checkpoint.
