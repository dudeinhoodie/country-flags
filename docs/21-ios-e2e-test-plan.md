# iOS E2E test plan

Статус: `Implementation started — Wave 1`
Дата: 10 сентября 2026 года

Документ задаёт сквозное E2E-покрытие текущего iOS-приложения: от первого
запуска и гостевого обучения до авторизации, синхронизации, покупок, настроек
и удаления аккаунта. Это список наблюдаемого пользовательского поведения, а
не дублирование unit/integration-тестов внутренних reducer, repository или API
adapter.

Подробные test cases с Preconditions, пошаговым Scenario и Expected result
после каждого контрольного действия находятся в
[ios/e2e/README.md](./ios/e2e/README.md). Таблицы ниже остаются атомарной
coverage-матрицей и помогают увидеть состояния, не потерянные внутри длинных
пользовательских journeys.

Это именно **coverage matrix**. Полные пошаговые test cases с промежуточными
expected results находятся в [ios/e2e/README.md](./ios/e2e/README.md).

Связанные документы:

- [00-product-spec.md](./00-product-spec.md);
- [02-ios-spec.md](./02-ios-spec.md);
- [17-paid-decks-storekit.md](./17-paid-decks-storekit.md);
- [18-multi-content-paid-decks.md](./18-multi-content-paid-decks.md);
- [ios/release-checklist.md](./ios/release-checklist.md).

## 1. Фактическая граница продукта

Матрица следует текущему приложению и коду, а не устаревшим формулировкам:

- обязательного onboarding/auth gate нет: новый пользователь сразу получает
  полноценный гостевой режим;
- основные вкладки — `Home`, `Catalog`, `Progress`; аккаунт открывается через
  аватар, настройки — через шестерёнку;
- гость может смотреть бесплатный каталог, учиться и видеть локальный прогресс;
- аккаунт нужен для межустройственной синхронизации и покупки платных колод;
- текущие пользовательские настройки: размер сессии `5/10/20`, звук, haptics,
  напоминания, продуктовая аналитика и диагностика;
- self-rated и multiple-choice являются отдельными режимами ответа;
- платные колоды используют Apple Non-Consumable IAP и backend entitlement;
- герб и флаг — разные карточки одного subject; штат — `SUBDIVISION` с parent
  country;
- связка нескольких identity, список устройств и экспорт данных остаются в
  backend-контракте, но удалены из текущего iOS UI. Они не являются release
  E2E до возвращения интерфейса.

## 2. Уровни и контуры выполнения

### Приоритет

- **P0** — блокирует релиз: основной путь или риск потери денег/прогресса.
- **P1** — обязательная nightly regression.
- **P2** — расширенное покрытие перед релизом и после изменения подсистемы.

### Контур

- **Mock CI** — `CountryFlags-Mock`, детерминированные fixtures, XCUITest.
- **Dev E2E** — подписанная Dev-сборка и реальный dev backend/database.
- **StoreKit Test** — Xcode StoreKit configuration и StoreKit Test session.
- **Sandbox** — реальное устройство, Apple Sandbox/TestFlight и dev backend.
- **Device** — реальное устройство для системных sheet, permissions, haptics,
  VoiceOver и lifecycle.

PR обязан запускать P0, которые не требуют внешнего системного UI. Полный Mock
CI набор запускается nightly. Provider/Sandbox/Device сценарии выполняются
перед TestFlight, после изменения auth/commerce/notifications и перед релизом.

## 3. Базовые fixtures

| Fixture | Состояние |
| --- | --- |
| `G0` | Чистая установка, новый guest scope, online, пустой прогресс |
| `G1` | Гость с завершёнными review, изменёнными настройками и пустым outbox |
| `G2` | Гость с локальными review/settings и непустым outbox |
| `A0` | Новый аккаунт без серверного прогресса и entitlements |
| `A1` | Аккаунт с прогрессом, настройками, achievements и двумя устройствами |
| `A2` | Другой аккаунт на том же устройстве |
| `P0` | Видимая locked paid deck, валидный StoreKit product, entitlement отсутствует |
| `P1` | Owner paid deck: entitlement active, cards/assets загружены |
| `P2` | Pending transaction/Ask to Buy, entitlement отсутствует |
| `C0` | Валидный bundled catalog, backend доступен |
| `C1` | Сохранённый catalog, backend недоступен |
| `C2` | Нет catalog ни в store, ни от backend |
| `N0` | Stable online |
| `N1` | Offline |
| `N2` | Flaky network: timeout/5xx, затем восстановление |

Каждый тест получает уникальные `installationID`, account и store directory.
Fixtures не должны делить keychain/session между параллельными тестами.

## 4. P0 сквозные journeys

Эти сценарии проверяются как длинные пользовательские истории. Детальные
состояния из следующего раздела не заменяют их.

