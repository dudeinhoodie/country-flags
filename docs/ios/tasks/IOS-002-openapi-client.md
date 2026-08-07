# IOS-002 — Generated OpenAPI client и transport policies

## Метаданные

- Тип: iOS networking/contracts
- Приоритет: P0
- Зависимости: IOS-000, IOS-001
- Рекомендуемый slug: `ios-openapi-client`

## Результат

Получить типизированный API client из канонического OpenAPI и общий transport
layer с безопасными auth, retry, error и observability policies.

## Scope

1. Подключить официальные Swift packages:
   - `swift-openapi-generator`;
   - `swift-openapi-runtime`;
   - `swift-openapi-urlsession`.
2. Добавить `ios/Contracts/openapi.bundle.yaml`.
3. Добавить script:
   - запускает root `contracts:bundle`;
   - обновляет committed iOS mirror;
   - проверяет drift в CI.
4. Генерировать Swift client build plugin-ом; generated Swift не коммитить.
5. Реализовать:
   - base URL из environment;
   - platform/app version/locale/template-version headers;
   - Bearer token middleware;
   - request ID;
   - typed error mapping;
   - timeout/cancellation;
   - bounded exponential backoff с jitter;
   - idempotency-aware retry;
   - redacted request logging;
   - single-flight refresh coordination boundary.
6. Создать deterministic mock transport и fixture helpers.

## Контракты

Клиент MUST покрывать все `implemented` operations из
`contracts/openapi.yaml`. Generated DTO остаются внутри Infrastructure.
Feature/domain слои получают domain models и typed domain errors.

Неизвестные JSON fields игнорируются. Для неизвестных enum обязателен fixture
test. Если generated decoder использует closed enum и падает до mapping, агент
должен предложить минимальное contract/adapter решение, а не скрывать ошибку.

## Acceptance criteria

- clean build генерирует client без committed generated Swift;
- CI обнаруживает отличие iOS mirror от root bundle;
- mock transport детерминирован и не использует сеть;
- N параллельных 401 инициируют один refresh;
- исходные запросы после успешного refresh повторяются не более одного раза;
- arbitrary POST без idempotency contract не retry-ится автоматически;
- idempotent 429/5xx получает bounded retry и учитывает cancellation;
- ErrorEnvelope преобразуется в стабильные domain errors;
- request ID доступен support UI;
- tokens и PII отсутствуют в test-captured logs.

## Тесты

- generated client compile;
- contract mirror drift;
- headers;
- 200/401/409/422/429/5xx mapping;
- refresh success/failure/concurrency;
- retry eligibility и backoff clock;
- cancellation;
- unknown fields/enum;
- redaction.

## Вне задачи

- feature repositories;
- SwiftData;
- полноценный auth UI;
- sync orchestration;
- vendor analytics/error SDK.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:155-180`, `contracts/README.md`,
`contracts/openapi.yaml` и components. Любое расхождение генератора и
контракта зафиксировать тестом и ADR/contract change, если решение архитектурное.
