# IOS-000 — Backend/client readiness gate

## Метаданные

- Тип: contract/backend closure
- Приоритет: P0
- Зависимости: нет
- Рекомендуемый slug: `ios-backend-readiness`

## Результат

Подтвердить, что обязательные iOS MVP-сценарии полностью поддержаны runtime API,
и получить OpenAPI bundle, из которого официальный Swift generator создаёт
компилируемый клиент без ручных DTO.

## Контекст

`contracts/openapi.yaml` — единственный канонический REST-контракт. По правилам
`contracts/README.md`, операция `planned` стабильна на уровне дизайна, но не
имеет production route. Сейчас planned:

- `GET /v1/entities/{entityId}`;
- `GET /v1/decks/{deckId}`;
- `POST /v1/study-sessions/{sessionId}/complete`;
- `DELETE /v1/me/progress`.

Завершение сессии и очистка прогресса обязательны для полного iOS MVP.
Entity/deck detail можно удалить из client dependency только если list/card
payload содержит все данные соответствующих экранов.

## Scope

1. Сопоставить каждый iOS flow из `docs/02-ios-spec.md` с OpenAPI operation.
2. По четырём planned операциям принять и реализовать одно решение:
   - добавить runtime route, tests и status `implemented`; либо
   - доказать ненужность операции, убрать client dependency и корректно изменить contract.
3. Запустить contract bundle/check.
4. Проверить bundle официальным Swift OpenAPI Generator.
5. Добавить/проверить fixtures для:
   - app-config;
   - auth и token refresh;
   - settings ETag;
   - content manifest/changes/decks/cards;
   - study sessions и review batch partial result;
   - user changes/progress/achievements;
   - analytics/privacy.
6. Зафиксировать forward-compatible стратегию неизвестных enum.

## Архитектурные ограничения

- Не добавлять iOS-specific альтернативные routes.
- Не помечать route `implemented` без runtime controller и E2E.
- Не создавать handwritten Swift DTO как обход проблемы генератора.
- Breaking contract change следует существующей compatibility policy.

## Acceptance criteria

- все обязательные iOS операции имеют status `implemented`;
- `completeStudySession` и `deleteProgress` доступны runtime;
- для entity/deck detail есть реализованный route или документированное удаление зависимости;
- `corepack yarn contracts:check` проходит;
- bundled OpenAPI 3.1 компилируется Swift generator-ом;
- неизвестное enum не приводит к необработанному crash клиента;
- backend route/OpenAPI drift test проходит;
- change содержит тесты новых/изменённых routes.

## Проверка

~~~bash
corepack yarn contracts:check
corepack yarn workspace @country-flags/backend test:e2e
corepack yarn build
~~~

Дополнительно выполнить минимальную Swift package compile-проверку generated
client либо сохранить воспроизводимый spike в Issue/PR.

## Вне задачи

- создание Xcode app;
- UI;
- изменение бизнес-семантики scheduler/review;
- production OAuth credentials;
- выбор analytics/ad provider.

## Handoff агенту

Сначала прочитать `contracts/README.md`, `contracts/openapi.yaml`,
`docs/02-ios-spec.md` и существующие controllers/E2E. В PR явно перечислить
решение по каждой из четырёх planned operations.