| ID | Journey | Ожидаемый результат | Контур |
| --- | --- | --- | --- |
| `J-01` | `G0`: запустить приложение → открыть Europe → выбрать 5 карточек → завершить self-rated session → открыть Progress | Вход не требуется; результат и прогресс сохранены локально | Mock CI |
| `J-02` | `G0/N1`: первый запуск без backend → открыть bundled catalog → пройти сессию → перезапустить offline | Каталог, карточки, активная сессия и guest progress доступны без сети | Mock CI |
| `J-03` | `G1`: начать сессию → ответить часть → force quit → relaunch → Continue | Восстановлены та же колода, режим, состав, позиция и уже записанные ответы | Mock CI |
| `J-04` | `G2`: войти через Apple → дождаться guest import и sync | Review/settings мигрированы как события без дублей; приложение остаётся работоспособным | Dev E2E + Device |
| `J-05` | `G2`: войти через Google → вернуться по callback → дождаться import | Результат эквивалентен Apple flow; callback не теряет экран/состояние | Dev E2E + Device |
| `J-06` | `A1`: войти на чистом втором устройстве | Приходят server progress, settings, achievements и owned decks; guest данные другого scope не видны | Dev E2E |
| `J-07` | `A1/N1`: пройти загруженную сессию offline → вернуть сеть | UI сразу учитывает ответы; outbox синхронизируется ровно один раз | Dev E2E |
| `J-08` | `P0`: открыть locked deck как guest → Buy → sign in → купить | После verified transaction экран обновляется без relaunch; paywall исчезает, cards/assets доступны | StoreKit Test + Sandbox |
| `J-09` | `A0`: Restore purchases для ранее купленного Apple product | Backend entitlement появляется, owned deck открывается на этом устройстве | StoreKit Test + Sandbox |
| `J-10` | `P1`: начать paid session → получить refund/revocation | Текущая сессия завершается; новая не стартует; прогресс не удалён | Dev E2E + Sandbox |
| `J-11` | `A1`: изменить session size и privacy consent → открыть приложение на втором устройстве | Account settings сходятся с backend; локальное permission state не копируется | Dev E2E |
| `J-12` | `A1`: удалить прогресс из аккаунта → синхронизировать два устройства | Сервер и оба устройства показывают пустой progress; аккаунт и purchases сохранены | Dev E2E + Device |
| `J-13` | `A1`: удалить аккаунт → relaunch | Устройство становится guest; private scope очищен; pending deletion notice переживает relaunch | Dev E2E + Device |
| `J-14` | `A1`: access token истёк во время foreground sync | Выполнен single refresh; при невосстановимой сессии показан re-sign-in без удаления локальной работы | Dev E2E |
| `J-15` | `G0`: пройти multiple-choice с правильными и неправильными ответами | До выбора ответ не раскрыт; результат и scheduler mapping сохранены корректно | Mock CI |
| `J-16` | `A1`: sign out при непустом outbox | Показано число несинхронизированных ответов; Cancel сохраняет сессию; после подтверждения pending review остаются в изолированном account scope и не видны guest/другому аккаунту | Mock CI + Dev E2E |

## 5. Детальная E2E-матрица

### 5.1 Запуск, bootstrap и guest scope

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-LA-01` | P0 | Чистый online launch (`G0/C0`) | Появляется shell на системной локали; пользователь guest; нет auth gate | Mock CI |
| `IOS-E2E-LA-02` | P0 | Чистый offline launch с bundled release | Открывается bundled catalog, а не бесконечный loader/error wall | Mock CI |
| `IOS-E2E-LA-03` | P0 | Warm launch с сохранённым catalog | Shell открывается из store; обновление не создаёт скачка/обнуления чисел | Mock CI |
| `IOS-E2E-LA-04` | P1 | Нет локального catalog, backend timeout | Показан recoverable launch state с Retry | Mock CI |
| `IOS-E2E-LA-05` | P1 | Retry после восстановления backend | Catalog и progress загружаются, shell открывается один раз | Mock CI |
| `IOS-E2E-LA-06` | P1 | Возврат foreground при свежем catalog (<10 min) | Лишний content refresh не меняет экран; sync выполняется штатно | Mock CI |
| `IOS-E2E-LA-07` | P1 | Возврат foreground при stale catalog | Новая release применяется атомарно; текущая навигация остаётся валидной | Dev E2E |
| `IOS-E2E-LA-08` | P1 | Deep link в catalog/deck/progress/settings | Валидный route открывается и имеет рабочий Back; неизвестный/битый URL игнорируется | Mock CI |
| `IOS-E2E-LA-09` | P2 | Переключение Dev/Prod/Mock builds на одном simulator | У каждого environment отдельный store; данные не смешиваются; badge только debug | Mock CI |
| `IOS-E2E-LA-10` | P2 | Upgrade с предыдущей persistence schema | Catalog, guest progress, settings и active session сохраняются после migration | Mock CI |

### 5.2 Гостевой режим

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-GU-01` | P0 | Guest открывает Home, Catalog, Progress, Settings | Все базовые разделы доступны без входа | Mock CI |
| `IOS-E2E-GU-02` | P0 | Guest проходит несколько бесплатных сессий | Progress суммируется в одном guest scope и переживает relaunch | Mock CI |
| `IOS-E2E-GU-03` | P1 | Одна learning card входит в две колоды | Ответ в первой колоде отражается в progress второй без дублирования | Dev E2E |
| `IOS-E2E-GU-04` | P1 | Guest меняет session size/sound/haptics | Настройки применяются сразу и сохраняются локально | Mock CI |
| `IOS-E2E-GU-05` | P1 | Guest включает reminders | Запрашивается только локальное permission; backend account не требуется | Device |
| `IOS-E2E-GU-06` | P0 | Guest открывает paid deck | Видны discovery metadata/preview; полный список и Start закрыты | Mock CI |
| `IOS-E2E-GU-07` | P0 | Guest нажимает Buy | Открывается account flow; StoreKit purchase не стартует до auth | StoreKit Test |
| `IOS-E2E-GU-08` | P1 | Guest открывает Account после изучения N стран | Текст объясняет ценность входа и сохраняемый локальный прогресс; вход необязателен | Mock CI |

