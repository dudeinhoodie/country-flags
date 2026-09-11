# iOS E2E: guest, authentication and account

## IOS-E2E-001 Первый запуск и полноценный гостевой режим

- Priority: P0
- Execution: Mock CI
- Fixtures: `G0`, `C0`, `N0`

### Description

Доказывает, что аккаунт не является входным барьером: новый пользователь может
открыть каталог, начать обучение и увидеть локальный прогресс.

**Preconditions:**

- приложение установлено впервые;
- keychain, SwiftData store и UserDefaults пусты;
- backend возвращает валидный catalog release;
- paid deck discovery выключен.

### Scenario

- Запустить приложение с системной локалью `ru-RU`.

  **Expected result**

  - приложение открывает Home без обязательного onboarding или auth sheet;
  - account state — guest;
  - основные элементы интерфейса локализованы на русском;
  - доступны вкладки Home, Catalog и Progress.

- Перейти в Catalog и открыть бесплатную колоду Europe.

  **Expected result**

  - строка колоды не содержит paid badge или цены;
  - deck detail показывает количество карточек, размер сессии и Start;
  - просмотр списка и деталей страны не требует входа.

- Выбрать сессию на 5 карточек, раскрыть первую карточку и ответить `Good`.

  **Expected result**

  - front не раскрывает название страны;
  - после reveal показаны ответ и факты;
  - после оценки открыта следующая карточка;
  - review записан в guest scope.

- Закрыть сессию и открыть Progress.

  **Expected result**

  - Progress больше не показывает fresh-install empty state;
  - ответ учтён локально;
  - приложение нигде не требует создать аккаунт для продолжения обучения.

## IOS-E2E-002 Первый запуск и обучение без сети

- Priority: P0
- Execution: Mock CI
- Fixtures: `G0`, bundled catalog, `N1`

### Description

Проверяет offline-first путь на устройстве, которое ещё ни разу не получало
данные от backend.

**Preconditions:**

- чистая установка;
- backend полностью недоступен до запуска;
- build содержит валидный bundled catalog и бесплатные flag assets.

### Scenario

- Запустить приложение в airplane mode.

  **Expected result**

  - launch не остаётся на бесконечном loader;
  - открывается bundled catalog;
  - offline/status copy не блокирует навигацию;
  - платные payload отсутствуют в bundle.

- Открыть бесплатную колоду и начать сессию на 5 карточек.

  **Expected result**

  - карточки и изображения доступны;
  - session snapshot создан локально;
  - отсутствие сети не показывается как ошибка каждой карточки.

- Ответить на две карточки и свернуть приложение.

  **Expected result**

  - ответы сохранены локально;
  - активная сессия и позиция сохранены;
  - для guest не создаётся ложная попытка серверной авторизации.

- Выгрузить приложение, запустить снова без сети и нажать Continue.

  **Expected result**

  - восстанавливаются та же колода, размер, порядок и следующая карточка;
  - уже отвеченные карточки не предлагаются как неотвеченные;
  - Progress отражает два сохранённых review.

## IOS-E2E-003 Гостевой прогресс переживает relaunch и общий card progress

- Priority: P0
- Execution: Mock CI
- Fixtures: `G0`, две колоды с общей learning card

### Description

Проверяет, что гостевой прогресс привязан к learning card, а не к строке
колоды, и не исчезает при перезапуске.

**Preconditions:**

- одна и та же страна входит в Europe и Popular;
- у guest нет предыдущих review.

### Scenario

- В Europe найти общую карточку, раскрыть её и ответить `Good`.

  **Expected result**

  - записан один review ID;
  - progress Europe обновлён.

- Закрыть Europe и открыть Popular.

  **Expected result**

  - состояние той же learning card уже учтено;
  - новый независимый progress для копии карточки не создан.

- Перезапустить приложение с тем же installation ID.

   **Expected result**

  - guest scope восстановлен;
  - progress обеих колод по общей карточке сохранён;
  - review count не удвоился после bootstrap.

## IOS-E2E-004 Вход через Apple и перенос гостевого прогресса

