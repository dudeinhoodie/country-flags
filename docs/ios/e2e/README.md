# iOS E2E test cases

Здесь лежат подробные сквозные сценарии. Верхнеуровневая карта состояний и
атомарных проверок остаётся в [21-ios-e2e-test-plan.md](../../21-ios-e2e-test-plan.md).

## Формат test case

Каждый сценарий описывается как законченная пользовательская история:

~~~markdown
## IOS-E2E-XXX Название

- Priority: P0 | P1 | P2
- Execution: Mock CI | Dev E2E | StoreKit Test | Sandbox | Device
- Fixtures: G0, A1, N1...

### Description

Что именно доказывает сценарий и какой продуктовый риск он закрывает.

**Preconditions:**

- начальное состояние приложения;
- состояние backend/account/content;
- сеть, feature flags и системные permissions.

### Scenario

- Действие пользователя.

  **Expected result**

  - наблюдаемое изменение интерфейса;
  - подтверждаемое изменение данных или отсутствие нежелательного side effect.
~~~

Правила:

- один scenario может проверять несколько экранов, если это одна непрерывная
  пользовательская история;
- expected result проверяется после шага, а не только в конце;
- внутренние детали проверяются только через разрешённый test API, backend
  snapshot или trace — XCUITest не читает production store напрямую;
- отмена, retry, relaunch и offline являются отдельными шагами там, где они
  могут привести к потере прогресса, аккаунта или покупки;
- test case завершается явной проверкой postcondition и, где нужно, cleanup.

## Наборы

- [01-guest-auth-account.md](./01-guest-auth-account.md) — первый запуск,
  гостевой режим, Apple/Google auth, migration, sign-out и account lifecycle.
- [02-content-study.md](./02-content-study.md) — каталог, бесплатные колоды,
  self-rated, objective quiz, resume и content updates.
- [03-commerce-multicontent.md](./03-commerce-multicontent.md) — StoreKit,
  entitlements, restore/refund, гербы и штаты США.
- [04-progress-settings-sync.md](./04-progress-settings-sync.md) — progress,
  mastery, settings, reminders, privacy, offline и multi-device sync.
- [05-release-quality.md](./05-release-quality.md) — feature flags,
  compatibility, localization, accessibility, privacy и release configuration.

## Покрытие

Подробные cases объединяют атомарные строки общей матрицы. Это намеренно:
сломанная связь между двумя исправными экранами обнаруживается только длинным
E2E flow. Для локализации падения остаются короткие существующие XCUITest и
unit/integration suites.