### 5.3 Apple/Google auth и guest migration

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-AU-01` | P0 | Первый Sign in with Apple | Nonce/state валидны; backend session создана; profile показан | Device + Dev E2E |
| `IOS-E2E-AU-02` | P0 | Первый Google Sign-In и callback | Возврат открывает исходное приложение; session создана один раз | Device + Dev E2E |
| `IOS-E2E-AU-03` | P1 | Apple sheet отменён | Пользователь остаётся guest; error alert не показывается | Device |
| `IOS-E2E-AU-04` | P1 | Google sheet отменён | То же поведение, что для Apple cancellation | Device |
| `IOS-E2E-AU-05` | P1 | Provider error/invalid credential | Показана безопасная retryable ошибка без token/PII | Mock CI + Device |
| `IOS-E2E-AU-06` | P1 | Вход offline | Guest state и локальный прогресс сохранены; показано понятное offline-сообщение | Mock CI |
| `IOS-E2E-AU-07` | P0 | Guest без review входит | Import не создаётся либо завершается `nothingToImport`; account готов | Mock CI |
| `IOS-E2E-AU-08` | P0 | Guest с review входит | Accepted events появляются в аккаунте; показан итог import | Mock CI + Dev E2E |
| `IOS-E2E-AU-09` | P0 | Повторный import того же guest snapshot | Review/settings не дублируются | Dev E2E |
| `IOS-E2E-AU-10` | P1 | Partial import | Принятые события не повторяются; отказанные обозначены и могут быть восстановлены по policy | Dev E2E |
| `IOS-E2E-AU-11` | P1 | Import оборван сетью и повторён после relaunch | Migration state переживает relaunch и доходит до terminal state | Dev E2E |
| `IOS-E2E-AU-12` | P0 | Existing account login поверх guest progress | Серверный и guest progress объединены событиями; серверные данные не затёрты | Dev E2E |
| `IOS-E2E-AU-13` | P1 | App relaunch с валидной keychain session | Пользователь остаётся authenticated; повторный provider sign-in не нужен | Device + Dev E2E |
| `IOS-E2E-AU-14` | P0 | Refresh token rejected/revoked | Состояние становится expired; доступна повторная авторизация; private данные не показываются другому scope | Dev E2E |

### 5.4 Account lifecycle и scope isolation

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-AC-01` | P0 | Sign out без pending work | Возврат в новый/закреплённый guest scope; account-only данные скрыты | Mock CI + Dev E2E |
| `IOS-E2E-AC-02` | P0 | Sign out с pending review → Cancel | Session/account/outbox остаются без изменений | Mock CI |
| `IOS-E2E-AC-03` | P0 | Sign out current device с pending review → Confirm | Pending review остаются в account scope до повторного входа того же account; guest scope их не видит и UI не заявляет их синхронизированными | Mock CI + Dev E2E |
| `IOS-E2E-AC-04` | P1 | Sign out everywhere | Текущая session завершается; другое устройство теряет session при следующем запросе | Dev E2E |
| `IOS-E2E-AC-05` | P0 | Account A → sign out → Account B | Progress/settings/entitlements A не видны B; общедоступный content cache переиспользуется безопасно | Dev E2E |
| `IOS-E2E-AC-06` | P0 | Clear progress: открыть dialog → Cancel | Ни local, ни server progress не меняются; outbox, session и settings нетронуты | Mock CI |
| `IOS-E2E-AC-07` | P0 | Clear progress → Confirm | Progress/outbox/курсоры очищены после server success; account/purchases/settings сохранены, и история не возвращается после relaunch и повторного входа | Mock CI + Dev E2E + Device |
| `IOS-E2E-AC-08` | P1 | Clear progress backend failure | Локальная история и очередь не удаляются; сессия сохранена; доступен retry | Mock CI |
| `IOS-E2E-AC-09` | P0 | Delete account → Cancel | Account остаётся активным, данные не меняются, notice не появляется даже после relaunch | Mock CI |
| `IOS-E2E-AC-10` | P0 | Delete account → success | App возвращается в guest; private scope/token/entitlement очищены; notice переживает relaunch; повторное удаление не предлагается | Mock CI + Dev E2E + Device |

