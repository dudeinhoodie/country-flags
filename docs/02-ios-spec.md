# Техническое задание для iOS Agent

Статус: `Draft 0.1`  
Стек: Swift + SwiftUI  
Зависимости:

- [00-product-spec.md](./00-product-spec.md)
- OpenAPI-контракт backend из [01-backend-spec.md](./01-backend-spec.md)

## 1. Результат работы

Агент должен создать iOS-приложение, в котором пользователь может:

- использовать приложение без регистрации;
- войти через Apple или Google;
- просматривать колоды и их прогресс;
- выбрать 5/10/20 карточек;
- проходить Anki-подобную сессию «флаг → страна»;
- проходить контрольную сессию с четырьмя вариантами ответа;
- работать с уже загруженным контентом без сети;
- синхронизировать review и настройки;
- видеть mastery и достижения;
- управлять аккаунтом и инициировать его удаление.

Приложение должно корректно переживать закрытие процесса, потерю сети, повторные ответы API и смену аккаунта.

## 2. Платформа и технологии

Подтверждённый baseline:

- Swift 6 language mode;
- SwiftUI;
- iOS 17+ как deployment target;
- Structured Concurrency (`async/await`, actors);
- `URLSession`;
- `Codable`;
- SwiftData для локальной персистентности;
- Keychain для access/refresh tokens;
- AuthenticationServices для Sign in with Apple;
- официальный Google Sign-In SDK через Swift Package Manager;
- XCTest и XCUITest;
- Swift Package Manager для зависимостей.

Deployment target подтверждён: iOS 17. Его дальнейшее повышение требует продуктового решения; понижение потребует пересмотра persistence layer.

Не добавлять сторонние библиотеки для задач, решаемых системными API, без ADR и измеримой причины.

## 3. Архитектура приложения

Рекомендуется feature-based структура с однонаправленным потоком данных:

```text
App
├── Core
│   ├── Networking
│   ├── Authentication
│   ├── Persistence
│   ├── Sync
│   ├── FeatureFlags
│   ├── Advertising
│   ├── Observability
│   ├── Analytics
│   ├── Diagnostics
│   ├── DesignSystem
│   ├── Localization
│   └── Observability
├── Domain
│   ├── Content
│   ├── Learning
│   ├── Progress
│   └── Account
└── Features
    ├── Onboarding
    ├── Home
    ├── Catalog
    ├── DeckDetails
    ├── StudySession
    ├── SessionResult
    ├── Progress
    ├── Achievements
    └── Settings
```

Требования:

- View не выполняет network/persistence операции напрямую.
- Domain не импортирует SwiftUI, Google SDK или конкретную БД.
- Репозитории скрывают local/remote источники.
- Dependency injection позволяет заменить API, clock, UUID generator и storage в тестах.
- Навигация типизирована, deep links не используют строки экранов.
- Глобальный mutable singleton state запрещён, кроме обёрток над системными сервисами с контролируемой lifetime.

## 4. Источники состояния

### 4.1 Источник истины на устройстве

- Для текущего UI источником является локальная БД.
- API-ответы сначала транзакционно записываются локально, затем UI наблюдает изменения.
- Keychain хранит только секреты сессии.
- UserDefaults используется только для незначительных device-local preferences, не для review или контента.

### 4.2 Состояния приложения

Приложение должно различать:

- `guest`;
- `authenticated(userId)`;
- `authenticationExpired`;
- `deletionPending`;
- `offline`;
- `syncing`;
- `syncError(recoverable/nonRecoverable)`.

Выход из аккаунта не должен случайно показывать данные предыдущего пользователя гостю или следующему пользователю. Локальные области данных должны быть разделены по account scope.

## 5. Локальная модель

Имена условны; важна семантика.

### Контент

- `LocalContentManifest`
- `LocalGeoEntity`
- `LocalGeoName`
- `LocalAsset`
- `LocalFact`
- `LocalDeck`
- `LocalLearningCard`
- `LocalDeckCard`

### Пользователь

- `LocalUserSettings`
- `LocalCardState`
- `LocalDeckProgress`
- `LocalAchievement`
- `LocalStudySession`
- `LocalStudySessionCard`
- `LocalReviewEvent`
- `OutboxOperation`
- `LocalAnalyticsEvent`
- `LocalPrivacySettings`
- `PendingDiagnosticReport`
- `SyncCursor`

