# Документация проекта Country Flags

Статус: `Product and implementation baseline 0.4`
Дата: 5 сентября 2026 года

Комплект предназначен для обсуждения продукта и последующей передачи агентам разработки.

Актуальный визуальный контракт приложения находится в [DESIGN.md](../DESIGN.md).

## Документы

- [00-product-spec.md](./00-product-spec.md) — продуктовые требования, границы MVP, модель обучения и общая архитектура.
- [01-backend-spec.md](./01-backend-spec.md) — техническое задание для NestJS-бэкенда.
- [02-ios-spec.md](./02-ios-spec.md) — техническое задание для iOS-приложения на Swift.
- [03-open-questions.md](./03-open-questions.md) — реестр принятых решений, рисков и вопросов, отложенных до соответствующего этапа.
- [04-content-json-format.md](./04-content-json-format.md) — согласованный формат исходного JSON-каталога стран, регионов и колод.
- [05-feature-flags.md](./05-feature-flags.md) — provider-agnostic подсистема удалённого включения функций.
- [06-observability-analytics.md](./06-observability-analytics.md) — логирование, crash/error reporting, метрики, трассировка и продуктовая аналитика.
- [07-advertising.md](./07-advertising.md) — архитектурная подготовка опциональной рекламы, privacy/ATT и рекламных placements.
- [08-backend-agent-handoff.md](./08-backend-agent-handoff.md) — точка входа для начала backend-разработки в VS Code.
- [09-retention.md](./09-retention.md) — утверждённая retention-политика и честный аудит того, что из неё реально enforced кодом.
- [10-backup-restore-runbook.md](./10-backup-restore-runbook.md) — PostgreSQL backup/PITR runbook, RPO/RTO цели, restore drill.
- [11-migration-deployment-runbook.md](./11-migration-deployment-runbook.md) — порядок деплоя, migrate-as-separate-step, откат миграций.
- [12-known-limitations.md](./12-known-limitations.md) — сводный список известных ограничений backend MVP.
- [13-deployment-environments.md](./13-deployment-environments.md) — local/CI/dev/prod, инфраструктура, CI/CD, миграции, backup и rollback.
- [14-deployment-agent-handoff.md](./14-deployment-agent-handoff.md) — последовательность и критерии deployment work packages.
- [15-ios-client-readiness.md](./15-ios-client-readiness.md) — сопоставление iOS-сценариев с операциями контракта, решения по planned-операциям и client fixtures.
- [16-ios-design-language.md](./16-ios-design-language.md) — визуальный язык iOS-клиента: референсы, принципы, tokens, motion, haptics и словарь нативных компонентов.
- [17-paid-decks-storekit.md](./17-paid-decks-storekit.md) — разовые покупки платных колод через StoreKit, backend entitlements, админка, refunds, restore и dev/prod separation.
- [18-multi-content-paid-decks.md](./18-multi-content-paid-decks.md) — гербы, штаты США, multi-template состав колод, расширения backend/admin/iOS и post-purchase UI.
- [19-admin-redesign.md](./19-admin-redesign.md) — task-oriented редизайн админки: draft workspace, entity/media editor, deck builder, validation и release UX.
- [20-deployment-observability.md](./20-deployment-observability.md) — что оператор видит о деплое, деградации воркера и восстановлении: сигналы, запросы, alerts, dashboard и release verification checklist.
- [ops/deployment-runbooks.md](./ops/deployment-runbooks.md) — deploy, rollback, отказ миграции, отказ backup и ротация секретов: команды, ожидаемый вывод и условия остановки.
- [ops/commerce-reconciliation-runbook.md](./ops/commerce-reconciliation-runbook.md) — сверка со Store: что делает джоб, его alerts и ручные действия.
- [ios/README.md](./ios/README.md) — порядок iOS-разработки и отдельные agent-ready спецификации IOS-000…IOS-013.
- [ADR-002](./adr/ADR-002-auth-and-refresh-token-rotation.md) — provider identities и refresh-token rotation.
- [ADR-003](./adr/ADR-003-review-ordering-and-idempotency.md) — canonical ordering, clock normalization и idempotency review.
- [ADR-004](./adr/ADR-004-fsrs6-versioning-and-migrations.md) — pinned FSRS-6 adapter, definitions и checkpoints.
- [ADR-007](./adr/ADR-007-account-data-export-storage.md) — хранение и migration path приватных account data exports.
- [ADR-008](./adr/ADR-008-deployment-topology-and-promotion.md) — Koyeb/Neon/R2 и immutable promotion dev → production.
- [ADR-009](./adr/ADR-009-generated-client-contract-shape.md) — extensible enum и nullable-структуры для генерируемых клиентов.
- [ADR-010](./adr/ADR-010-offline-study-session-import.md) — импорт офлайн-сессии: доверенные и перестраиваемые поля, отказ для объективного режима, поведение при устаревшем контенте.
- [ADR-011](./adr/ADR-011-bundled-flag-baseline.md) — флаги релиза зашиты в приложение как базовый слой, а исправления по-прежнему приезжают через content release; бандл покрывает только бесплатные колоды.
- [ADR-012](./adr/ADR-012-dark-scene-design-language.md) — всегда тёмная сцена как визуальный язык и iOS 26 как минимальная версия.
- [ADR-013](./adr/ADR-013-first-repetition-after-an-hour.md) — первый повтор назначается через час, а не через минуту.
- [ADR-014](./adr/ADR-014-admin-console-architecture.md) — архитектура админки и путь контента до релиза.
- [ADR-015](./adr/ADR-015-entity-config-and-learnable-pool.md) — учебный пул не зависит от списка «Все страны»; конфигурация сущности живёт в `config`.
- [ADR-016](./adr/ADR-016-backend-is-the-only-source-of-truth-on-the-client.md) — бэкенд единственный источник чисел на клиенте, и у каждого числа один владелец.
- [ADR-017](./adr/ADR-017-in-product-publisher-and-rollback.md) — публикация и откат из продукта: publisher-job, свой контур прав, блокировка на указателе.
- [ADR-018](./adr/ADR-018-un-policy-taught-set.md) — приложение учит 197 государств по политике ООН.
- [ADR-019](./adr/ADR-019-paid-deck-entitlements.md) — Apple non-consumable product выдаёт стабильные backend entitlements, а не открывает Deck напрямую.
- [ADR-020](./adr/ADR-020-geo-entities-and-card-variants.md) — страны и штаты используют общую GeoEntity-модель, а флаг/герб являются независимыми card variants.

