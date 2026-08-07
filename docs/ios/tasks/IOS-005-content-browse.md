# IOS-005 — Content bootstrap, catalog и deck details

## Метаданные

- Тип: iOS vertical slice
- Приоритет: P0
- Зависимости: IOS-002, IOS-003, IOS-004
- Рекомендуемый slug: `ios-content-browse`

## Результат

Пользователь запускает приложение, получает локализованный каталог колод,
открывает колоду и после bootstrap продолжает просматривать её без сети.

## API

- `GET /v1/app-config`;
- `GET /v1/content/manifest`;
- `GET /v1/content/changes`;
- `GET /v1/decks`;
- `GET /v1/decks/{deckId}/cards`;
- `GET /v1/decks/{deckId}` и `GET /v1/entities/{entityId}` только если
  IOS-000 подтвердил необходимость/реализацию.

## Scope

- bootstrap coordinator;
- cursor pagination и resumable content sync;
- transactional mapping API → SwiftData;
- tombstones/version updates;
- asset download/cache и placeholder;
- locale selection/fallback;
- Home;
- Catalog с группировками/категориями;
- Deck Details;
- loading, empty, stale, offline и recoverable error states;
- pull-to-refresh через общий sync boundary.

## Инварианты

- UI читает SwiftData, не network response.
- Уже загруженный контент доступен при недоступном API.
- Cursor сохраняется только после успешного применения страницы.
- Повтор страницы идемпотентен.
- Unsupported card template не ломает весь catalog.

## Acceptance criteria

- fresh install Mock/Dev bootstrap показывает колоды;
- повторный bootstrap не создаёт дубли;
- interrupted page применяется заново безопасно;
- tombstone удаляет/скрывает запись согласованно;
- после bootstrap Home/Catalog/Deck работают в airplane mode;
- RU/EN меняют локализованный content или используют documented fallback;
- missing/corrupt asset показывает placeholder и diagnostic;
- unsupported card безопасно пропускается;
- offline/stale state не блокирует навигацию по cache.

## Тесты

- manifest/no-change/full-change;
- multi-page cursor;
- interruption/replay;
- tombstone;
- locale fallback;
- asset failure;
- repository-driven view models;
- UI: bootstrap → catalog → deck → offline relaunch.

## Вне задачи

- проведение study session;
- auth;
- progress/mastery UI;
- background sync guarantees;
- загрузка production каталога владельца продукта.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:297-401`, content schemas и OpenAPI responses.
Не вводить новый JSON-формат страны; использовать versioned backend snapshots.
