# IOS-009 — Apple/Google auth и guest migration

## Метаданные

- Тип: iOS identity/security
- Приоритет: P0
- Зависимости: IOS-002, IOS-003, IOS-008
- Рекомендуемый slug: `ios-auth-guest-migration`

## Результат

Пользователь входит через Apple или Google, получает безопасную backend session
и идемпотентно переносит локальный гостевой прогресс в свой аккаунт.

## API

- `POST /v1/auth/apple`;
- `POST /v1/auth/google`;
- `POST /v1/auth/refresh`;
- `POST /v1/auth/logout`;
- `POST /v1/auth/logout-all`;
- `GET /v1/me`;
- `POST /v1/me/guest-imports`;
- `GET /v1/me/guest-imports/{migrationId}`.

## Scope

### Apple

- native `ASAuthorizationAppleIDButton`;
- cryptographic raw nonce + hash;
- identity token и authorization code;
- first-login-only name/email;
- credential state check.

### Google

- официальный Google Sign-In SDK через SPM;
- URL callback/configuration;
- ID token для backend server client ID;
- branding и cancellation semantics.

### Backend session

- access/refresh tokens в Keychain;
- in-memory access token cache;
- single-flight refresh;
- authenticationExpired state;
- logout/logout-all;
- pending review warning/strategy.

### Guest migration

- stable `migrationId`;
- перенос тех же review UUID;
- server status polling/retry;
- archival cleanup только после acknowledgement;
- защита от импорта scope другого пользователя.

## Инварианты

- provider user ID не является credential.
- Tokens отсутствуют в SwiftData/UserDefaults/logs/analytics/clipboard.
- Email не используется для автоматического account merge.
- Cancel — нормальный outcome, а не system error.
- Guest flow остаётся доступен без login.

## Acceptance criteria

- Apple/Google success, cancel и error различаются;
- повторный Apple login работает без name/email;
- nonce/token/code соответствуют OpenAPI;
- concurrent 401 выполняет один refresh;
- invalid refresh переводит app в authenticationExpired без потери guest data;
- guest import безопасно повторяется после network failure;
- UUID review не меняются;
- чужой предыдущий account scope не импортируется;
- logout не удаляет unsynced data молча;
- tokens проходят Keychain persistence/relaunch test.

## Тесты

- auth adapters с provider test doubles;
- nonce generation/hash;
- backend request fixtures;
- cancellation;
- refresh rotation/concurrency/failure;
- migration replay/status;
- account scope ownership;
- logout pending-review UX;
- UI auth smoke с mocks.

## Вне задачи

- реальные production credentials в git;
- merge аккаунтов;
- linked identity management;
- account deletion;
- iCloud как отдельное хранилище прогресса.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:220-270`, auth OpenAPI и ADR-002. Реальные
Apple/Google credentials подключать только через local/CI secrets; до их
получения flow обязан полностью тестироваться adapters/fixtures.
