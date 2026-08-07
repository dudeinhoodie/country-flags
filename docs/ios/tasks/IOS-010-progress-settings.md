# IOS-010 — Progress, mastery, achievements и settings

## Метаданные

- Тип: iOS product features
- Приоритет: P1
- Зависимости: IOS-008, IOS-009
- Рекомендуемый slug: `ios-progress-settings`

## Результат

Authenticated пользователь видит канонический прогресс и достижения, а его
настройки, включая размер сессии, синхронизируются между устройствами с
предсказуемым разрешением конфликтов.

## API

- `GET /v1/me/due-summary`;
- `GET /v1/me/progress`;
- `GET /v1/me/decks/{deckId}/progress`;
- `GET /v1/me/achievements`;
- `GET/PATCH /v1/me/settings`;
- `DELETE /v1/me/progress` после IOS-000;
- reauthentication operations для clear progress.

## Scope

- Progress overview;
- deck/region progress;
- due summary;
- Achievements;
- server-defined mastery tiers Bronze/Silver/Gold/Platinum и unknown-safe display;
- Settings UI;
- 5/10/20 session size;
- ETag/If-Match optimistic concurrency;
- deterministic conflict reload/merge UX;
- notification preferences и local scheduling;
- clear progress confirmation + re-auth;
- offline cached states.

## Инварианты

- Клиент отображает, но не пересчитывает канонические mastery thresholds.
- Unknown future tier не вызывает crash.
- Settings version/ETag не игнорируется.
- Notification permission отказ не ограничивает обучение.
- iOS background delivery не обещается пользователю как точное расписание.

## Acceptance criteria

- progress и deck progress отображаются из local synced store;
- achievement unlock появляется после sync без duplicate celebration;
- known и unknown mastery tiers имеют безопасный UI;
- session size сохраняется guest-local и server-synced для account;
- 412/409 settings conflict даёт deterministic recovery;
- два устройства сходятся к server settings;
- notification denied/disabled state корректен;
- clear progress требует fresh re-auth;
- local progress очищается только после accepted server result/status.

## Тесты

- progress mapping;
- achievement deduplication;
- unknown tier;
- ETag success/conflict/reload;
- guest/auth settings transition;
- notification authorization states;
- clear progress re-auth/success/failure;
- offline cached screens.

## Вне задачи

- изменение server mastery thresholds;
- social leaderboards;
- push notification provider;
- widgets/live activities;
- account deletion.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:445-496`, settings/progress/achievement schemas
и backend progress tests. Не дублировать FSRS/mastery business rules в Swift.