### 5.5 Catalog, deck и content browsing

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-CO-01` | P0 | Переключение Home/Catalog/Progress | Состояние tab и toolbar стабильно; Account/Settings доступны с каждой вкладки | Mock CI |
| `IOS-E2E-CO-02` | P0 | Открыть бесплатную колоду из Home и Catalog | Открывается одна и та же deck detail модель | Mock CI |
| `IOS-E2E-CO-03` | P1 | Catalog grouping: featured/continent/subregion/editorial | Колоды находятся в ожидаемых секциях; одна колода может быть в нескольких подборках | Dev E2E |
| `IOS-E2E-CO-04` | P1 | Catalog search по title/alias | Результаты фильтруются без изменения исходной коллекции | Mock CI |
| `IOS-E2E-CO-05` | P1 | Catalog search без совпадений → очистить | Показан no-results, затем список полностью восстанавливается | Mock CI |
| `IOS-E2E-CO-06` | P1 | Deck card search по name/alias | Фильтр работает по текущей локали; count/empty states корректны | Mock CI |
| `IOS-E2E-CO-07` | P1 | Открыть country detail из deck list | Показаны только факты release; map открывается и закрывается | Mock CI |
| `IOS-E2E-CO-08` | P1 | Отсутствует необязательный fact/image | Layout не ломается; placeholder не выдаёт неверные данные | Mock CI |
| `IOS-E2E-CO-09` | P1 | Content locale unavailable | Используется documented fallback и видимый locale notice | Mock CI |
| `IOS-E2E-CO-10` | P1 | Catalog refresh failure при сохранённом catalog | Список остаётся доступен со stale/error status | Mock CI |
| `IOS-E2E-CO-11` | P1 | Published content update меняет asset, не card ID | Новый asset отображается; learning progress сохранён | Dev E2E |
| `IOS-E2E-CO-12` | P2 | Карточка с неизвестным будущим template | Она не попадает в новую сессию; resumed foreign snapshot показывает unsupported state без crash | Mock CI |

### 5.6 Free deck и self-rated study

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-ST-01` | P0 | Deck detail использует default session size | Выбранное в Settings значение отображается и передаётся в snapshot | Mock CI |
| `IOS-E2E-ST-02` | P1 | Изменить размер только для текущего запуска | Сессия использует override; account default не меняется | Mock CI |
| `IOS-E2E-ST-03` | P1 | В колоде меньше карточек, чем limit | Используются все уникальные доступные карточки; нет дублей ради заполнения | Mock CI |
| `IOS-E2E-ST-04` | P0 | Front card до reveal | Видны symbol/image и context, но ни visual, ни VoiceOver не раскрывают ответ | Mock CI |
| `IOS-E2E-ST-05` | P0 | Reveal answer | Показаны локализованное имя, template facts и доступ к detail | Mock CI |
| `IOS-E2E-ST-06` | P0 | Оценки Again и Good | Каждая оценка принимается один раз; открывается следующая карточка. Свайпом доступны только эти две: `Hard` и `Easy` существуют как accessibility actions на карточке и обычным касанием недостижимы, поэтому строка описывает то, что есть, а не четыре кнопки | Mock CI |
| `IOS-E2E-ST-07` | P0 | Again | Карточка повторяется по session policy, не увеличивая unique-card limit | Mock CI |
| `IOS-E2E-ST-08` | P1 | Double tap/swipe при commit | Создаётся один review, позиция сдвигается один раз | Mock CI |
| `IOS-E2E-ST-09` | P1 | Review save fails | Текущая карточка остаётся ответимой; показан non-destructive status | Mock CI |
| `IOS-E2E-ST-10` | P1 | Close до первого ответа | Пустая сессия не создаёт progress и не вызывает ложный sync success | Mock CI |
| `IOS-E2E-ST-11` | P0 | Close после части ответов | На Home и deck detail доступен Continue с верной позицией | Mock CI |
| `IOS-E2E-ST-12` | P0 | Завершить session | Result показывает фактически записанные ответы; Done возвращает к deck/home без второй записи | Mock CI |
| `IOS-E2E-ST-13` | P1 | Полностью правильная session | Success copy/celebration корректны; Reduce Motion убирает необязательную анимацию | Mock CI |
| `IOS-E2E-ST-14` | P1 | Все ответы Again | Result не поздравляет за несуществующий успех; progress/scheduler отражают ошибки | Mock CI |

