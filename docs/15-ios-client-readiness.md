# iOS client readiness gate

Статус: `Closed 1.0`
Дата: 7 августа 2026 года

Документ фиксирует результат IOS-000: сопоставление каждого iOS-сценария из
[02-ios-spec.md](./02-ios-spec.md) с операцией канонического контракта, решение
по четырём `planned` операциям и подтверждённые ограничения, которые iOS-агент
обязан учитывать.

## 1. Сопоставление flow → operation

| iOS flow (раздел ТЗ)                        | Операция                                                        | Статус        |
| ------------------------------------------- | --------------------------------------------------------------- | ------------- |
| Запуск, forced/soft update, feature flags (§6.2, §6.3) | `getAppConfig`                                        | implemented   |
| Onboarding, Sign in with Apple (§7.2)       | `authenticateWithApple`                                          | implemented   |
| Onboarding, Google Sign-In (§7.3)           | `authenticateWithGoogle`                                         | implemented   |
| Автоматический refresh при 401 (§6.1)       | `refreshSession`                                                 | implemented   |
| Re-authentication перед опасной операцией (§7.6) | `reauthenticateApple`, `reauthenticateGoogle`                | implemented   |
| Logout / logout на всех устройствах (§7.4)  | `logout`, `logoutAll`                                            | implemented   |
| Профиль и статус аккаунта (§9.9)            | `getMe`, `updateMe`                                              | implemented   |
| Связывание и отвязка провайдеров (§7.6)     | `listIdentities`, `linkAppleIdentity`, `linkGoogleIdentity`, `unlinkIdentity` | implemented |
| Список устройств (§9.9)                     | `listDevices`, `deleteDevice`                                    | implemented   |
| Настройки учёбы, языка, напоминаний (§9.9, §11) | `getSettings`, `updateSettings` (ETag/`If-Match`)            | implemented   |
| Перенос гостевого прогресса (§7.5)          | `createGuestImport`, `getGuestImport`                            | implemented   |
| Экспорт данных (§7.6)                       | `createDataExport`, `getDataExport`, `downloadDataExport`        | implemented   |
| Удаление аккаунта (§7.6)                    | `deleteMe`                                                       | implemented   |
| Bootstrap контента (§8.3)                   | `getContentManifest`                                             | implemented   |
| Инкрементальная синхронизация контента (§8.3) | `getContentChanges`                                            | implemented   |
| Применение изменения `resourceType=ENTITY` (§8.3) | `getEntity`                                                | **implemented (IOS-000)** |
| Catalog: список колод (§9.3)                | `listDecks`                                                      | implemented   |
| Deck Details и deep link на колоду (§9.4)   | `getDeck`                                                        | **implemented (IOS-000)** |
| Состав колоды и карточки (§9.4, §8.3)       | `listDeckCards`                                                  | implemented   |
| Старт сессии 5/10/20, оба режима (§9.5, §9.6) | `createStudySession`                                           | implemented   |
| Восстановление сессии после relaunch (§9.5) | `getStudySession`                                                | implemented   |
| Session Result и `study.session_completed` (§9.7) | `completeStudySession`                                     | **implemented (IOS-000)** |
| Отправка outbox с review (§8.2)             | `createReviewBatch`                                              | implemented   |
| Приём canonical card states (§8.1)          | `getUserChanges`                                                 | implemented   |
| Home: «к повторению сегодня» (§9.2)         | `getDueSummary`                                                  | implemented   |
| Экран прогресса (§9.8)                      | `getProgress`, `getDeckProgress`                                 | implemented   |
| Достижения (§9.8)                           | `listAchievements`                                               | implemented   |
| Очистка учебного прогресса (§9.9)           | `deleteProgress`                                                 | **implemented (IOS-000)** |
| Продуктовая аналитика batch (§14)           | `createAnalyticsBatch`                                           | implemented   |
| MetricKit диагностика (§14)                 | `createMetricKitReport`                                          | implemented   |
| Экран Privacy и consent (§9.9)              | `getPrivacySettings`, `updatePrivacySettings`                    | implemented   |

