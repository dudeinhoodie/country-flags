# Postman

Коллекция содержит все реализованные HTTP endpoints и тесты основных
контрактов. Папка `Authentication` использует локальные test-only Apple/Google
tokens, сохраняет application access/refresh tokens, проверяет linking,
logout, rotation и replay detection. Остальные динамические значения тоже
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
- `testGoogleIdToken` — локальный Google-like ID token;
- `testAppleIdentityToken`, `testAppleRawNonce` и
  `testAppleAuthorizationCode` — локальные Apple-like credentials.

`study:seed:test` идемпотентно импортирует content fixture, test user, active
test scheduler, test device и due/new card states. Запросы в папке `Reviews`
нужно запускать после `Create study session`; повторный запрос проверяет
idempotent `DUPLICATE`. Test auth и fixture import разрешены
только для development/test и не могут быть включены при production config.

При необходимости test-only JWT можно пересоздать командой:

```bash
corepack yarn study:token:test
```

Provider tokens можно пересоздать без обращения к Apple/Google:

```bash
corepack yarn auth:provider-token:test google
corepack yarn auth:provider-token:test apple
```

Команды печатают JSON. Скопируйте `token` и Apple `rawNonce` в Postman
environment. Эти credentials принимаются только при
`AUTH_PROVIDER_TEST_TOKENS_ENABLED=true`; production-конфигурация с таким
режимом не запускается.
