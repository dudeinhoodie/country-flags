# PostgreSQL Backup & Restore Runbook

Статус: `Draft — issue #15 (security & production hardening)`

Конкретизирует требования [01-backend-spec.md](./01-backend-spec.md) §13: `RPO ≤ 15 минут`, `RTO ≤ 4 часов` для MVP production, ежедневные encrypted snapshots с начальным retention 30 дней, документированная проверка restore перед первым production release и затем минимум ежеквартально.

## 1. Что это НЕ покрывает

Этот репозиторий не провижинит реальную production-инфраструктуру — нет выбранного managed Postgres/hosting провайдера на момент написания. Этот документ фиксирует **процедуру**, которой должен соответствовать любой выбранный провайдер, плюс единственную часть, которую можно реально проверить сегодня: dump/restore round-trip против локальной/CI базы (см. §4).

## 2. Целевые показатели

| Показатель | Цель | Как достигается |
| --- | --- | --- |
| RPO (Recovery Point Objective) | ≤ 15 минут | Continuous WAL-archiving / managed PITR у выбранного Postgres-провайдера (например `pgbackrest`/`wal-g` при self-hosted варианте, или встроенный PITR у managed-предложения). Ежедневный full snapshot сам по себе НЕ даёт RPO 15 минут — нужен continuous WAL shipping между snapshot'ами. |
| RTO (Recovery Time Objective) | ≤ 4 часов для MVP production | Бюджет разбивается: provision replacement instance (~30 мин) + restore latest base backup (замерено drill-скриптом, см. §4) + replay WAL до целевой точки + smoke-test (`/v1/health/ready` + read-запрос) + переключение трафика. |
| Snapshot cadence | Ежедневно | Managed snapshot feature провайдера, или `pg_dump`/`pg_basebackup` по cron на self-hosted. |
| Snapshot retention | 30 дней (начальная) | Провайдер-специфичная lifecycle policy на storage. |
| Restore verification | Перед первым production release, затем ≥ ежеквартально | `backend/scripts/db-backup-restore-drill.sh`, см. §4; расписание — `.github/workflows/backup-restore-drill.yml`. |

## 3. Порядок восстановления (при реальном инциденте)

1. Определить целевую точку восстановления (последний известный good state / момент до инцидента).
2. Поднять замену БД у провайдера из последнего snapshot ≤ целевой точки.
3. Применить WAL до целевой точки (PITR) — если провайдер это поддерживает; иначе restore ограничен точностью последнего snapshot.
4. Прогнать `prisma migrate deploy` **только если** восстановленный snapshot старше последней применённой миграции (обычно не требуется — snapshot уже включает применённые миграции).
5. Smoke-test: `GET /v1/health/ready` возвращает `200`, ручной sanity-запрос (`SELECT count(*) FROM users` или аналог) даёт разумное значение.
6. Переключить `DATABASE_URL` приложения на восстановленный instance, раскатать/рестартовать backend.
7. Постфактум: задокументировать инцидент, фактический RTO, расхождение с целью.

## 4. Restore drill (единственная часть, проверяемая в этом репозитории)

`backend/scripts/db-backup-restore-drill.sh`:

- берёт `DATABASE_URL` (та же переменная, что использует backend);
- `pg_dump --format=custom` исходную базу;
- создаёт временную scratch-базу на том же сервере;
- `pg_restore` дампа в scratch-базу;
- сравнивает построчный `count(*)` по каждой таблице `public`-схемы между источником и восстановленной копией;
- падает с ненулевым кодом при любом расхождении;
- подчищает за собой scratch-базу и временные файлы.

Использует `docker run postgres:16-alpine` для `pg_dump`/`pg_restore`/`psql`, а не системные `postgresql-client`, — версия клиента гарантированно совпадает с сервером, который реально использует этот проект (`infrastructure/compose.yaml`, `backend-ci.yml`), и ничего дополнительно не нужно ставить ни локально, ни в CI.

Запуск локально:

```bash
DATABASE_URL="postgresql://country_flags:country_flags@localhost:5432/country_flags?schema=public" \
  bash backend/scripts/db-backup-restore-drill.sh
```

Запуск в CI: `.github/workflows/backup-restore-drill.yml`, вручную (`workflow_dispatch`) или по расписанию (ежемесячно) — **не** на каждый PR, по той же логике, что и `content-source-refresh.yml`: это проверка живучести процедуры, а не gate для обычной разработки.

Ограничение: drill проверяет только механику dump/restore/сверка на одном сервере. Он не проверяет continuous WAL-archiving/PITR конкретного production-провайдера — это должно быть подтверждено отдельно после выбора провайдера, следуя той же процедуре восстановления (§3) на его реальной инфраструктуре, до первого production release.