Каждая синхронизируемая запись содержит server ID, version и timestamps, достаточные для обновления. `LocalReviewEvent.id` генерируется до показа следующей карточки и не меняется при повторной отправке.

### Миграции

- Schema version локальной БД фиксируется.
- Для каждой несовместимой схемы есть migration plan.
- Обновление приложения не должно стирать несинхронизированный outbox.
- Debug-only кнопка reset database не попадает в release.

## 6. Сетевой слой

### 6.1 API Client

`APIClient` должен поддерживать:

- типизированные request/response;
- Bearer access token;
- единственный автоматический refresh при `401`, защищённый actor-ом от параллельного refresh storm;
- request ID;
- таймауты;
- отмену при уходе со screen только для безопасно отменяемых read operations;
- retry с exponential backoff и jitter для идемпотентных запросов;
- отсутствие автоматического retry для произвольного POST без idempotency key;
- декодирование единого error envelope;
- redaction tokens и PII в логах.

Network monitor используется только для UX-подсказки и запуска sync, но не как доказательство доступности API.

### 6.2 Совместимость

- Клиент отправляет app version, platform и поддерживаемые card template schema versions.
- При неподдерживаемом обязательном шаблоне карточка безопасно пропускается.
- `app-config` обрабатывает forced update и soft update.
- Неизвестные поля JSON игнорируются.
- Неизвестное enum-значение обрабатывается через `unknown`, а не crash.

### 6.3 OpenFeature и FeatureFlagClient

Клиент MUST использовать OpenFeature Swift SDK. Проект реализует собственный `SnapshotOpenFeatureProvider`, который получает уже вычисленные значения из `/v1/app-config` и разрешает их по цепочке remote snapshot → cached snapshot → bundled default.

Поверх OpenFeature evaluation API клиент имеет отдельную типизированную обёртку:

```swift
protocol FeatureFlagProviding: Sendable {
    func boolValue(for key: BooleanFeatureFlag) -> Bool
    func stringValue(for key: StringFeatureFlag) -> String
    func numberValue(for key: NumberFeatureFlag) -> Double
    func refresh(context: FeatureFlagContext) async
}
```

Требования:

- feature-код зависит от `FeatureFlagProviding`, который использует OpenFeature SDK, а не от SDK будущего control plane;
- vendor-specific SDK и management credentials в iOS-приложение не добавляются;
- ключи перечислены в типизированном registry, строки не размазываются по View;
- каждый ключ имеет bundled default, тип, owner и activation policy;
- на старте синхронно доступен bundled default или последний валидный snapshot;
- remote refresh выполняется асинхронно и не блокирует первый экран;
- snapshot из `/v1/app-config` кэшируется с version, `fetchedAt` и `expiresAt`;
- invalid/unknown/mismatched value игнорируется в пользу default;
- смена аккаунта обновляет evaluation context и запрашивает новый snapshot;
- feature exposure telemetry отправляется только при фактическом показе/использовании функции, а не при каждом чтении flag;
- UserDefaults MAY хранить только несекретный кэш snapshot metadata/value; tokens и PII там запрещены;
- debug overrides допустимы только в Debug/UITest builds и никогда не включаются в App Store release.

Activation policies:

- `immediate` — аварийное отключение безопасно применяется во время работы;
- `nextSession` — новое значение фиксируется при создании учебной сессии;
- `nextLaunch` — навигационные/архитектурные изменения применяются после следующего запуска.

Изменение flag во время активной учебной сессии не должно менять её mode, состав или интерфейс посередине. Для session-scoped flags сохраняется snapshot в `LocalStudySession`.

## 7. Авторизация

### 7.1 Гостевой режим

- Гость не создаёт автоматический backend-аккаунт.
- Все review и settings получают локальный guest scope.
- Интерфейс ненавязчиво предлагает вход для синхронизации, но не блокирует обучение.
- До входа приложение объясняет, что прогресс гостя хранится только на этом устройстве.

### 7.2 Sign in with Apple

