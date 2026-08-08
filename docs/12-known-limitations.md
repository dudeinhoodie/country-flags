# Known Limitations

Статус: `Draft — issue #16 (full E2E vertical slice & MVP release gates)`

Сводка ограничений backend MVP, уже задокументированных по отдельности в разных местах репозитория. Эта страница — индекс, не новый источник истины: при расхождении приоритет у документа, на который она ссылается.

## Инфраструктура и эксплуатация

- **Нет выбранного managed Postgres/hosting провайдера.** Backup/PITR описан как процедура, которой должен соответствовать будущий провайдер, а не как готовая интеграция — см. [10-backup-restore-runbook.md](./10-backup-restore-runbook.md) §1.
- **Нет expand/contract тулинга для zero-downtime схемных изменений.** Каждая миграция обязана быть обратно совместимой с уже запущенной предыдущей версией приложения на время rolling deploy — см. [11-migration-deployment-runbook.md](./11-migration-deployment-runbook.md) §2.
- **Не enforced несколько TTL/retention полей**: `AnalyticsOutboxEvent.expiresAt` проставляется, но не читается ни одним job; `LearningOutboxEvent`, `RefreshSession`, `DataExportRequest`, `AuditEvent` не имеют периодической очистки — только каскадное удаление при удалении аккаунта. См. [09-retention.md](./09-retention.md) §2–3.
- **Модель `IdempotencyRecord` не используется.** Определена в Prisma schema, но ни один сервис её не читает и не пишет — см. [09-retention.md](./09-retention.md) §2.

## Provider-agnostic подсистемы без выбранного provider

- **Логи, error/crash reporting и продуктовая аналитика** архитектурно разделены на independent provider-agnostic подсистемы, но конкретные внешние сервисы ещё не выбраны — см. [docs/README.md](./README.md) п.7 подтверждённых решений и [06-observability-analytics.md](./06-observability-analytics.md).
- **Feature flags** используют OpenFeature с `LocalStaticFeatureProvider` в MVP; self-hosted control plane/provider для production ещё не выбран — см. [docs/README.md](./README.md) п.6.
- **Реклама полностью отключена.** Первый релиз использует `NoOpAdvertisingProvider`, без рекламного SDK, IDFA и ATT-запроса; включение рекламы и выбор provider не подтверждены — см. [07-advertising.md](./07-advertising.md) и [docs/README.md](./README.md) п.8.

## Контент и клиенты

- **Production-каталог отсутствует.** Backend работает на минимальном детерминированном `TEST_ONLY` fixture (см. `backend/prisma/README.md`, раздел "Test-only fixtures") до передачи полного каталога владельцем продукта — см. [01-backend-spec.md](./01-backend-spec.md) §12.
- **Нет web/Android клиентов.** iOS — первый клиент; API спроектирован platform-agnostic, но web/Android реализации не входят в этот backend MVP — см. [docs/README.md](./README.md) п.1 решений по умолчанию.
- **Офлайн-сессия импортируется только в режиме `SELF_RATED`.** Объективная офлайн-сессия отклоняется `422 OFFLINE_MODE_UNSUPPORTED`, потому что `StudyOption` в контракте не несёт identity сущности-ответа, а серверная перегенерация вариантов сделала бы недействительными уже записанные клиентом `selectedOptionId`. Карточка, ставшая `RETIRED` после офлайн-выбора, отклоняет весь импорт и делает связанные review неимпортируемыми — см. [ADR-010](./adr/ADR-010-offline-study-session-import.md).

## Что не входит в scope MVP вообще

Явно исключено (не «пока не сделано», а сознательно вне scope) — полный список в [08-backend-agent-handoff.md](./08-backend-agent-handoff.md) §12: собственная CMS, собственный feature-flag UI, реальные рекламные интеграции, платные подписки/entitlements, публичные leaderboard'ы, персональная оптимизация FSRS-параметров, generative каталог контента.
