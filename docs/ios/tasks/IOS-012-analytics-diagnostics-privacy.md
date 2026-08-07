# IOS-012 — Analytics, diagnostics, privacy и MetricKit

## Метаданные

- Тип: iOS observability/privacy
- Приоритет: P1
- Зависимости: IOS-004, IOS-008, IOS-009
- Рекомендуемый slug: `ios-analytics-privacy`

## Результат

Приложение собирает только разрешённые типизированные события и диагностику,
переживает offline, уважает opt-out и не раскрывает PII/tokens.

## API

- `POST /v1/analytics/events/batch`;
- `POST /v1/diagnostics/metrickit`;
- `GET/PATCH /v1/me/privacy-settings`.

Event names/properties берутся из committed registries/schemas. Свободные event
names и произвольные dictionaries на public API запрещены.

## Scope

- typed analytics event API;
- local analytics outbox;
- batching, acknowledgements и retry policy;
- required/optional event classification;
- consent/opt-out;
- feature exposure events;
- MetricKit subscriber/adapter;
- pending diagnostics store/upload;
- error reporting adapter;
- request ID correlation;
- identified/anonymous context lifecycle;
- data redaction и payload size limits;
- NoOp provider по умолчанию.

## Инварианты

- Optional event не создаётся после opt-out.
- Consent change удаляет запрещённые pending events.
- Provider failure не блокирует product flow.
- Raw error text, tokens, email, provider IDs и карточные ответы не уходят без
  явного schema allowance.
- Logout/account deletion очищает identified context.
- Analytics и error reporting остаются независимыми adapters.

## Acceptance criteria

- незарегистрированное event/property невозможно отправить через typed API;
- offline events отправляются batch после восстановления сети;
- partial rejection не создаёт infinite retry;
- opt-out прекращает optional collection и очищает pending optional events;
- privacy settings синхронизируются для account;
- MetricKit payload проходит schema/size/redaction;
- support request ID связывает safe UI error и structured log;
- logout/account deletion очищает identified telemetry context;
- NoOp provider не теряет обязательную локальную policy semantics;
- release configuration готова к dSYM upload, но не требует выбранного vendor.

## Тесты

- registry compile/mapping;
- consent transitions;
- offline/online batch;
- partial rejection;
- redaction;
- MetricKit fixtures;
- context switch/logout/deletion;
- exposure once-on-use;
- provider unavailable.

## Вне задачи

- выбор/покупка vendor;
- ad attribution;
- IDFA/ATT;
- server dashboards;
- свободные debug event payloads в release.

## Handoff агенту

Прочитать `docs/06-observability-analytics.md`, analytics/privacy schemas и
`docs/02-ios-spec.md:537-649`. Сначала реализовать policy и NoOp/local
adapters; vendor SDK допустим только отдельным Issue.