- Использовать нативную кнопку `ASAuthorizationAppleIDButton`.
- Создавать криптографически случайный raw nonce.
- Передавать hash nonce в Apple request, raw nonce — backend.
- Передавать backend identity token и требуемый authorization code.
- Имя/email сохранять только если реально получены; не ожидать их при повторном входе.
- Проверять credential state при релевантном запуске/возврате.
- Не использовать поле `user` с клиента как единственное доказательство identity.

### 7.3 Google Sign-In

- Использовать официальный SDK и требования Google branding.
- После входа получить/обновить ID token и отправить его backend по HTTPS.
- Не отправлять backend простой Google user ID вместо token.
- Обрабатывать отмену пользователем как нормальный исход, а не как системную ошибку.

### 7.4 Собственные tokens

- Refresh token хранится в Keychain с подходящим accessibility class.
- Access token также хранится безопасно; допускается держать его копию в памяти активной сессии.
- Tokens не попадают в UserDefaults, SwiftData, analytics, crash logs или clipboard.
- Logout удаляет tokens и account-scoped cache после завершения/очереди безопасной очистки.
- Logout-all вызывает backend и затем очищает локальную сессию.

Если существуют несинхронизированные review, logout не должен удалять их молча. Интерфейс предлагает сначала синхронизировать; при явном выходе без sync пользователь отдельно подтверждает потерю локально ожидающих данных. Альтернатива — сохранить изолированный pending scope до повторного входа того же server user, если это решение отдельно утверждено.

### 7.5 Миграция гостевого прогресса

После первого успешного входа:

1. Приложение сохраняет auth tokens.
2. Получает server profile/settings.
3. Предлагает или автоматически выполняет «Перенести прогресс с устройства» согласно продуктовому решению.
4. Гостевые review копируются в account outbox с теми же UUID, если они ещё не принадлежат другому server user.
5. Batch отправляется backend.
6. Клиент принимает канонические card states.
7. После подтверждённой синхронизации guest scope архивируется/удаляется.

Если на устройстве ранее был другой пользователь, его события нельзя переносить в новый аккаунт без явного подтверждения и доказанной принадлежности guest scope.

Guest import использует стабильный `migrationId` и повторяется идемпотентно до server acknowledgement.

### 7.6 Связывание аккаунтов и удаление

В Account Settings:

- список связанных способов входа;
- добавить Apple/Google;
- удалить дополнительный provider;
- выйти;
- выйти на всех устройствах;
- очистить учебный прогресс;
- запросить и скачать экспорт данных;
- удалить аккаунт.

Если новый Apple/Google identity уже связан с другим backend-аккаунтом, клиент обрабатывает `IDENTITY_ALREADY_LINKED`, не предлагает merge по email и позволяет безопасно переключиться на существующий аккаунт. Merge двух аккаунтов не входит в MVP.

Удаление аккаунта:

1. Показать последствия простым текстом.
2. Потребовать явное подтверждение и свежую re-authentication.
3. Вызвать `DELETE /v1/me`.
4. Очистить tokens и account-scoped local data.
5. Показать статус/срок удаления, если процесс не мгновенный.

Пользователя нельзя отправлять писать email в поддержку для обычного удаления.

## 8. Синхронизация и офлайн

### 8.1 Sync Coordinator

Один actor `SyncCoordinator` отвечает за:

- запрет параллельных sync одного account scope;
- отправку outbox;
- применение canonical card states;
- загрузку settings/progress/achievements;
- получение content changes;
- обновление sync cursors;
- retry policy;
- публикацию краткого sync status в UI.

Триггеры:

- успешный login;
- запуск/foreground;
- завершение сессии;
- появление сети;
- pull-to-refresh;
- фоновая задача, если система её предоставляет.

Фоновые задачи iOS являются opportunistic; продукт не должен обещать точное время фоновой синхронизации.

Сессия при наличии сети может быть сформирована backend. Без сети клиент формирует её из локального состава колоды и последнего canonical card state, присваивает UUID и сохраняет `selectionOrigin=CLIENT_OFFLINE`. При sync сначала идемпотентно создаётся session на backend, затем отправляются зависящие от неё review.

### 8.2 Outbox

Для каждого review:

1. Сформировать UUID и полный event.
2. Одной локальной транзакцией сохранить event, поместить outbox operation и обновить UI-проекцию.
3. Только после успешного commit перейти к следующей карточке.
4. При ответе backend пометить operation synced и заменить локальный state каноническим.

