# IOS-004 — Feature flags, advertising и observability boundaries

## Метаданные

- Тип: iOS platform policies
- Приоритет: P1
- Зависимости: IOS-001, IOS-002, IOS-003
- Рекомендуемый slug: `ios-platform-policies`

## Результат

Подключить provider-agnostic системные модули так, чтобы отсутствие внешних
providers никогда не блокировало запуск и core learning experience.

## Scope

### Feature flags

- OpenFeature Swift SDK;
- `SnapshotOpenFeatureProvider`;
- typed flag registry;
- bundled defaults;
- remote snapshot из `GET /v1/app-config`;
- cached snapshot с version/fetchedAt/expiresAt;
- evaluation context на account/device/app;
- activation policies `immediate`, `nextSession`, `nextLaunch`;
- Debug/UITest overrides, исключённые из release.

### Advertising

- `AdvertisingProviding`;
- NoOp provider;
- default-off eligibility policy;
- placements без пустых UI slots;
- запрет ATT/ad SDK в MVP.

### Observability

- `AnalyticsTracking`;
- `ErrorReporting`;
- `DiagnosticsReporting`;
- structured logger/OSLog adapter;
- redaction и request ID;
- NoOp implementations.

## Инварианты

- Feature code зависит от typed wrapper, не vendor SDK.
- Remote management credentials отсутствуют в app.
- Bundled default доступен синхронно.
- Session-scoped flags фиксируются в session snapshot.
- Privacy/ad-free/consent policy сильнее remote flag.
- Exposure event создаётся при использовании feature, не при каждом чтении.

## Acceptance criteria

- cold launch работает offline без snapshot;
- invalid/expired/type-mismatched flag использует допустимый fallback;
- active study session не меняется после remote flag refresh;
- account switch обновляет context и не использует snapshot другого user;
- NoOp advertising не инициализирует SDK и не оставляет место в layout;
- ATT prompt отсутствует;
- logger редактирует tokens/PII;
- error presentation получает safe message и support request ID;
- все adapters заменяются test doubles.

## Тесты

- fallback chain;
- activation policies;
- account context switch;
- unknown/type mismatch flag;
- exposure deduplication;
- ad policy precedence/default-off;
- NoOp layout behavior;
- error/log redaction.

## Вне задачи

- внешний flag control plane;
- рекламный SDK;
- Sentry/PostHog и другие concrete providers;
- analytics upload pipeline;
- feature screens.

## Handoff агенту

Прочитать `docs/05-feature-flags.md`, `docs/06-observability-analytics.md`,
`docs/07-advertising.md` и `docs/02-ios-spec.md:182-218`. Не добавлять
provider dependency без отдельного утверждённого Issue.
