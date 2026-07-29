# ADR-007: Account data export storage and delivery

- Status: Accepted
- Date: 2026-07-29

## Context

Экспорт аккаунта содержит приватные данные и должен формироваться асинхронно,
требовать свежую re-authentication, иметь короткий TTL и оставлять audit trail.
Production S3-compatible storage и его credentials пока не выбраны. Небезопасный
публичный filesystem URL или недолговечный in-memory archive не переживают
restart и не подходят даже как первый backend adapter.

## Decision

Первый durable adapter хранит JSON archive в PostgreSQL рядом с
`data_export_requests`. Архив:

- создаётся background processor после записи `PENDING` request;
- переходит через `PROCESSING` в `READY` или `FAILED`;
- доступен только по случайному download proof, от которого в БД хранится
  SHA-256;
- получает фиксированный короткий TTL, который нельзя продлить polling-ом;
- очищается при обнаружении expiry и при удалении аккаунта;
- не содержит provider/auth tokens и email identities;
- имеет SHA-256 и логический `object_key`;
- создаёт audit events для request, completion, failure и download.

Download URL не содержит user ID кроме opaque export UUID. Request logger
удаляет query string до записи, поэтому proof не попадает в application log.

## Alternatives

- In-memory archive отклонён: restart теряет готовый экспорт, пока DB продолжает
  показывать request.
- Локальный filesystem отклонён: он не разделяется между replicas и требует
  отдельной backup/cleanup policy.
- Блокирующая генерация в HTTP request отклонена: размер истории review растёт,
  а контракт требует asynchronous processing.
- Немедленное подключение S3 SDK отложено до выбора production object storage и
  credentials.

## Consequences and migration path

PostgreSQL временно несёт дополнительную краткоживущую нагрузку. TTL должен
оставаться коротким, а размер export и DB growth — наблюдаемыми. Перед
production scale-out `payload_text` заменяется adapter-ом S3-compatible storage:

1. worker пишет archive по существующему `object_key`;
2. request row хранит только checksum, status и expiry;
3. download endpoint выдаёт provider signed URL либо проксирует stream;
4. pending/ready PostgreSQL archives мигрируются или истекают по TTL;
5. API response и audit semantics остаются совместимыми.

Изменение storage adapter не меняет OpenAPI и не затрагивает canonical account
data.