Статусы: `pending`, `inFlight`, `synced`, `retryableFailure`, `permanentFailure`.

`inFlight` после crash должен возвращаться в `pending`. Permanent rejection отображается в diagnostics/support state, но не удаляется молча.

### 8.3 Контент

- На первом запуске приложение содержит минимальный bundled bootstrap или показывает корректный загрузочный экран.
- Manifest и changes применяются транзакционно.
- Session/content cache хранит `learningCardRevision`, asset checksum и content version.
- Assets загружаются лениво, но флаги выбранной сессии префетчатся.
- Проверяется checksum.
- Cache eviction не удаляет assets активной/незавершённой сессии.
- Старый контент остаётся доступен до успешного commit новой версии.

## 9. Экраны и поведение

### 9.1 Onboarding/Auth

- краткая ценность приложения;
- «Продолжить без аккаунта»;
- Sign in with Apple;
- Sign in with Google;
- ссылки Privacy Policy и Terms.

Кнопка гостевого режима не должна быть визуально замаскирована.

### 9.2 Home

- приветствие без обязательного имени;
- «Продолжить» для активной сессии;
- «К повторению сегодня»;
- рекомендуемые колоды;
- краткая статистика;
- last sync state только если есть проблема.

### 9.3 Catalog

- секции/фильтры: континенты, субрегионы, подборки;
- поиск по локализованному и альтернативному названию;
- карточка колоды: title, число карточек, due count, current mastery;
- empty, loading, offline и error states.

### 9.4 Deck Details

- название и описание;
- размер;
- new/learning/due/mastered;
- текущий уровень и highest achievement;
- выбор размера сессии;
- запуск self-rated режима;
- запуск objective режима, если feature включён;
- список стран MAY быть сворачиваемым.

Если сеть недоступна, запуск разрешён при наличии локального состава колоды и assets. Локальный selector обязан соблюдать due priority, лимит уникальных карточек, отсутствие retired cards и дублей; точные правила проверяются общими golden fixtures с backend.

### 9.5 Study Session

Лицевая сторона:

- флаг в контейнере без искажения aspect ratio;
- прогресс `3 / 10`;
- кнопка раскрытия;
- закрытие/пауза с подтверждением;
- отсутствие названия страны в accessibility label до раскрытия.

Обратная сторона:

- локализованное название;
- альтернативное название при необходимости;
- дополнительные факты;
- `Again/Hard/Good/Easy`;
- понятные accessibility labels;
- краткое обучение значениям кнопок при первом использовании.

Правила:

- двойной tap не создаёт два review;
- во время локального сохранения кнопки кратковременно блокируются;
- оценку нельзя изменить после перехода, если не реализован отдельный undo с корректным event protocol;
- background/termination сохраняют точную позицию;
- Reduce Motion заменяет 3D flip на crossfade/no animation;
- haptics подчиняется settings и системным ограничениям.

### 9.6 Objective quiz

- Режим входит в публичный MVP.
- 4 варианта с достаточной touch area;
- после выбора блокируются все варианты;
- показывается правильный ответ;
- client отправляет непрозрачный `selectedOptionId`; online grading выполняет backend;
- session snapshot фиксирует option IDs, display payload, порядок, seed и `distractorPolicyVersion`;
- цвет дублируется иконкой и текстом;
- distractors не повторяются;
- одинаковые локализованные подписи не показываются одновременно без disambiguation;
- VoiceOver не раскрывает правильный ответ заранее;
- время ответа считается монотонными часами, а не `Date`.

### 9.7 Session Result

- итоговые числа;
- визуальное, но доступное распределение оценок;
- изменение mastery;
- новые достижения;
- «Повторить ошибки»;
- «Готово».

Экран строится из сохранённого session summary и переживает повторное открытие.

### 9.8 Progress/Achievements

- общий прогресс;
- прогресс по колодам/регионам;
- current tier и highest tier;
- описание условий следующего уровня;
- earned date;
- locked achievements без ложного обещания точного процента, если правило не линейно.

### 9.9 Settings

Учёба:

- 5/10/20;
- режим ответа;
- дополнительные факты;
- звук/haptics.

Язык и уведомления:

