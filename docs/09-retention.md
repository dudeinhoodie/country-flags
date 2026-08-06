# Data Retention

Статус: `Draft — issue #15 (security & production hardening)`, требует production sign-off перед первым релизом (см. [06-observability-analytics.md](./06-observability-analytics.md) §22: «Перед production утверждается таблица»).

Эта таблица — конкретизация утверждённых там стартовых чисел плюс аудит того, что из этого реально enforced кодом сегодня (backend commit на момент написания), а что задокументировано как намерение и требует отдельной работы.

## 1. Утверждённая стартовая политика (docs/06-observability-analytics.md §22)

| signal/category | raw retention | aggregate retention | provider | deletion mechanism | owner |
| --- | --- | --- | --- | --- | --- |
| production application logs | 14–30 дней | — | log collector (не выбран) | provider-side TTL | Backend |
| raw traces | 7–14 дней | — | trace backend (не выбран) | provider-side TTL | Backend |
| error reports | 90 дней | — | error/crash provider (не выбран) | provider-side TTL | Backend |
| product/analytics events | ≤ 13 месяцев без нового обоснования | отдельно утверждённый срок для irreversible aggregates | analytics provider (не выбран) | provider-side TTL | Product + Backend |
| delivered outbox записи | минимальный TTL | — | PostgreSQL | Backend cleanup job | Backend |

Значения не зашиваются в клиент и могут быть сокращены отдельным решением; увеличение требует нового обоснования.

## 2. Что реально enforced в текущем backend-коде

Аудит на основе кода, не намерения — если строка помечена «не enforced», значит колонка/поле существует, но ничего его не читает и не удаляет.

| Таблица / поле | Retention | Enforced? | Механизм |
| --- | --- | --- | --- |
| `auth_rate_limit_buckets.updated_at` | 24 часа | ✅ Enforced | `RateLimitBucketReaper` (`backend/src/common/security/rate-limit-bucket-reaper.ts`), sweep каждые 5 минут |
| `AnalyticsOutboxEvent` (DELIVERED) | 1 час после `deliveredAt` | ✅ Enforced | `AnalyticsOutboxWorker.expireDelivered()` (`DELIVERED_RETENTION_MS`) |
| `AnalyticsOutboxEvent.expiresAt` | 7 дней от приёма (`OUTBOX_TTL_MS` в `analytics-batch.service.ts`) | ⚠️ **Не enforced** | Поле проставляется при вставке, но ни один job его не читает — PENDING/PROCESSING/FAILED строки старше 7 дней не удаляются. Требуется добавить проверку в `AnalyticsOutboxWorker` (follow-up). |
| `LearningOutboxEvent` (DELIVERED/FAILED) | — | ⚠️ **Не enforced** | В отличие от `AnalyticsOutboxWorker`, `LearningOutboxWorker` не удаляет ни delivered, ни dead-lettered строки — растут неограниченно. Follow-up. |
| `RefreshSession.expiresAt` | TTL проверяется при аутентификации (`AUTH_REFRESH_TOKEN_TTL_SECONDS`, по умолчанию 30 дней) | ⚠️ **Проверяется, не purge'ится** | `expiresAt` используется только чтобы отклонить просроченную сессию (`auth.guard.ts`, `auth.service.ts`); строки не удаляются после истечения — удаляются только каскадно при удалении аккаунта (`account-deletion.service.ts`). |
| `DataExportRequest.expiresAt` | `DATA_EXPORT_DOWNLOAD_TTL_SECONDS` (по умолчанию 300с на скачивание) | ⚠️ **Проверяется, не purge'ится** | Аналогично — отклоняет просроченное скачивание, не удаляет строку. |
| `AuditEvent.expiresAt` | Колонка существует | ⚠️ **Не enforced** | Ничего не читает `expiresAt`; audit-строки пишутся многими сервисами (account-deletion, data-exports, guest-imports, settings, auth, content bundle publish/rollback, users, devices) и не удаляются кроме каскада при удалении аккаунта. |
| `IdempotencyRecord` | Модель в Prisma schema | ⚠️ **Не используется** | Ни один сервис не пишет и не читает эту таблицу сегодня — задокументировано, чтобы не считалось скрытым долгом задачи #15. |
| Structured application logs / traces / error reports | Целевые 14–30д / 7–14д / 90д (см. §1) | N/A | Retention для этих сигналов управляется выбранным log/trace/error provider-ом снаружи backend-кода — до выбора provider (см. `docs/08-backend-agent-handoff.md` §12: «production analytics/crash vendor до выбора provider» — вне scope) нечего enforce-ить в этом репозитории. |

## 3. Follow-up (не в scope issue #15)

Полное покрытие TTL-очисткой каждой таблицы из §2 — отдельная задача после ревью и утверждения чисел в §1:

- добавить `expiresAt`-проверку в `AnalyticsOutboxWorker` для PENDING/FAILED строк;
- добавить cleanup в `LearningOutboxWorker`, аналогичный `AnalyticsOutboxWorker.expireDelivered()`;
- добавить периодический sweep для просроченных `RefreshSession`/`DataExportRequest`/`AuditEvent` строк (сейчас они очищаются только вместе с удалением аккаунта);
- решить, нужен ли `IdempotencyRecord` вообще, или убрать неиспользуемую модель.

Эта задача (#15) закрывает только: формализацию таблицы §1, честный аудит §2, и один прицельный кусок enforcement — `auth_rate_limit_buckets` reaper, — который является прямым следствием generalized `RateLimiter` в этой же задаче.