### 5.7 Objective quiz и lifecycle сессии

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-QZ-01` | P0 | Feature flag off | Objective mode отсутствует, self-rated остаётся доступным | Mock CI |
| `IOS-E2E-QZ-02` | P0 | Feature flag on → начать quiz | На вопросе 4 уникальных локализованных варианта и один правильный | Mock CI |
| `IOS-E2E-QZ-03` | P0 | Выбрать правильный ответ | Выбор блокируется, исход обозначен icon+label, facts появляются после ответа | Mock CI |
| `IOS-E2E-QZ-04` | P0 | Выбрать неправильный ответ | Отмечены выбранный incorrect и правильный вариант; review записан как incorrect/Again | Mock CI |
| `IOS-E2E-QZ-05` | P1 | Tap другого option после ответа | Результат вопроса неизменяем; второй review не создаётся | Mock CI |
| `IOS-E2E-QZ-06` | P1 | Недостаточно distractors | Показан понятный unavailable state и безопасный выход | Mock CI |
| `IOS-E2E-QZ-07` | P0 | Relaunch в середине quiz | Восстановлены те же question IDs, options, order, seed и позиция | Mock CI |
| `IOS-E2E-QZ-08` | P0 | Завершить смешанный quiz | Result содержит корректное число correct/answered и возвращает назад | Mock CI |
| `IOS-E2E-QZ-09` | P1 | Background/foreground на front и после answer | Состояние не сбрасывается; ответ нельзя записать дважды | Device |
| `IOS-E2E-QZ-10` | P1 | Content update во время активной session | Session продолжает immutable snapshot; новая release применяется после неё | Dev E2E |

### 5.8 Paid decks и StoreKit

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-PD-01` | P0 | Discovery off, non-owner | Paid offers скрыты; free catalog не меняется | Mock CI |
| `IOS-E2E-PD-02` | P0 | Discovery on, non-owner | Locked deck видна с friendly paid badge и локализованной StoreKit price | StoreKit Test |
| `IOS-E2E-PD-03` | P0 | Discovery off, owner | Уже купленная колода остаётся видимой и доступной | Mock CI |
| `IOS-E2E-PD-04` | P1 | IAP flag off, non-owner | Paywall объясняет временную недоступность; entitlement не выдаётся | Mock CI |
| `IOS-E2E-PD-05` | P1 | Store product loading/unavailable | Нет фиктивной цены; retry/restore доступны по contract | StoreKit Test |
| `IOS-E2E-PD-06` | P0 | Guest нажимает Buy и успешно входит | После auth пользователь возвращается к той же paid deck и может продолжить покупку | StoreKit Test |
| `IOS-E2E-PD-07` | P0 | Verified purchase success | Локальный durable grant записан, transaction доставляется backend, deck открывается без relaunch | StoreKit Test + Sandbox |
| `IOS-E2E-PD-08` | P0 | User cancels payment sheet | Deck остаётся locked; error alert не показывается; Buy доступен повторно | StoreKit Test + Sandbox |
| `IOS-E2E-PD-09` | P0 | Purchase pending/Ask to Buy | Показан pending badge/status; cards/start недоступны | StoreKit Test + Sandbox |
| `IOS-E2E-PD-10` | P0 | Pending одобрен, пока app закрыта | Transaction listener открывает deck при следующем launch/foreground | StoreKit Test + Sandbox |
| `IOS-E2E-PD-11` | P0 | Success + unverified transaction | Доступ не открывается; показана безопасная ошибка/support reference | StoreKit Test |
| `IOS-E2E-PD-12` | P0 | Backend acknowledgement временно недоступен | Локально verified owner сохраняет доступ; delivery queued и повторяется | StoreKit Test + Dev E2E |
| `IOS-E2E-PD-13` | P0 | Restore на том же Country Flags account | Current entitlements отправлены backend; deck открыта idempotently | StoreKit Test + Sandbox |
| `IOS-E2E-PD-14` | P1 | Restore без покупок | Нейтральный результат, не ошибка; catalog не меняется | StoreKit Test + Sandbox |
| `IOS-E2E-PD-15` | P0 | Transaction уже bound к другому активному app account | Получен безопасный conflict; чужой account не раскрыт; deck не открыта | Dev E2E |
| `IOS-E2E-PD-16` | P0 | Sign out owner | Paid cards/assets удалены из private scope; discovery metadata остаётся; guest не получает доступ | Mock CI |
| `IOS-E2E-PD-17` | P0 | Sign back in owner offline с ранее скачанной deck | Entitlement snapshot и кеш дают offline access согласно policy | Mock CI |
| `IOS-E2E-PD-18` | P0 | Refund/revocation | Новая session закрыта; cached paid payload очищен; progress сохранён | Dev E2E + Sandbox |
| `IOS-E2E-PD-19` | P1 | Product снят с продажи/цена изменена | Existing owner сохраняет доступ; non-owner видит актуальную availability/price | StoreKit Test |
| `IOS-E2E-PD-20` | P1 | Добавлены карточки в уже купленную deck | Owner получает их без новой покупки; существующий progress сохранён | Dev E2E |

### 5.9 Coats, subdivisions и owned list

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-MC-01` | P0 | Открыть owned European Coats | Compact hero, progress, search, полный lazy list; purchase chrome отсутствует | Mock CI |
| `IOS-E2E-MC-02` | P0 | Начать coat self-rated session | Front показывает герб без ответа; back — country, symbol name и facts | Mock CI |
| `IOS-E2E-MC-03` | P1 | Открыть coat detail | Country facts и symbol story соответствуют subject/asset | Mock CI |
| `IOS-E2E-MC-04` | P0 | Открыть owned U.S. State Flags | В списке штаты, а не countries; parent country отображается корректно | Mock CI |
| `IOS-E2E-MC-05` | P0 | Начать state flag session | Front/back используют subdivision template; progress независим от country flag | Mock CI |
| `IOS-E2E-MC-06` | P1 | Открыть state detail | `State facts`: parent, capital, admission/statehood, area, population/story по наличию | Mock CI |
| `IOS-E2E-MC-07` | P1 | Objective distractors в coat/state deck | Все варианты совместимы по template и subject kind; coat не смешан со state flag | Mock CI |
| `IOS-E2E-MC-08` | P1 | Поиск owned list по entity и asset display name | Находятся нужные карточки; no-results корректен | Mock CI |

### 5.10 Progress, mastery и achievements

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-PR-01` | P0 | Fresh guest Progress | Показан осмысленный empty state, не таблица нулей и не loader | Mock CI |
| `IOS-E2E-PR-02` | P0 | Ответить одну карточку → Progress | Счётчики обновлены и ссылаются на общую learning card | Mock CI |
| `IOS-E2E-PR-03` | P1 | Открыть deck progress details | Видны counts/tier/cards; оттуда можно начать session | Mock CI |
| `IOS-E2E-PR-04` | P1 | Due queue существует | Home предлагает review due cards отдельно от незавершённой session | Mock CI |
| `IOS-E2E-PR-05` | P1 | Все due cards завершены | Появляется day-cleared state; ложный due CTA исчезает | Mock CI |
| `IOS-E2E-PR-06` | P1 | Mastery повысился | Current tier и highest achievement показаны согласно server definition | Dev E2E |
| `IOS-E2E-PR-07` | P1 | Current mastery понизился | Current tier меняется, highest achievement не отнимается | Dev E2E |
| `IOS-E2E-PR-08` | P1 | Получено achievement | Оно появляется один раз; повторный sync не дублирует награду | Dev E2E |
| `IOS-E2E-PR-09` | P1 | Locked paid deck без progress | Она не считается незавершённым обучением и не создаёт due CTA | Mock CI |
| `IOS-E2E-PR-10` | P1 | Account progress reload failure | Последнее подтверждённое состояние не подменяется локальными числами другого origin | Dev E2E |