- язык контента;
- расписание напоминаний;
- переход в System Settings, если permission отклонён.

Аккаунт:

- provider identities;
- devices;
- sync status;
- очистка прогресса;
- logout/logout-all;
- удаление аккаунта;
- Privacy Policy/Terms;
- версия приложения и content version.

Privacy:

- состояние сбора optional product analytics;
- состояние отправки diagnostics/crash data, если policy требует отдельного выбора;
- ссылка на описание собираемых категорий;
- изменение согласия удаляет запрещённые pending events до следующей отправки;
- переключатели не показываются как обычные preferences, если в регионе требуется отдельный consent flow.

## 10. Планировщик на iOS

- iOS не считается источником истины для долгосрочного `dueAt`.
- Клиент хранит canonical card state backend и optimistic projection для UX.
- Backend baseline — FSRS-6; iOS скрывает локальную реализацию за `LocalSchedulerProjection`.
- Локальная projection применяет pending review, чтобы пользователь мог пройти несколько сессий без сети.
- Общие JSON golden fixtures проверяют rating mapping, due priority, monotonic transitions и сериализацию; backend state после sync всегда побеждает.
- Внутри текущей сессии `Again` MAY поставить карточку повторно после нескольких других карточек.
- Клиент отправляет rating/selectedOptionId, raw client time, estimated server time, sequence и baseStateVersion.
- После sync backend state полностью заменяет optimistic state.
- Scheduler logic не должна быть размазана по ViewModel.
- Конкретная Swift-библиотека выбирается на iOS-этапе. Её несовпадение с canonical FSRS-6 не может изменять server history; при необходимости используется консервативная offline projection до появления совместимой реализации.

## 11. Настройки и конфликты

- Account settings приходят с version.
- PATCH отправляет base version.
- При конфликте клиент получает актуальные settings и:
  - автоматически объединяет независимые поля;
  - для одного и того же изменённого поля выбирает server value и уведомляет только при заметном эффекте;
  - повторяет PATCH с новой version.
- Permission notifications никогда не синхронизируется как `true` только на основании server setting.

## 12. Accessibility, локализация и дизайн

- Весь user-facing текст в localization catalog.
- Первый релиз содержит русский и английский.
- Русский и английский не зашиты в условия: выбор языка и декодирование контента работают с произвольным BCP 47 locale.
- Fallback chain для контента: точная locale → базовый язык → server default locale → стабильный placeholder/error; отсутствие перевода не приводит к crash.
- Dynamic Type до accessibility sizes.
- VoiceOver focus после flip переходит к названию страны.
- Touch targets не меньше системных рекомендаций.
- Поддерживаются light/dark mode.
- Медали различаются формой/подписью, не только bronze/silver/gold цветом.
- Контент не обрезается на маленьких экранах и при длинных названиях.
- RTL-layout должен не ломаться, даже если RTL locale не входит в MVP.
- Анимация не является единственным способом передать состояние.

## 13. Ошибки и UX

Пользовательские сообщения должны отвечать на вопрос «что произошло и что можно сделать»:

- нет сети — обучение доступно, sync будет позже;
- token истёк и refresh не удался — предложить войти снова, не удаляя локальные unsynced review;
- контент не загружен — retry;
- отдельный asset не загрузился — placeholder и retry, сессия не падает;
- API устарел — soft/forced update flow;
- review rejected — сохранить локально, записать безопасную диагностику, попытаться получить canonical state;
- удаление аккаунта не завершилось — показать статус и безопасный retry.

Не показывать технические коды ошибок обычному пользователю; request ID доступен в диагностике/копировании для поддержки.

## 14. Privacy и аналитика

Полная спецификация: [06-observability-analytics.md](./06-observability-analytics.md).

Клиент MUST иметь независимые протоколы:

```swift
protocol AnalyticsTracking: Sendable {
    func track(_ event: AnalyticsEvent) async
    func setIdentity(_ identity: AnalyticsIdentity?) async
    func flush() async
}

protocol ErrorReporting: Sendable {
    func capture(error: Error, context: ErrorContext)
    func addBreadcrumb(_ breadcrumb: SafeBreadcrumb)
    func setUserContext(_ context: ErrorUserContext?)
}
```

Локальные логи:

