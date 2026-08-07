# IOS-007 — Multiple-choice study mode

## Метаданные

- Тип: iOS core learning vertical slice
- Приоритет: P0
- Зависимости: IOS-002, IOS-003, IOS-005, IOS-006
- Рекомендуемый slug: `ios-multiple-choice`

## Результат

Пользователь проходит объективную проверку с четырьмя вариантами ответа.
Правильный вариант не раскрывается до выбора, состояние переживает relaunch, а
результат можно идемпотентно синхронизировать.

## API

- `POST /v1/study-sessions` с mode `MULTIPLE_CHOICE`;
- `GET /v1/study-sessions/{sessionId}`;
- `POST /v1/reviews/batch` на следующем sync этапе;
- `POST /v1/study-sessions/{sessionId}/complete` после IOS-000.

Backend session snapshot содержит четыре versioned option snapshots и не должен
передавать клиенту признак правильного ответа до grading. Offline guest mode
может использовать только заранее доступные локализованные snapshots и
детерминированное формирование вариантов, согласованное с продуктовым контрактом.

## Scope

- objective session reducer/state machine;
- four-option presentation;
- immutable selection;
- feedback после ответа;
- selected option/correctness/timing persistence;
- relaunch/resume;
- result summary;
- recoverable UX для 422 no distractors;
- VoiceOver semantics для вариантов и feedback.

## Инварианты

- до выбора presentation state не раскрывает correct option;
- каждый вопрос имеет четыре уникальных option ID;
- локализованный display text соответствует session snapshot;
- после выбора ответ immutable;
- repeat input не меняет review;
- online/offline session явно различаются источником selection.

## Acceptance criteria

- пользователь проходит полный objective flow;
- четыре варианта уникальны;
- правильный ответ невозможно определить из публичного pre-answer view state;
- после tap выбранный ответ фиксируется ровно один раз;
- relaunch сохраняет position и answered state;
- 422 no distractors показывает понятное recoverable сообщение;
- review имеет stable UUID и повторно отправляется идемпотентно;
- result считает только committed answers;
- RU/EN и длинные названия не ломают layout.

## Тесты

- reducer pre/post answer state;
- option uniqueness;
- correct-answer secrecy;
- double tap;
- relaunch;
- 422 mapping;
- locale/long text UI;
- objective review fixture.

## Вне задачи

- общая outbox orchestration;
- progress/mastery;
- auth;
- production scheduler;
- content mining.

## Handoff агенту

Прочитать OpenAPI study schemas, backend multiple-choice E2E и
`docs/02-ios-spec.md:418-443`. Не вычислять правильность по display string:
использовать immutable IDs/versioned snapshots и backend grading contract.