Все обязательные для MVP операции имеют `x-implementation-status: implemented`,
runtime route и E2E-покрытие. Соответствие проверяется тестом
`backend/test/openapi-drift.e2e-spec.ts`.

## 2. Решение по четырём `planned` операциям

| Операция               | Решение                          | Обоснование                                                                                                     |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `completeStudySession` | Реализована                      | Session Result (§9.7) строится из сохранённого summary и переживает повторное открытие; событие `study.session_completed`. |
| `deleteProgress`       | Реализована                      | «Очистить учебный прогресс» — обязательный пункт Account Settings (§7.6, §9.9).                                    |
| `getEntity`            | Реализована                      | Лента `getContentChanges` возвращает `resourceType=ENTITY`; без detail-route клиент не может применить изменение точечно. |
| `getDeck`              | Реализована                      | Deck Details и deep link открывают колоду по ID без загрузки страницы каталога; удаление операции потребовало бы major-версии API. |

Семантика реализованных операций:

- `completeStudySession` идемпотентна. Первый принятый вызов фиксирует
  канонический summary из уже принятых review событий сессии; повторный вызов
  возвращает его без изменений. Клиентский `completedAt` ограничен началом
  сессии снизу и временем приёма сервером сверху с тем же допуском перекоса,
  что и при приёме review, поэтому съехавшие часы устройства не дают
  отрицательную или завышенную длительность.
- `deleteProgress` требует свежую re-authentication и тело
  `{"confirmation":"DELETE_PROGRESS"}`. Удаляются review history, card states,
  study sessions, achievements, deck mastery, pending projection work и журнал
  изменений. Аккаунт, identities, устройства и настройки сохраняются.
  Идентификатор потока изменений ротируется: курсоры, выданные до удаления,
  перестают резолвиться (`400 VALIDATION_FAILED`), и каждое устройство обязано
  выполнить полную повторную синхронизацию прогресса.
- `getEntity` не отдаёт скрытые из каталога сущности: скрытие доставляется
  клиенту как `RETIRE` в ленте изменений.
- `getDeck` возвращает то же представление, что и страница списка; прогресс по
  колоде остаётся в `getDeckProgress`.

## 3. Форма контракта для генерируемых клиентов

Проверка выполнена официальным Swift OpenAPI Generator (`contracts/swift-client-check`).
Полное обоснование — [ADR-009](./adr/ADR-009-generated-client-contract-shape.md).

- **Неизвестные enum.** Значения, которыми владеет content pipeline
  (`Asset.type`, `Fact.type`, `GeoEntity.kind`, `GeoEntity.recognitionStatus`,
  `Deck.kind`, `ContentChange.resourceType`, `StudySessionCard.selectionReason`,
  `UserSettings.extraFactTypes`), объявлены как `type: string` с
  `x-extensible-enum`. Клиент обязан отображать неизвестное значение в
  собственный `unknown(String)` и деградировать только затронутый элемент UI.
  Протокольные enum остаются закрытыми; добавление значения в них — breaking
  change с major-версией API. Ссылочная реализация обёртки —
  `contracts/swift-client-check/Sources/CountryFlagsAPI/ExtensibleEnum.swift`.
- **Nullable-структуры.** Генератор пропускает `oneOf: [$ref, type: "null"]` и
  молча выбрасывает такое поле из сгенерированного типа. До IOS-000 из клиента
  выпадали `StudySession.summary`, `ReviewResult.canonicalRating`,
  `ReviewResult.cardState`, `UserChange.payload`, `Deck.currentMasteryTier` и
  `Achievement.tier` — то есть канонический card state и результат сессии. Эти
  поля описаны обычным `$ref` и являются необязательными, а backend не отправляет
  для них `null`, а опускает их.