### 5.11 Settings, reminders и privacy consent

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-SE-01` | P0 | Выбрать 5/10/20 | Контрол меняется сразу; выбранное значение переживает navigation/relaunch | Mock CI |
| `IOS-E2E-SE-02` | P0 | Account меняет session size online | Сначала сохранено локально, затем server version; следующая session использует значение | Dev E2E |
| `IOS-E2E-SE-03` | P1 | Settings version conflict | UI перечитывает backend settings и сообщает о convergence | Dev E2E |
| `IOS-E2E-SE-04` | P1 | Изменение settings offline → online | Выбор не откатывается молча; pending update синхронизируется | Dev E2E |
| `IOS-E2E-SE-05` | P1 | Sound off/on | Preference сохраняется; UI и session используют новое значение | Device |
| `IOS-E2E-SE-06` | P1 | Haptics off/on | Haptics немедленно прекращаются/возвращаются и переживают relaunch | Device |
| `IOS-E2E-SE-07` | P0 | Reminders on, permission not determined → Allow | Системный prompt появляется только после явного действия; reminder scheduled после grant | Device |
| `IOS-E2E-SE-08` | P1 | Notification permission denied | Preference не притворяется рабочей; показана ссылка в System Settings | Device |
| `IOS-E2E-SE-09` | P1 | Permission отозвано вне app | При следующем входе reminder отменён, UI показывает denied state | Device |
| `IOS-E2E-SE-10` | P1 | Reminders off | Scheduled notification отменяется | Device |
| `IOS-E2E-SE-11` | P0 | Product analytics/diagnostics defaults | Оба optional consent выключены на чистой установке | Mock CI |
| `IOS-E2E-SE-12` | P0 | Включить/выключить каждый consent независимо | Состояния независимы; выключение очищает соответствующую pending queue | Dev E2E |
| `IOS-E2E-SE-13` | P1 | Privacy consent conflict между устройствами | Client сходится с server version и показывает conflict notice | Dev E2E |
| `IOS-E2E-SE-14` | P1 | About | Version/build соответствуют bundle; Privacy/Terms открывают configured HTTPS URL | Device |

### 5.12 Offline, sync и multi-device

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-SY-01` | P0 | Offline free study | Никакой blocking error; review попадают в outbox | Mock CI |
| `IOS-E2E-SY-02` | P0 | Network restored | Sync запускается и pending count доходит до нуля; выгруженные ответы остаются прогрессом | Mock CI + Dev E2E |
| `IOS-E2E-SY-03` | P0 | Один review отправлен повторно | Backend idempotency не меняет статистику; UI не дублирует ответ | Dev E2E |
| `IOS-E2E-SY-04` | P1 | Batch partial acceptance | Accepted удаляются из outbox, retryable остаются, terminal не зацикливаются | Dev E2E |
| `IOS-E2E-SY-05` | P1 | 5xx/timeout во время sync | Account не разлогинивается; status показывает retryable failure | Dev E2E |
| `IOS-E2E-SY-06` | P0 | 401 → refresh success | Исходный запрос повторяется один раз; UI не теряет context | Dev E2E |
| `IOS-E2E-SY-07` | P0 | 401 → refresh rejected | Показан expired sign-in state; guest/account scope не смешиваются | Dev E2E |
| `IOS-E2E-SY-08` | P1 | Два устройства отвечают одну карточку offline | После sync оба review сохранены; canonical projection одинакова на устройствах | Dev E2E |
| `IOS-E2E-SY-09` | P1 | Out-of-order canonical change feed | Итог соответствует server cursor/version; старое состояние не перезаписывает новое | Dev E2E |
| `IOS-E2E-SY-10` | P1 | Tombstone/delete приходит на client | Удалённые записи исчезают; cursor продвигается; повтор безопасен | Dev E2E |
| `IOS-E2E-SY-11` | P1 | Pull-to-refresh при pending outbox | Content и account sync завершаются без двух параллельных runs | Mock CI |
| `IOS-E2E-SY-12` | P0 | Relaunch/crash между local commit и upload | Записанный review переживает завершение процесса и уходит на первом запуске, который может его отправить | Mock CI |