## Подтверждённые продуктовые решения

1. Каталог включает все сущности из переданного владельцем продукта списка, в том числе частично признанные. Конкретный список будет предоставлен отдельно в согласованном JSON-формате.
2. Минимальная версия iOS — 17.
3. Языки первого релиза — русский и английский. Формат контента и архитектура приложения поддерживают произвольные BCP 47 locale.
4. Уровни освоения: Bronze, Silver, Gold и Platinum. Конкретные числовые пороги остаются версионируемыми и проверяются на продуктовых данных.
5. В публичный MVP входят оба режима: Anki-подобное «Обучение» с самооценкой и объективная «Проверка» с четырьмя вариантами ответа.
6. OpenFeature принят как обязательный provider-agnostic API/SDK для feature flags на backend и клиентах. Управление выполняется из отдельного интерфейса; self-hosted control plane/provider выбирается отдельно.
7. Логи, error/crash reporting и продуктовая аналитика разделены на независимые provider-agnostic подсистемы. Конкретные сервисы выбираются позднее.
8. Архитектура допускает рекламу после MVP, но первый релиз использует `NoOpAdvertisingProvider` без рекламного SDK, IDFA и ATT-запроса. Фактическое включение рекламы и provider пока не подтверждены.
9. Canonical backend scheduler — FSRS-6 через pinned `ts-fsrs`, desired retention 0.90; алгоритм и parameters версионируются отдельно.
10. Multi-device review не теряются: порядок нормализуется через client sequence/effective time, а stale events запускают deterministic reconciliation.
11. Техническая замена изображения сохраняет progress; существенная смена официального флага создаёт новую learning card.
12. Backend можно начинать с deterministic content/auth fixtures и NoOp providers, не ожидая production-каталог, credentials и внешнюю инфраструктуру.
13. Deployment разделяет local, CI, dev и production; release image один раз публикуется в GHCR, проверяется в dev и тем же artifact продвигается в production.
14. Платные колоды проектируются как разовые Apple Non-Consumable IAP: Store product выдаёт backend entitlement, Family Sharing и subscriptions не входят в первую версию.
15. Гербы являются assets страны; штаты хранятся в `geo_entities` как `SUBDIVISION` с parent relation и не считаются странами.
16. Состав колоды адресует пару `entity + card template`, поэтому флаг и герб одной страны имеют независимые карточки и progress.

## Решения по умолчанию в текущем черновике

Они считаются рабочими рекомендациями до явного подтверждения владельцем продукта.

1. iOS — первый клиент; Android и web должны подключаться к тому же API без изменения доменной модели.
2. NestJS API и PostgreSQL являются источником истины для аккаунтов, настроек и прогресса.
3. Sign in with Apple и Google Sign-In являются способами идентификации, а не отдельными хранилищами прогресса.
4. Гостевой режим работает локально и не требует аккаунта. После входа локальный прогресс переносится в серверный аккаунт.
5. Контент моделируется не как один документ «страна», а как сущности, связи, факты, медиа, учебные карточки и колоды. Это позволяет добавлять гербы, валюты, столицы, карты, регионы и исторические данные.
6. Прогресс хранится на уровне учебной карточки глобально. Колоды «Европа» и «Популярные» агрегируют состояние общих карточек, поэтому изучение одного флага не начинается заново в каждой подборке.
7. Сессия содержит настраиваемое число уникальных карточек. Повтор карточки после ошибки не увеличивает выбранный лимит, поэтому фактическое число показов может быть больше.

## Как читать формулировки

- **MUST** — обязательное требование для указанного релиза.
- **SHOULD** — рекомендуемое требование; отклонение требует зафиксированного решения.
- **MAY** — допустимое расширение.
