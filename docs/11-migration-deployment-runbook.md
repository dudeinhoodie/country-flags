# Migration & Deployment Runbook

Статус: `Draft — issue #15 (security & production hardening)`

Дополняет [01-backend-spec.md](./01-backend-spec.md) §13 ("readiness с проверкой PostgreSQL; liveness без внешних тяжёлых вызовов; graceful shutdown; миграции как отдельный deployment step") конкретной последовательностью развёртывания и честной фиксацией текущих ограничений.

## 1. Порядок деплоя

1. **Migrate** — `yarn prisma:migrate:deploy` против production DB, отдельный шаг, отдельная роль/доступ, до запуска новой версии приложения. Это уже так реализовано и в CI (`.github/workflows/backend-ci.yml`), и является обязательным шагом перед `docker run` новой версии образа.
2. **Deploy** — раскатка нового контейнера (`country-flags-backend:local`/registry-тег), пока старая версия продолжает обслуживать трафик.
3. **Health-gate** — оркестратор не считает новый под готовым, пока `/v1/health/ready` не вернёт `200`. `/v1/health/live` используется только чтобы решить «перезапускать ли процесс», не «готов ли принимать трафик».
4. **Drain старой версии** — на `SIGTERM` приложение сначала помечает readiness как `503` (`HealthService.beforeApplicationShutdown`, см. `backend/src/modules/health/health.service.ts`), ждёт `SHUTDOWN_DRAIN_MS` (по умолчанию 5000мс, `backend/.env.example`), и только затем закрывает HTTP-сервер — это даёт время балансировщику перестать направлять новый трафик до фактического закрытия соединений.
5. **Rollback** — откат контейнера на предыдущий тег. Миграции откатываются отдельной осознанной операцией (см. §3), не автоматически при откате приложения.

## 2. Текущее ограничение: нет expand/contract тулинга

В проекте нет специальной поддержки zero-downtime схемных изменений (expand/contract, dual-write, online migration framework). Это значит:

- каждая миграция обязана быть **обратно совместимой** с уже запущенной предыдущей версией приложения, пока раскатка не завершится (rolling deploy держит старую и новую версию одновременно);
- недопустимо в одной миграции одновременно убирать колонку/таблицу, которую всё ещё читает предыдущая версия;
- деструктивные изменения (drop column, rename, NOT NULL без default) делаются в два релиза: (1) добавить/расширить и научить новую версию писать в оба места, дождаться полной раскатки, (2) отдельным релизом убрать старое;
- при необходимости breaking-изменения без двухфазного подхода — только в объявленное maintenance window.

Это ограничение существующей архитектуры, а не что-то, что вводит issue #15; документируется здесь впервые.

## 3. Откат миграций

`prisma migrate deploy` не поддерживает автоматический down-migration. Откат схемы — ручная операция:

1. Написать компенсирующую миграцию (предпочтительно) вместо `prisma migrate resolve --rolled-back`, если возможно.
2. Если откат обязателен до релиза компенсирующей миграции — восстановление из PITR/snapshot, см. [10-backup-restore-runbook.md](./10-backup-restore-runbook.md).

## 4. Readiness/liveness контракт

| Проверка | Endpoint | Что проверяет | Что НЕ проверяет |
| --- | --- | --- | --- |
| Liveness | `GET /v1/health/live` | Процесс жив и отвечает | Внешние зависимости — намеренно, чтобы не рестартовать под из-за временной недоступности БД |
| Readiness | `GET /v1/health/ready` | PostgreSQL отвечает (`PrismaService.ping()`); `503` немедленно, если получен сигнал остановки | Не гарантирует отсутствие деградации отдельных фич (feature flag provider, analytics exporter — они no-op-безопасны по дизайну) |

## 5. Что проверить перед первым production релизом

- [ ] `prisma migrate deploy` прогнан на чистой БД с нуля (см. `test/migrations.e2e-spec.ts` как обязательный CI gate).
- [ ] Container smoke test (non-root, health endpoint) зелёный в CI (`.github/workflows/backend-ci.yml`, job `quality`).
- [ ] Restore drill пройден хотя бы один раз вручную (`backend/scripts/db-backup-restore-drill.sh`), см. [10-backup-restore-runbook.md](./10-backup-restore-runbook.md).
- [ ] `SHUTDOWN_DRAIN_MS` и `CORS_ALLOWED_ORIGINS` заданы явно в production-конфигурации, не оставлены на dev-дефолты.