### 5.13 Feature flags, compatibility и failure recovery

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-FF-01` | P0 | Feature provider unavailable | Используются безопасные defaults; core study работает | Mock CI |
| `IOS-E2E-FF-02` | P1 | Immediate flag update | Только immediate surface меняется без relaunch | Mock CI |
| `IOS-E2E-FF-03` | P1 | nextSession flag меняется во время session | Активный snapshot неизменен; новое значение действует со следующей session | Mock CI |
| `IOS-E2E-FF-04` | P1 | nextLaunch flag refresh | Значение активируется после нового launch, не посреди текущего flow | Mock CI |
| `IOS-E2E-FF-05` | P0 | Paid/access flags off у owner | Entitlement сильнее discovery/storefront flag; owned content доступен | Mock CI |
| `IOS-E2E-FF-06` | P0 | Backend требует newer client | Показан forced-update state; старый client не повреждает store | Dev E2E |
| `IOS-E2E-FF-07` | P1 | Unknown enum/extra field в API | Client продолжает работу с forward-compatible fallback | Dev E2E |
| `IOS-E2E-FF-08` | P1 | Один paid cards endpoint отвечает 403 non-owner | Бесплатный catalog/content sync продолжается | Dev E2E |

### 5.14 Accessibility, localization, privacy и advertising defaults

| ID | P | Сценарий | Ожидаемый результат | Контур |
| --- | --- | --- | --- | --- |
| `IOS-E2E-UX-01` | P0 | RU и EN полный smoke | Нет raw localization keys, смешения языков и обрезанных основных CTA | Mock CI |
| `IOS-E2E-UX-02` | P1 | Максимальный Dynamic Type на iPhone SE | Auth, deck, session, result, settings остаются проходимыми | Mock CI + Device |
| `IOS-E2E-UX-03` | P1 | VoiceOver: guest → deck → session → result | Порядок фокуса логичен; front не озвучивает ответ; outcomes не зависят от цвета | Device |
| `IOS-E2E-UX-04` | P1 | Reduce Motion | Нет обязательной gesture/animation зависимости; celebration безопасна | Mock CI |
| `IOS-E2E-UX-05` | P1 | Системная light appearance | Приложение сохраняет утверждённую dark scene; системные sheet читаемы | Mock CI + Device |
| `IOS-E2E-UX-06` | P1 | Длинные названия/RTL-ready layout probe | Текст переносится, CTA доступны, важные значения не скрыты | Mock CI |
| `IOS-E2E-UX-07` | P0 | Optional analytics off | Продуктовый event payload не отправляется; core flows идентичны | Dev E2E |
| `IOS-E2E-UX-08` | P0 | Diagnostics off | Crash/performance optional payload не отправляется; operational local logs redacted | Dev E2E |
| `IOS-E2E-UX-09` | P0 | Первый релиз с NoOpAdvertisingProvider | Ни на одном placement нет пустого места, ATT prompt или IDFA access | Mock CI + Device |
| `IOS-E2E-UX-10` | P2 | Future ad flag/provider error/no-fill | Study/progress/layout не меняются; пользовательская ошибка не показывается | Mock CI |

Итого: **16 сквозных journeys + 160 детальных сценариев**: 75 P0, 81 P1 и
4 P2. Journeys намеренно
пересекаются с детальными тестами: первые ловят поломку связей между модулями,
вторые дают точную локализацию регрессии.

## 6. Что уже покрыто XCUITest

На 11 сентября 2026 года в `ios/CountryFlagsUITests` есть 41 UI-тест, включая
один screenshot flow. Прямое покрытие:

| Область | Существующие тесты |
| --- | --- |
| Launch/bundled/offline | `LaunchSmokeUITests` (3), `BundledFlagUITests` (1), `ContentBrowseUITests` (2) |
| Navigation | `TabToolbarUITests` (2) |
| Self-rated | `StudySessionUITests` (4), `CardBackFactsUITests` (1) |
| Objective | `ObjectiveSessionUITests` (3) |
| Progress/settings | `ProgressSettingsUITests` (5) |
| Sync presentation и offline → online upload | `SyncStatusUITests` (2) |
| Paid deck presentation | `PaidDeckUITests` (3) |
| Guest migration, sign-out и account isolation | `GuestAuthUITests` (4) |
| Clear progress и удаление приватных данных | `AccountProgressUITests` (4) |
| Account deletion: Cancel и Confirm | `AccountLifecycleUITests` (2) |
| Accessibility/localization | `AccessibilityUITests` (4) |
| Store screenshots | `StoreScreenshotUITests` (1) |

Самые крупные release gaps:

1. Guest migration и базовый sign-out покрыты через fixture auth; системные
   Apple/Google sheets, cancellation и provider failures ещё требуют Device и
   Dev E2E.
2. Изоляция progress, settings и entitlements при A → B → A, pending outbox при
   Cancel/Confirm sign-out, обе ветки Clear progress вместе с отказом бэкенда и
   обе ветки удаления аккаунта покрыты в Mock CI; private assets и multi-device
   convergence после очистки ещё не покрыты.
3. StoreKit UI проверяет locked/free/owned presentation, но не purchase,
   pending, cancellation, restore, unverified transaction и refund.
4. Из настроек проверяются session size, sound/haptics и product analytics
   consent — все через relaunch, потому что теряется такая настройка именно
   там. Остаются reminders с системным permission и сходимость конфликтов
   настроек между устройствами.
5. Offline → online upload покрыт в Mock CI на одном устройстве; multi-device
   convergence, partial batch acceptance и 401/refresh во время sync ещё нет.
   Диагностировать такие отказы через UI нельзя: sync run не сообщает исход
   ничему, что видно на экране, поэтому полная очередь выглядит как
   неустоявшийся запуск. Для этого в `MockLearningBackendTests` есть прогон
   настоящего координатора против фикстуры — он превращает «ответы не ушли»
   в номер строки.
6. Нет E2E для coats/subdivisions и template-compatible distractors.

## 7. Рекомендуемый порядок автоматизации

### Wave 1 — release blockers

`J-04`, `J-05`, `J-07`, `J-08`, `J-09`, `J-13`, `J-14`, `J-16`, затем
`AU-08`, `AC-05`, `PD-07..18`, `SY-02`, `SY-06..08`.

Начат CI-safe срез Wave 1:

- guest review → fixture sign-in → backend import → account progress;
- восстановление account session после relaunch без повторного import;
- sign-out → гостевой интерфейс и доступное обучение;
- Account A → sign-out → Account B → sign-out → Account A с проверкой
  изоляции и восстановления progress, session size и paid entitlement;
- sign-out с двумя pending review: точный warning, Cancel без потери сессии,
  Confirm без утечки в guest и восстановление очереди после повторного входа;
- Clear progress → Cancel: текст последствий, явная кнопка отмены, сохранённые
  progress, outbox, session и session size, в том числе после relaunch;
- Clear progress → Confirm: пустой Progress, удалённая очередь и курсоры,
  сохранённые session, session size и paid entitlement, отсутствие возврата
  истории после relaunch, sign-out и повторного входа;
- Clear progress при отказе бэкенда: история, очередь и сессия сохранены,
  показан текст неудачи, повторная попытка доступна;
- Delete account → Cancel: текст последствий, явная кнопка отмены, активная
  сессия, отсутствие notice и после relaunch;
- Delete account → Confirm: возврат в guest, пустой Progress, снова запертая
  платная колода, notice и невозможность удалить повторно, работающее гостевое
  обучение;
- offline → online: два ответа, записанные когда их некому принять, переживают
  завершение процесса и уходят на первом запуске, который достаёт до сервера;
  очередь пустеет, а сам прогресс остаётся;
- `QZ-07`: перезапуск посреди quiz возвращает тот же вопрос с теми же
  вариантами в том же порядке, а не свежесобранный;
- `ST-07`: карточка, брошенная `Again`, спрашивается снова до конца сессии;
- `SE`: звук, haptics и product analytics consent переживают перезапуск;
- `GuestAuthUITests`, `AccountProgressUITests`, `AccountLifecycleUITests` и
  `SyncStatusUITests` включены в pull-request smoke suite, а полный набор
  по-прежнему выполняется nightly.

### Wave 2 — settings и content expansion

`SE-02..13`, `MC-01..08`, catalog search/fallback и progress convergence.

### Wave 3 — resilience и extended UX

Feature activation policies, schema migration, future-template recovery,
accessibility matrix и advertising no-fill.

## 8. Требования к E2E harness

Чтобы эти тесты не стали flaky-набором, тестовый контур MUST предоставлять:

- один именованный scenario fixture вместо растущего набора несвязанных launch
  arguments;
- управляемые network states: online/offline/timeout/5xx/401/recovery;
- управляемые auth outcomes: success/cancel/provider failure/expired session;
- guest import outcomes: empty/applied/partial/pending/failure;
- StoreKit Test session для success/cancel/pending/unverified/refund;
- управляемые clock/time zone и content release/cursor;
- два изолированных app instances для multi-device сценариев;
- backend reset/seed endpoint, доступный только в test environment;
- accessibility identifiers для каждого CTA/status, но assertions по
  пользовательскому результату, а не по внутреннему implementation state;
- учёт того, что launch wait — отдельный экран, а не оверлей: оболочка вместе
  с таб-баром создаётся только после него, поэтому первый интерактивный кадр
  заменяет всю иерархию. Тап, попавший в этот момент, подтверждается, но не
  приводит ни к чему — и это касается таб-бара так же, как строк списка. Это
  решение продукта (за экраном ожидания нечего доставать), а не flakiness, и
  UI-тест обязан предлагать такой тап повторно, а не удлинять таймаут;
- attachment screenshot + app log + request ID + mock/backend scenario trace
  при каждом падении.

## 9. Сценарии из общего ТЗ, которых пока нет в текущем UI

Эти пункты не должны молча считаться покрытыми E2E. Перед добавлением тестов
нужен отдельный product/implementation task:

- выбор языка контента внутри приложения;
- default answer mode;
- настройка набора дополнительных facts;
- reminder time и дни недели;
- user-adjustable target retention;
- «сначала карточки к повторению»;
- linked identities, device roster/revoke и data export;
- отдельный achievements tab (экран существует в package, вкладка удалена из
  shell).

Для каждого возвращённого surface в том же PR MUST появиться как минимум один
happy-path и один recovery/permission/conflict E2E.
