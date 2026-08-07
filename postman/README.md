# Postman

Коллекция содержит все реализованные (`x-implementation-status: implemented`
в `contracts/openapi.yaml`) HTTP endpoints и тесты основных контрактов;
endpoints со статусом `planned` (`GET /v1/entities/{entityId}`,
`GET /v1/decks/{deckId}`, `POST /v1/study-sessions/{sessionId}/complete`,
`DELETE /v1/me/progress`) в коллекции намеренно отсутствуют — их ещё нет в
runtime. Папка `Authentication` использует локальные test-only Apple/Google
tokens, сохраняет application access/refresh tokens, проверяет linking,
logout, rotation и replay detection. Папка `App Config` проверяет evaluated
feature flags и default-off advertising policy с ETag-кешированием. Папка
`Progress and Sync` покрывает account/deck progress, due-summary, achievements
и immutable change feed для пользователя, засеянного `study:seed:test`. Папка
`Analytics and Diagnostics` проверяет allowlisted product events и sanitized
MetricKit report ingestion (оба endpoint'а публичные, Authorization
опционален). Папки `Account and Settings`, `Guest Import` и
`Account Lifecycle` проверяют синхронизацию настроек и privacy consent,
безопасный список устройств, идемпотентный импорт, fresh re-authentication,
асинхронный экспорт и удаление аккаунта. Остальные динамические значения тоже
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
  `testAppleAuthorizationCode` — локальные Apple-like credentials;
- `allowDeviceRevocation` — ручное разрешение на отзыв не-текущего устройства;
- `allowAccountDeletion` — ручное разрешение на destructive удаление test
  account.

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

Полный прогон требует свежие Google и Apple provider tokens: re-auth отклоняет
token старше `AUTH_REAUTH_TOKEN_TTL_SECONDS`. Поэтому непосредственно перед
запуском выполните обе команды выше и обновите `testGoogleIdToken`,
`testAppleIdentityToken` и `testAppleRawNonce`. Экспорт создаётся асинхронно:
если первый `Get account data export` вернул `PENDING` или `PROCESSING`,
повторите запрос до `READY`, затем запускайте download.

Запросы отзыва устройства и удаления аккаунта по умолчанию пропускаются.
Включайте соответствующий opt-in только намеренно; удаление аккаунта оставлено
последним запросом коллекции и инвалидирует его sessions/identities.
