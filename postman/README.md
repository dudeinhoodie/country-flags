# Postman

Коллекция содержит все реализованные HTTP endpoints и тесты основных
контрактов. Динамические значения `manifestEtag`, `deckId`, `deckCursor` и
`cardCursor` сохраняются автоматически на уровне коллекции.

## Подготовка backend

```bash
cp backend/.env.example backend/.env
corepack yarn db:up
corepack yarn prisma:migrate:deploy
corepack yarn content:import:test
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

Fixture import разрешён только для development/test и завершится ошибкой при
`NODE_ENV=production`.
