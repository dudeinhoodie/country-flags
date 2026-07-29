# ADR-003: Review ordering and idempotency

- Status: Accepted
- Date: 2026-07-29

## Context

Review может быть создан без сети и доставлен повторно или не по порядку с
нескольких устройств. Потеря late event, доверие клиентскому времени или
перезапись принятого review делают progress невоспроизводимым.

## Decision

`review_events` является immutable canonical log. Клиент создаёт UUID события.
В scope пользователя одинаковый UUID с тем же canonical payload hash возвращает
`DUPLICATE`; другой payload возвращает `409 IDEMPOTENCY_CONFLICT`. Уникальный
`(user_id, device_id, client_sequence)` не позволяет повторно использовать
позицию device log.

Время нормализуется по versioned policy `review-time-v1`:

- при наличии валидного `estimatedServerOccurredAt` оно используется как
  effective time;
- оценка больше чем на 5 минут в будущем ограничивается `receivedAt`;
- расхождение raw client time и server estimate больше 30 дней считается
  повреждённой оценкой, поэтому используется `receivedAt`;
- predecessor/successor одного устройства задают миллисекундные границы;
- сохраняются raw time, estimate, effective time и `timeConfidence`.

Отсутствие или stale `baseStateVersion` не отклоняет валидный review. Canonical
replay строит причинные edges по `clientSequence` внутри устройства. Среди
доступных событий выбирается минимальное по
`effectiveOccurredAt → receivedAt → UUID`. Так поздний predecessor не может
оказаться после successor, а порядок между устройствами остаётся
детерминированным.

Каждое accepted событие обрабатывается в PostgreSQL `SERIALIZABLE` transaction
под advisory lock `(userId, learningCardId)`. В одной transaction создаются
immutable review, заменяемая projection и запись `learning_outbox`. Batch
допускает per-event `REJECTED`, но accepted event никогда не остаётся без
projection/outbox.

`learning_outbox` является внутренней operational queue и содержит только
ссылку на review и версию projection. Он отделён от `analytics_outbox`, чтобы не
копировать покарточную историю в продуктовую аналитику.

## Alternatives

- Last-write-wins по времени клиента отклонён: часы устройства не являются
  доверенным источником и могут удалить корректный offline progress.
- Только in-memory idempotency отклонена: retry после restart создавал бы дубль.
- Обновление effective time ранее принятых строк отклонено: canonical history
  должна оставаться immutable.

## Consequences

Replay дороже обычного incremental update, но остаётся предсказуемым для MVP.
Worker/reconciliation может позднее оптимизировать replay checkpoints, не меняя
canonical ordering. Client time запрещено использовать для auth, entitlement и
других security решений.