- Priority: P0
- Execution: Mock CI для app flow; Dev E2E + Device для реального provider
- Fixtures: `G2`, `A0`, `N0`

### Description

Проверяет основной переход guest → account: успешную Apple-авторизацию,
импорт локальных событий и отсутствие дублей после повторной синхронизации.

**Preconditions:**

- guest прошёл 3 карточки с оценками `Good`, `Again`, `Easy`;
- session size изменён на 5;
- guest outbox содержит эти review;
- account A существует без progress и с default settings;
- Apple credential относится к account A.

### Scenario

- Открыть Progress и Account до входа.

  **Expected result**

  - виден локальный guest progress;
  - Account предлагает Apple/Google sign-in и не блокирует остальные экраны.

- Нажать Sign in with Apple и подтвердить системный sheet.

  **Expected result**

  - используется свежий nonce;
  - во время обмена показано authenticating state;
  - после ответа backend активен account A;
  - provider token/code не появляется в UI или test attachments.

- Дождаться guest import.

  **Expected result**

  - импорт содержит ровно 3 уникальных review ID;
  - оценки и исходные client timestamps сохранены;
  - UI сообщает число принятых событий;
  - session size 5 перенесён по согласованной settings policy.

- Открыть Progress, затем выполнить повторный pull-to-refresh.

  **Expected result**

  - server progress учитывает три review;
  - повторная доставка не создаёт дубликаты;
  - guest outbox очищен только после подтверждённого import/sync.

- Перезапустить приложение.

  **Expected result**

  - keychain session восстановлена без нового Apple sheet;
  - account progress и session size сохранены;
  - migration не стартует заново.

## IOS-E2E-005 Google Sign-In, callback, cancellation и retry

- Priority: P0
- Execution: Mock CI + Device
- Fixtures: `G1`, `A0`, `N0`

### Description

Проверяет полный Google flow и нормальную обработку отмены пользователем.

**Preconditions:**

- Google client configuration присутствует, поэтому кнопка видима;
- guest имеет один локальный review;
- account A не содержит этого review.

### Scenario

- Нажать Google Sign-In и отменить provider sheet.

  **Expected result**

  - приложение возвращается на Account;
  - state остаётся guest;
  - cancellation не отображается как ошибка;
  - локальный review не меняется.

- Снова нажать Google Sign-In, выбрать account A и вернуться по callback URL.

  **Expected result**

  - callback принят только ожидаемой схемой приложения;
  - auth exchange выполняется один раз;
  - открыто то же приложение без дублирования navigation stack;
  - активен account A.

- Дождаться guest import и открыть Progress.

  **Expected result**

  - один guest review присутствует в account progress;
  - migration terminal state сохранён;
  - повторный foreground не запускает второй import.

## IOS-E2E-006 Ошибки входа и истёкшая авторизация

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `G1`, затем `A1`; outcomes offline, invalid credential, 401

### Description

Проверяет, что ошибки провайдера и backend не уничтожают локальную работу, а
истёкшая session переводит пользователя в понятное состояние повторного входа.

**Preconditions:**

- у guest есть локальный progress;
- mock умеет вернуть offline, invalid credential и refresh rejection;
- для второй части существует валидная account session A1.

### Scenario

- Отключить сеть и начать Apple/Google sign-in.

  **Expected result**

  - показано понятное offline-сообщение;
  - пользователь остаётся guest;
  - progress и outbox не очищены;
  - Retry доступен.

- Включить сеть и вернуть invalid/expired provider credential.

  **Expected result**

  - показана безопасная sign-in error без credential, email или stack trace;
  - повторное нажатие запускает новый независимый flow.

- Авторизоваться успешно как A1, затем на foreground sync вернуть 401 и
  успешный refresh.

  **Expected result**

  - refresh выполняется single-flight;
  - исходный запрос повторяется один раз;
  - экран и account state не сбрасываются.

- На следующем sync вернуть 401 и rejected refresh token.

  **Expected result**

  - state становится authentication expired;
  - UI предлагает повторный вход;
  - account-only данные не показываются как guest data;
  - локально записанный pending review не удаляется.

