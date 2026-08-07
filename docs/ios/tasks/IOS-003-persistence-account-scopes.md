# IOS-003 — SwiftData schema, account scopes и repositories

## Метаданные

- Тип: iOS persistence
- Приоритет: P0
- Зависимости: IOS-001
- Рекомендуемый slug: `ios-persistence-scopes`

## Результат

Создать надёжный offline-first local store, который переживает relaunch,
поддерживает миграции и физически/логически изолирует гостя и разных
authenticated users.

## Scope

Реализовать versioned SwiftData schema для:

- content manifest, entities, localized names, assets, facts;
- decks, learning cards и deck-card relations;
- user settings, card state, deck progress, achievements;
- study session, immutable session card snapshots и review events;
- outbox operations;
- analytics events, privacy settings и pending diagnostics;
- sync cursors.

Добавить:

- `AccountScope.guest(deviceId)` и `authenticated(userId)`;
- repository protocols в Domain;
- SwiftData implementations в Infrastructure;
- transaction boundary review + outbox;
- Keychain protocol/adapter для tokens;
- migration plan/version registry;
- Debug/UITest-only reset.

## Инварианты

- UI наблюдает local store.
- Network layer не возвращает SwiftData models.
- Каждый user-owned record имеет scope.
- `LocalReviewEvent.id` создаётся до следующей карточки и immutable.
- Secrets хранятся только в Keychain.
- Обновление приложения не стирает pending outbox.
- Logout не раскрывает данные предыдущего аккаунта.

## Acceptance criteria

- guest и два user scope не читают данные друг друга;
- file-backed store восстанавливает active session/review/outbox после relaunch;
- review и outbox создаются одной транзакцией;
- injected transaction failure не оставляет половинчатую запись;
- migration fixture сохраняет pending outbox;
- content records могут быть общими, user records всегда scoped;
- logout cleanup затрагивает только выбранный scope;
- release build не содержит reset database;
- SwiftData/UserDefaults не содержат tokens.

## Тесты

- in-memory repository tests;
- file-backed relaunch tests;
- schema migration fixtures;
- transaction rollback;
- account isolation;
- content tombstone/version update;
- Keychain adapter contract с test double;
- concurrent review write.

## Вне задачи

- screen UI;
- network sync;
- реальный Keychain access group для extensions;
- production data migration из несуществующей старой версии.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:93-153`. Не привязывать domain protocols к
`ModelContext`. Сначала зафиксировать schema/invariants тестами, затем
реализовать repositories.
