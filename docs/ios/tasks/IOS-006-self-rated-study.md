# IOS-006 — Guest self-rated study session

## Метаданные

- Тип: iOS core learning vertical slice
- Приоритет: P0
- Зависимости: IOS-003, IOS-005
- Рекомендуемый slug: `ios-self-rated-study`

## Результат

Гость без аккаунта проходит полный Anki-подобный flow на 5/10/20 карточек,
может закрыть приложение и продолжить с точного места, а каждый ответ надёжно
сохранён локально до следующей карточки.

## Scope

- pure Swift session reducer/state machine;
- deterministic clock/UUID injection;
- local offline card selection из выбранной колоды;
- immutable card/template/content snapshot на момент сессии;
- front: флаг/медиа;
- back: локализованная страна и дополнительные факты;
- actions Again/Hard/Good/Easy;
- local conservative scheduler projection;
- active session persistence;
- relaunch/resume;
- session result;
- session size setting 5/10/20;
- accessibility identifiers и basic VoiceOver labels.

## Инварианты

- выбранное число означает уникальные карточки, а не число показов;
- feature/template/mode/card composition фиксируются на старте;
- review UUID создаётся до перехода;
- review и outbox/local pending marker сохраняются транзакционно;
- rapid repeat input обрабатывается один раз;
- local projection не выдаётся за канонический backend scheduler.

## Acceptance criteria

- гость проходит 5, 10 и 20 unique cards;
- front/back не раскрывают ответ раньше flip;
- каждая rating сохраняется до next card;
- double tap не создаёт duplicate review;
- kill после commit восстанавливает следующую карточку;
- kill до commit повторно показывает текущую карточку без review;
- unsupported mandatory template пропускается с безопасным UX;
- session flags snapshot не меняется после refresh;
- результат отражает фактически сохранённые review;
- flow полностью работает offline после content bootstrap.

## Тесты

- reducer transitions;
- 5/10/20 selection uniqueness;
- repeat-after-error semantics;
- transaction failure;
- rapid tap/concurrency;
- relaunch before/after commit;
- unsupported template;
- local projection replacement boundary;
- UI guest happy path и relaunch.

## Вне задачи

- multiple-choice;
- отправка backend review batch;
- Apple/Google login;
- server mastery calculation;
- сложная анимация/visual polish.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:403-443`, `docs/02-ios-spec.md:485-496` и
продуктовый learning flow. State machine реализовать и протестировать вне
SwiftUI до создания screens.
