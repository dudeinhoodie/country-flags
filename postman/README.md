# Postman

Коллекция содержит все реализованные HTTP endpoints и тесты основных
контрактов. Динамические значения `manifestEtag`, `deckId`, `deckCursor`,
`cardCursor`, `sessionId`, review UUID, device sequence и canonical due date
сохраняются автоматически на уровне коллекции.

## Подготовка backend

```bash
cp backend/.env.example backend/.env
corepack yarn db:up
corepack yarn prisma:migrate:deploy
corepack yarn study:seed:test
corepack yarn dev
```

## Импорт в Postman

1. Импортировать `country-flags.postman_collection.json`.
2. Импортировать `local.postman_environment.json`.
3. Выбрать environment `Country Flags - Local`.
4. Запустить коллекцию целиком либо выполнять запросы сверху вниз.

В environment можно изменить:

- `baseUrl` — адрес backend;
- `locale` — локаль контента;
- `pageSize` — размер страницы карточек.
- `testAccessToken` — test-only JWT для локального пользователя.

`study:seed:test` идемпотентно импортирует content fixture, test user, active
test scheduler, test device и due/new card states. Запросы в папке `Reviews`
нужно запускать после `Create study session`; повторный запрос проверяет
idempotent `DUPLICATE`. Test auth и fixture import разрешены
только для development/test и не могут быть включены при production config.

При необходимости test-only JWT можно пересоздать командой:

```bash
corepack yarn study:token:test
```