- использовать `Logger`/OSLog с subsystem/category;
- строковые interpolated values считать private по умолчанию;
- помечать public только заведомо несекретные enum, version и error code;
- не копировать весь HTTP body/response;
- release log level ограничен;
- пользователю MAY быть доступен экспорт очищенного диагностического bundle по явному действию.

Error/crash reporting:

- provider скрыт за `ErrorReporting`;
- обрабатывать uncaught crashes, hangs и выбранные non-fatal errors;
- подключить MetricKit;
- dSYM загружаются в выбранный provider в CI;
- breadcrumbs ограничены и очищены;
- повторяющиеся network/business errors агрегируются, а не создают шум;
- logout очищает user context;
- очередь reports ограничена размером и TTL.

Product analytics:

- события типизированы и имеют schema version;
- event UUID создаётся до локальной постановки в очередь;
- отправка идёт batch через backend и не блокирует UI;
- очередь работает офлайн, ограничена размером/TTL и дедуплицируется backend;
- identity — отдельный непрозрачный analytics ID, не email и не provider subject;
- после login выполняется утверждённый guest→user alias/merge;
- logout сбрасывает identity;
- consent/privacy setting применяется до постановки optional event в очередь;
- experiment exposure отправляется при фактическом показе;
- canonical ответы на отдельные карточки не дублируются в analytics.

Минимальные продуктовые события:

- `onboarding.completed`;
- `deck.opened`;
- `study.session_started`;
- `study.session_completed`;
- `study.session_abandoned`;
- `achievement.earned`;
- `feature.exposed`;
- `auth.completed` с provider enum и результатом, без provider identity;
- `sync.completed` только с агрегированным outcome/duration.

Не отправлять:

- identity/access/refresh tokens;
- provider subject;
- email;
- полную историю конкретных ответов вместе с user identifier;
- текст будущего свободного ответа;
- содержимое Keychain/локальной БД.
- полный request/response body;
- advertising identifier;
- точную геолокацию;
- произвольные названия экранов/ошибок вне registry.

Названия событий, properties, purpose, consent category и retention period документируются в registry до интеграции provider.

### 14.1 Опциональная реклама

Полная спецификация: [07-advertising.md](./07-advertising.md).

В MVP клиент MUST иметь архитектурный интерфейс и no-op реализацию:

```swift
protocol AdvertisingProviding: Sendable {
    func prepare(context: AdvertisingContext) async
    func load(_ placement: AdPlacement) async -> AdLoadResult
    @MainActor
    func present(
        _ placement: AdPlacement,
        from host: AdPresentationHost
    ) async -> AdPresentationResult
    func reset() async
}
```

Требования:

- default dependency — `NoOpAdvertisingProvider`;
- реальный рекламный SDK не добавляется до отдельного ADR/privacy review;
- View/ViewModel не импортируют provider SDK;
- все placements типизированы и по умолчанию выключены;
- `AdEligibilityService` объединяет feature flags, advertising policy, privacy/ATT state, age/region rules, frequency caps и будущий `ad_free` entitlement;
- неизвестное или запрещающее состояние означает «не показывать»;
- активная учебная сессия всегда ad-free;
- реклама не влияет на FSRS, mastery, ответы и достижения;
- отсутствие сети, no-fill или provider error не создаёт пользовательскую ошибку и не ломает layout;
- при logout/отзыве consent provider очищает identity/context;
- ATT prompt не показывается в сборке без реально утверждённого tracking use case;
- первоначально допустим только contextual/non-personalized mode без IDFA.

## 15. Тестирование

### Unit

- API decoding и unknown enum;
- single-flight token refresh;
- guest/account scoping;
- outbox state machine;
- session reducer;
- double-tap protection;
- settings merge;
- content manifest apply;
- card template rendering;
- mastery presentation.
- analytics queue/idempotent event ID;
- consent filtering;
- identity login/logout;
- error redaction;
- MetricKit payload adapter;
- Logger privacy annotations;
- advertising eligibility и all-defaults-off;
- frequency cap;
- `NoOpAdvertisingProvider`;

### Persistence

- migration с предыдущей схемы;
- crash между записью review и sync;
- сохранение активной сессии;
- logout очищает только нужный scope;
- cache eviction не затрагивает active session/outbox.

### Integration