## 4. Fixtures

`contracts/fixtures/openapi/` содержит ответы, пригодные для iOS mock server и
проверяемые против bundled-контракта командой `corepack yarn contracts:fixtures`
(входит в `contracts:check`).

| Область                    | Fixture                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| app-config                 | `configuration/app-config.valid.json`                                                        |
| auth и token refresh       | `openapi/auth-session.json`, `openapi/token-refresh.json`                                    |
| settings и ETag            | `openapi/settings.json`, `openapi/settings-unknown-fact-type.json`                            |
| content manifest           | `content/manifest.valid.json`                                                                 |
| content changes            | `openapi/content-changes.json`, `openapi/content-changes-unknown-resource.json`               |
| decks и cards              | `openapi/deck.json`, `openapi/decks.json`, `openapi/deck-cards.json`, `openapi/deck-unknown-kind.json` |
| entity detail              | `openapi/entity.json`, `openapi/entity-unknown-taxonomy.json`                                 |
| study sessions             | `openapi/study-session-self-rated.json`, `openapi/study-session-multiple-choice.json`, `openapi/study-session-completed.json` |
| review batch partial result | `openapi/review-batch-partial.json`                                                          |
| user changes               | `openapi/user-changes.json`                                                                   |
| progress и achievements    | `openapi/progress.json`, `openapi/progress-deletion.json`, `openapi/achievements.json`        |
| analytics и privacy        | `analytics/batch.valid.json`, `openapi/privacy-settings.json`                                 |
| error envelope             | `openapi/error-envelope.json`                                                                 |

Settings ETag: `getSettings` возвращает `ETag: W/"<version>"`, `updateSettings`
требует `If-Match` с тем же форматом; поле `version` в fixture — источник этого
значения.

## 5. Проверка Swift-клиента

```bash
corepack yarn contracts:bundle
contracts/swift-client-check/run.sh
```

Скрипт копирует `contracts/dist/openapi.bundle.yaml` в SwiftPM-таргет,
генерирует клиент официальным плагином и выполняет тесты: декодирование всех
committed fixtures, устойчивость к неизвестным значениям extensible enum и
поведение при неизвестном значении закрытого протокольного enum. Требуется
Swift 6 и доступ в сеть для двух пакетов Apple.

## 6. Открытые вопросы для последующих задач

1. ~~**Offline study session import.**~~ Закрыто в #64: `POST /v1/study-sessions`
   принимает `selectionOrigin=CLIENT_OFFLINE`, поэтому сценарий §8.1 выполним.
   Ограничения зафиксированы в
   [ADR-010](./adr/ADR-010-offline-study-session-import.md): импортируется
   только `SELF_RATED` (объективная офлайн-сессия отклоняется
   `422 OFFLINE_MODE_UNSUPPORTED`); устаревший, но опубликованный
   `contentVersion` принимается, неизвестный — `422 CONTENT_VERSION_UNKNOWN`;
   карточка, ставшая `RETIRED` после офлайн-выбора, отклоняет весь импорт
   `422 OFFLINE_SESSION_COMPOSITION_INVALID` — это неустранимая ошибка, и
   outbox обязан показать её как permanent failure, а не повторять запрос.
2. ~~**`additionalProperties: false` в response-схемах.**~~ Закрыто в IOS-002:
   ограничение снято с 44 response-схем и сохранено в 19 request-схемах,
   версионированных JSON Schema документах и registries. Поведение проверяется
   тестом `testUnknownFieldsAreIgnored` сгенерированного клиента.
3. **`dueCount` и `currentMasteryTier` в каталоге.** `listDecks`/`getDeck`
   объявляют поля опциональными и сейчас их не заполняют; Catalog (§9.3)
   получает эти значения из `getProgress`/`getDeckProgress`. Заполнение полей в
   каталоге — отдельное продуктовое решение.