## IOS-E2E-007 Sign out с несинхронизированными ответами

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `A1`, непустой account outbox, `N1`

### Description

Проверяет защиту от незаметной потери ответов при выходе из аккаунта.

**Preconditions:**

- пользователь авторизован как A1;
- в offline session создано 2 pending review;
- backend недоступен.

### Scenario

- Открыть Account и нажать Sign out.

  **Expected result**

  - появляется confirmation dialog;
  - copy сообщает о несинхронизированных ответах и их количестве;
  - доступны Cancel, выход с устройства и выход везде согласно UI.

- Нажать Cancel.

  **Expected result**

  - account session остаётся активной;
  - outbox содержит те же 2 review;
  - paid entitlements и private cache остаются доступны.

- Повторить Sign out и подтвердить выход с текущего устройства.

  **Expected result**

  - 2 pending review остаются в изолированном account scope до повторного входа A1;
  - приложение не сообщает неотправленные review как синхронизированные;
  - auth tokens удалены;
  - UI возвращается в guest state;
  - account progress/paid content не протекают в guest scope.

- Повторно войти в A1 и снова открыть Sign out.

  **Expected result**

  - warning снова сообщает о тех же 2 pending review;
  - очередь не была удалена или перепривязана к guest scope при выходе.

## IOS-E2E-008 Переключение между двумя аккаунтами на одном устройстве

- Priority: P0
- Execution: Mock CI для progress/settings/entitlement isolation; Dev E2E для
  private assets и outbox isolation
- Fixtures: `A1`, `A2`, разные progress/settings/entitlements

### Description

Доказывает изоляцию account scopes при последовательном входе разных людей на
одном устройстве.

**Preconditions:**

- A1 имеет progress Europe, session size 20 и owned paid deck;
- A2 имеет пустой progress, session size 5 и не имеет entitlement;
- общий public catalog одинаков.

### Scenario

- Войти как A1 и проверить Home, Progress, Settings и paid deck.

  **Expected result**

  - видны данные A1;
  - paid deck открыта;
  - session size равен 20.

- Выйти и войти как A2.

  **Expected result**

  - progress пуст;
  - session size равен 5;
  - paid deck locked;
  - public catalog может быть взят из общего cache без private assets A1.

- Перезапустить приложение и снова проверить A2.

  **Expected result**

  - данные A1 не появляются даже кратковременно;
  - toolbar avatar/profile соответствует A2;
  - никакой outbox A1 не отправляется в account A2.

- Выйти из A2 и снова войти как A1.

  **Expected result**

  - progress A1 снова доступен;
  - пустое состояние A2 не затёрло данные A1;
  - повторный вход не запускает guest import заново.

## IOS-E2E-009 Очистка прогресса без удаления аккаунта

- Priority: P0
- Execution: Mock CI для обеих веток диалога; Dev E2E + Device для сходимости
  второго устройства
- Fixtures: `A1` с progress, settings и entitlement

### Description

Проверяет destructive flow очистки учебной истории и сохранение аккаунта,
настроек и покупок. Отмена и подтверждение — разные обещания, поэтому каждая
ветка проверяется отдельным тестом.

Гейтом операции является активная session. Отдельный per-operation re-auth
удалён: он тупиково завершался на устройствах, где provider sheet не мог
закрыться, а прогресс — в отличие от аккаунта — восстанавливается повторным
обучением.

**Preconditions:**

- A1 авторизован, у него есть progress минимум по одной карточке, и Progress
  показывает сохранённый результат;
- session size отличается от значения по умолчанию;
- часть ответов ещё не ушла на сервер и лежит в account outbox;
- A1 владеет платной колодой;
- второе устройство A1 подключено к dev backend (только для последнего шага).

### Scenario

- Открыть Account у авторизованного пользователя.

  **Expected result**

  - строка Clear progress предложена; гостю она не показывается, потому что
    удалять на сервере нечего;
  - Progress показывает сохранённый результат.

