# IOS-011 — Account lifecycle

## Метаданные

- Тип: iOS account/security
- Приоритет: P1
- Зависимости: IOS-009, IOS-010
- Рекомендуемый slug: `ios-account-lifecycle`

## Результат

Пользователь управляет связанными providers и устройствами, экспортирует данные,
очищает прогресс и удаляет аккаунт непосредственно из приложения.

## API

- `GET /v1/me`, `DELETE /v1/me`;
- `GET /v1/me/identities`;
- `POST /v1/me/identities/apple|google`;
- `DELETE /v1/me/identities/{provider}`;
- `GET /v1/me/devices`;
- `DELETE /v1/me/devices/{deviceId}`;
- `POST /v1/me/data-exports`;
- `GET /v1/me/data-exports/{exportId}`;
- `GET /v1/data-exports/{exportId}/download`;
- Apple/Google reauthentication;
- progress deletion из IOS-010.

## Scope

- Account Settings;
- linked identity list/link/unlink;
- devices list/revoke;
- logout/logout-all entry points;
- export request/status/download;
- fresh re-auth coordinator;
- account deletion confirmation/status;
- deletionPending app state;
- local token/scope cleanup;
- Privacy Policy/Terms links.

## Инварианты

- Email не используется для merge.
- `IDENTITY_ALREADY_LINKED` предлагает безопасный recovery/switch, не merge.
- Sensitive operations требуют contract-defined fresh re-auth.
- Последний допустимый identity нельзя удалить с нарушением server policy.
- Обычное account deletion не отправляет пользователя писать в поддержку.

## Acceptance criteria

- identities/devices отображаются и обновляются после операций;
- linked identity conflict имеет безопасный UX;
- revoke current device корректно завершает local session;
- export переживает pending → ready и скачивается через approved URL flow;
- re-auth token не сохраняется дольше требуемого;
- deletion показывает последствия и требует явного подтверждения;
- accepted deletion очищает tokens и account scope;
- deletionPending переживает relaunch;
- после logout/deletion доступен guest core flow;
- legal links открываются и обрабатывают отсутствие сети.

## Тесты

- link/unlink/conflict;
- last identity restriction;
- device revoke/current device;
- export state machine/download failure;
- re-auth expiry;
- deletion accepted/pending/failure/relaunch;
- local cleanup isolation;
- UI account deletion smoke.

## Вне задачи

- merge аккаунтов;
- support-driven deletion;
- изменение retention policy backend;
- App Store metadata;
- subscription management.

## Handoff агенту

Прочитать `docs/02-ios-spec.md:272-295`, ADR-002, ADR-007, retention docs и
account OpenAPI. Любой sensitive token/URL обрабатывать как секретный и не
логировать.
