# ADR-007: Account data export storage and delivery

- Status: Accepted
- Date: 2026-07-29
- Amended: 2026-09-28 (archive contents, `schemaVersion: 2`)

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
- не содержит provider/auth tokens, token hashes и keyed hashes (IP, install ID,
  подписанных payload); provider subject и email identities включаются начиная
  со `schemaVersion: 2` (см. "Изменение от 2026-09-28");
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

## Изменение от 2026-09-28: состав архива (`schemaVersion: 2`)

### Причина

Privacy Policy (`backend/seed/site-documents/privacy.*.md`) перечисляет как
хранимые данные аккаунта идентификатор, который назначает Apple или Google,
email, display name, прогресс с историей сессий и наградами, настройки,
устройства и записи sign-in sessions с User-Agent, а также перенос гостевого
прогресса. Экспорт `schemaVersion: 1` не содержал email identities, provider
subject, согласия и их историю, study sessions, per-deck mastery, sign-in
sessions, guest imports и покупки (#452). Копия данных по праву доступа должна
включать то, что аккаунт действительно хранит, поэтому исключение email
identities и provider subject из исходного решения отменено.

### Решение

- Архив `schemaVersion: 2` описан каноническим JSON Schema
  `contracts/schemas/account/data-export.v2.schema.json`; OpenAPI ссылается на
  него в ответе `downloadDataExport`.
- Добавлены разделы и поля: `providerSubject`, email и его признаки в
  `authenticationProviders`; `removedAt` у устройств (удалённое устройство
  хранится, потому что на него ссылаются reviews); `signInSessions` (время
  создания, использования, истечения, отзыва и User-Agent); `guestImports`;
  `privacySettings` и `consentHistory`; `studySessions` с составом карточек;
  `deckMastery` (цифры, которые в момент экспорта отдаёт `GET /v1/me/progress`
  через `ProgressService`, то есть то, что показывает приложение; кэш
  `user_deck_mastery` обновляют только записи, и он может отставать от истории
  ответов, поэтому напрямую не читается); `purchases` и `entitlementGrants`.
- По-прежнему не включаются provider/auth tokens, token hashes и keyed hashes
  (IP-адрес сессии, install ID гостя, подписанный payload покупки), а также
  `storeAccountToken` и служебные идентификаторы sync/replay: они ничего не
  сообщают читателю копии и только расширяют то, что раскроет утёкший архив.
- `analytics_outbox` не входит в архив: это очередь доставки, строка которой
  живёт не дольше часа после доставки и не дольше 7 дней без неё, а не
  хранилище аналитики.

### Альтернативы

- Оставить email и provider subject вне архива: отклонено, копия расходилась
  бы с Privacy Policy.
- Пересчитывать mastery при экспорте: отклонено, это второе определение
  mastery, которое может разойтись с тем, что показывает приложение.
- Сворачивать sign-in sessions по token family: отклонено, архив передаёт
  записи так, как они хранятся.

### Последствия и migration path

Архив становится крупнее за счёт study sessions и sign-in sessions; TTL и
хранение не меняются. Потребители различают формат по `schemaVersion`; iOS
передаёт архив пользователю как непрозрачный файл, поэтому смена версии не
требует изменений клиента. Следующее изменение формата добавляет новую версию
схемы, а не правит v2.