- mock server auth/refresh;
- batch partial response;
- duplicate review response;
- out-of-order canonical state;
- content changes;
- offline → online sync;
- forced update.
- flag provider unavailable → cached/default behavior;
- runtime flag update согласно activation policy;
- account context change;
- неизвестный flag/type mismatch;
- analytics offline → online batch;
- provider/server rejection;
- crash/error adapter;
- request ID correlation;
- advertising policy/default-off;
- рекламный provider не инициализируется до eligibility;
- ad-free/consent/ATT запрет сильнее remote flag;

### UI

1. Гость проходит сессию.
2. Карточка восстанавливается после relaunch.
3. Login и перенос гостевого прогресса.
4. Apple/Google cancel.
5. Offline banner без блокировки обучения.
6. Получение achievement.
7. Account deletion.
8. Dynamic Type, VoiceOver smoke и Reduce Motion.
9. Long Russian/English names.
10. Dark mode и маленький экран.
11. Analytics consent/opt-out и отсутствие optional events после отказа.
12. Unexpected error показывает support request ID без stack trace.
13. Активная study session не содержит рекламы; NoOp provider не оставляет пустые slots.

Snapshot tests MAY применяться к design system и ключевым состояниям, но не заменяют accessibility/UI tests.

## 16. App Store readiness

Перед отправкой:

- Sign in with Apple присутствует рядом с Google-входом;
- гостевой режим функционален для core experience;
- удаление аккаунта доступно в Settings;
- Privacy Policy и Terms открываются;
- backend доступен reviewer, но вход не обязателен для проверки обучения;
- все placeholder и debug menu удалены;
- корректно заполнены privacy nutrition labels;
- описано использование аналитики и push;
- если рекламный SDK добавлен: проверены его privacy manifest/signature, data inventory, age rating, reporting inappropriate ads и App Store privacy disclosures;
- ATT purpose string присутствует только при реально используемом tracking; отказ не ограничивает core experience;
- Google/Apple branding соблюдён;
- приложение протестировано на реальном устройстве;
- обработаны отсутствие сети и недоступность backend.

## 17. Definition of Done

- Проект собирается с чистого checkout одной документированной последовательностью.
- Нет секретов и environment-specific IDs в git.
- Гость проходит полный flow без сети после загрузки контента.
- Review записывается локально до перехода к следующей карточке.
- Повторная sync не создаёт дубль.
- Tokens находятся в Keychain и редактируются из логов.
- Apple/Google flow использует ID token и backend verification.
- Session size синхронизируется между устройствами.
- UI поддерживает RU/EN, Dynamic Type, VoiceOver, Reduce Motion и dark mode.
- Account deletion доступно из приложения.
- Flashcard и multiple-choice проходят полный session/result/sync flow.
- Feature flags типизированы, имеют defaults/cache и не блокируют launch при сетевой ошибке.
- Advertising подключён через `AdvertisingProviding`; MVP использует NoOp provider, не содержит рекламного SDK и не запрашивает ATT.
- Logger, MetricKit, ErrorReporting и AnalyticsTracking подключены через заменяемые adapters.
- Release build загружает dSYM и не логирует tokens/PII.
- Privacy settings управляют optional analytics outbox, а logout/account deletion очищают идентифицированный telemetry context.
- Unit/integration/UI smoke tests проходят в CI.
- README содержит настройку bundle ID, URL schemes, environments, запуск и тесты.

## 18. Порядок реализации для агента

1. Создать Xcode project, environments и архитектурный skeleton.
2. Реализовать design tokens, navigation и localization.
3. Реализовать API client, feature flag module, advertising NoOp/policy contracts, DTO и mock server.
4. Реализовать SwiftData schema, account scopes и migrations.
5. Реализовать content bootstrap/catalog/deck screens.
6. Реализовать session state machine, flashcard, multiple-choice и сохранение review.
7. Реализовать outbox и sync coordinator.
8. Реализовать Apple/Google auth и guest migration.
9. Реализовать progress/mastery/achievements.
10. Реализовать Settings, devices и account deletion.
11. Завершить accessibility, offline states, тесты и App Store checklist.

Агент должен интегрироваться с OpenAPI-контрактом, а не придумывать несовместимые локальные формы backend DTO.