- Нажать Clear progress.

  **Expected result**

  - открыт диалог подтверждения;
  - заголовок называет операцию, а текст перечисляет последствия: ответы,
    карточки, тренировки и награды удаляются на всех устройствах, а аккаунт,
    настройки и каталог остаются;
  - Cancel доступен явной кнопкой на любом size class, а не только через
    tap-outside;
  - ничего ещё не удалено.

- Нажать Cancel и вернуться на Progress.

  **Expected result**

  - progress не изменился ни локально, ни на backend;
  - account scope не сменился, session остаётся активной;
  - pending outbox не тронут: sign-out по-прежнему сообщает то же число
    несинхронизированных ответов;
  - пользовательские настройки, включая session size, сохранены;
  - статус операции не показан: отменённое действие не отчитывается о
    результате.

- Перезапустить приложение.

  **Expected result**

  - progress остаётся на месте;
  - пользователь остаётся авторизованным.

- Снова выбрать Clear progress и подтвердить.

  **Expected result**

  - локальное удаление не происходит до server success;
  - после success показан статус завершения, а не текст ошибки;
  - learning history, локальные scheduler projections, review events и
    связанные pending reviews удалены;
  - progress-курсоры сброшены, поэтому следующий sync читает поток с начала и
    сходится к пустой истории;
  - account session, settings, включая session size, и entitlement сохранены;
  - owned deck остаётся доступной, но без progress;
  - sign-out больше не сообщает о несинхронизированных ответах.

- Перезапустить приложение, затем выйти и снова войти в тот же аккаунт.

  **Expected result**

  - Progress пуст после relaunch;
  - guest scope пуст: account-данные не протекли в него при выходе;
  - повторный вход не возвращает удалённую историю;
  - данные других аккаунтов на устройстве не изменились.

- Синхронизировать второе устройство.

  **Expected result**

  - оно сходится к пустому progress;
  - старые review не загружаются обратно;
  - повторное подтверждение операции idempotent.

## IOS-E2E-010 Удаление аккаунта и состояние после relaunch

- Priority: P0
- Execution: Mock CI + Dev E2E + Device
- Fixtures: `A1` с progress и entitlement

### Description

Проверяет полный account deletion flow, локальную очистку и долговечное
уведомление о принятой заявке. Отмена и подтверждение — разные обещания и
проверяются отдельными тестами.

Гейтом является активная session: отдельный provider re-auth удалён по той же
причине, что и в очистке прогресса, а само удаление остаётся заявкой с grace
period, а не мгновенным стиранием.

**Preconditions:**

- A1 авторизован и имеет серверные данные;
- у A1 есть progress и owned paid deck;
- deletion endpoint доступен;
- purchase ledger следует retention policy и не является UI account data.

### Scenario

- Открыть Account и нажать Delete account.

  **Expected result**

  - открыт диалог подтверждения;
  - заголовок называет операцию, а текст перечисляет последствия: прогресс,
    награды, настройки и все способы входа исчезают, приложение остаётся;
  - Cancel доступен явной кнопкой на любом size class, а не только через
    tap-outside;
  - ничего ещё не удалено.

- Выбрать Cancel.

  **Expected result**

  - аккаунт остаётся активным, session не завершена;
  - никакие данные или tokens не удалены;
  - статус операции не показан и pending deletion notice не появился;
  - Delete account по-прежнему предлагается;
  - после relaunch пользователь всё ещё авторизован и уведомления нет.

- Повторить действие и подтвердить.

  **Expected result**

  - backend принимает deletion request;
  - приложение только после success очищает private scope и tokens;
  - navigation возвращается в guest shell;
  - progress удалённого аккаунта не виден гостю;
  - paid content больше не доступен;
  - публичный catalog и guest study продолжают работать.

- Открыть Account как guest.

  **Expected result**

  - показано pending deletion notice с ожидаемой датой;
  - повторное удаление не предлагается.

- Полностью завершить приложение и запустить снова.

  **Expected result**

  - пользователь остаётся guest;
  - pending deletion notice сохранено;
  - данные удалённого account не появляются во время launch/sync.
