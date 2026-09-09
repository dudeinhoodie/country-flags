# iOS E2E: catalog, decks and study

## IOS-E2E-011 Каталог, поиск и восстановление после ошибки контента

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `G0`, `C0`, затем `C1/N2`

### Description

Проверяет общий путь навигации по каталогу, поиск и сохранение доступности уже
загруженного контента при сетевой ошибке.

**Preconditions:**

- catalog содержит featured, continent и editorial sections;
- Europe доступна из Home и Catalog;
- несколько колод и карточек имеют aliases;
- backend может вернуть timeout при refresh.

### Scenario

- Последовательно открыть Home, Catalog и Progress.

  **Expected result**

  - выбранная вкладка отображается корректно;
  - Account и Settings доступны на каждой вкладке;
  - navigation stack одной вкладки не появляется в другой.

- В Catalog найти колоду по части названия и alias.

  **Expected result**

  - остаются только совпавшие колоды;
  - секции без результатов исчезают;
  - очистка поиска восстанавливает исходную группировку.

- Открыть Europe, найти страну по локализованному имени и alias, затем открыть
  country detail и карту.

  **Expected result**

  - показываются данные активного release;
  - отсутствующие optional facts не создают пустые строки;
  - карта открывается и закрывается без потери deck search state.

- Вернуться в Catalog, отключить backend и выполнить refresh.

  **Expected result**

  - сохранённый catalog остаётся доступен;
  - status сообщает о stale/offline состоянии;
  - повторный вход в Europe и запуск session работают.

- Восстановить сеть и повторить refresh.

  **Expected result**

  - status исчезает после успешного обновления;
  - каталог не дублирует секции или колоды.

## IOS-E2E-012 Полная self-rated сессия

- Priority: P0
- Execution: Mock CI
- Fixtures: `G0`, free deck с 10+ cards

### Description

Проверяет основной learning flow от настройки размера до экрана результата.

**Preconditions:**

- session size в Settings равен 5;
- self-rated mode доступен;
- в колоде не менее 5 совместимых learning cards.

### Scenario

- Открыть deck detail.

  **Expected result**

  - выбран размер 5;
  - видны mode selector, card count и Start;
  - Start доступен ровно один раз на tap.

- Нажать Start.

  **Expected result**

  - создан immutable snapshot из 5 уникальных карточек;
  - tab bar и navigation bar скрыты;
  - HUD показывает `1 / 5` и имя колоды.

- На первой карточке проверить front и нажать Show answer.

  **Expected result**

  - до reveal название страны отсутствует также в VoiceOver label;
  - после reveal показаны имя, flag/symbol и facts release;
  - доступна detail sheet.

- Ответить последовательно `Again`, `Hard`, `Good`, `Easy` и `Good`, используя
  кнопки и поддерживаемые swipe gestures.

  **Expected result**

  - каждое действие создаёт не более одного review;
  - `Hard` считается успешным воспоминанием, а не ошибкой;
  - HUD продвигается только после durable local commit;
  - `Again` следует session repetition policy и не увеличивает unique limit.

- Завершить все показы.

  **Expected result**

  - result использует фактически записанные review;
  - отображены remembered/planned и карточки с результатами;
  - CTA соответствует результату (`Excellent` только для полного успеха).

- Нажать Done и открыть Progress.

  **Expected result**

  - возврат происходит один раз;
  - завершённая session больше не предлагается как Continue;
  - progress учитывает все сохранённые оценки.

## IOS-E2E-013 Незавершённая сессия после close, background и relaunch

- Priority: P0
- Execution: Mock CI + Device
- Fixtures: `G0`, free deck, session size 10

### Description

Доказывает, что активная сессия является восстанавливаемым snapshot и не
перекомпонуется после прерываний.

**Preconditions:**

- active session отсутствует;
- content release не меняется до отдельного шага.

### Scenario

- Начать session на 10 карточек, ответить на первые 3 и свернуть приложение.

  **Expected result**

  - active session содержит исходный card order и position 4;
  - три review записаны;
  - background не закрывает session.

- Вернуться foreground.

  **Expected result**

  - показана та же четвёртая карточка;
  - уже отвеченные review не записаны повторно;
  - внешний sync не меняет snapshot.

- Нажать Close.

  **Expected result**

  - Home и deck detail предлагают Continue;
  - предложение содержит правильную колоду и позицию;
  - новый Start не подменяет resume неявно.

- Полностью выгрузить приложение и запустить снова.

  **Expected result**

  - Continue остаётся доступным;
  - после нажатия восстановлены size, mode, composition, order и position.

- Завершить session и перезапустить приложение ещё раз.

  **Expected result**

  - Continue исчез;
  - завершённый snapshot не возобновляется;
  - итоговый progress не удвоен.

## IOS-E2E-014 Повтор Again и защита от двойного ввода

- Priority: P0
- Execution: Mock CI
- Fixtures: `G0`, детерминированная session из 5 cards

### Description

Проверяет самую рискованную часть карточного UI: повтор ошибочной карточки и
idempotency при быстрых жестах.

**Preconditions:**

- первая карточка имеет известный card ID;
- test backend/repository считает созданные review IDs.

### Scenario

- Раскрыть первую карточку и почти одновременно дважды нажать `Again` либо
  выполнить два swipe.

  **Expected result**

  - контрол блокируется на время commit;
  - создаётся один review;
  - позиция меняется один раз;
  - карточка планируется на повтор согласно session policy.

- Ответить на остальные четыре уникальные карточки.

  **Expected result**

  - unique progress достигает 5/5;
  - session ещё не завершена, если повтор Again остаётся в очереди;
  - planned unique count остаётся равным 5.

- На повторе первой карточки ответить `Good`.

  **Expected result**

  - result показывает 5 unique cards и 6 фактических review;
  - история содержит оба последовательных результата одной learning card;
  - достижение за «без ошибок» не выдаётся.

## IOS-E2E-015 Objective quiz: правильные и неправильные ответы

- Priority: P0
- Execution: Mock CI
- Fixtures: objective flag on, free deck с достаточным distractor pool

### Description

Проверяет объективный режим, immutability ответа и итоговый score.

**Preconditions:**

- `study.multiple_choice.enabled=true` активирован до начала session;
- каждая карточка имеет 3 совместимых уникальных distractors;
- session size равен 5.

### Scenario

- Открыть deck detail, выбрать Quiz и начать session.

  **Expected result**

  - вопрос показывает symbol и четыре уникальных ответа;
  - ни visual state, ни accessibility tree не раскрывают правильный вариант;
  - option order зафиксирован в snapshot.

- На первом вопросе выбрать правильный option.

  **Expected result**

  - выбранный option помечен correct через цвет, icon и spoken label;
  - все options блокируются;
  - facts появляются только после ответа;
  - review записан как `isCorrect=true`, scheduler `Good`.

- Нажать другой option до Next.

  **Expected result**

  - исход не меняется;
  - второй review не создаётся.

- Нажать Next и выбрать неправильный option.

  **Expected result**

  - отдельно обозначены выбранный incorrect и правильный option;
  - review записан как `isCorrect=false`, scheduler `Again`.

- Завершить остальные вопросы и открыть result.

  **Expected result**

  - correct/answered равны фактически сохранённым ответам;
  - Done возвращает к колоде;
  - objective progress синхронизируется как обычные review events.

## IOS-E2E-016 Objective resume и недостаточный distractor pool

- Priority: P1
- Execution: Mock CI
- Fixtures: две колоды: валидная и с <4 уникальными display names

### Description

Проверяет восстановление точного quiz snapshot и безопасный отказ от запуска,
когда честный вопрос собрать невозможно.

**Preconditions:**

- objective flag включён;
- valid deck создаёт детерминированные option IDs/order;
- small deck не имеет достаточных distractors.

### Scenario

- Начать quiz valid deck, ответить на вопрос и закрыть приложение на следующем.

  **Expected result**

  - сохранены question IDs, option IDs, order, seed, policy version и position.

- Перезапустить приложение и продолжить session.

  **Expected result**

  - показан тот же вопрос с теми же options в том же порядке;
  - предыдущий ответ не предлагается повторно.

- Завершить session, открыть small deck и запустить Quiz.

  **Expected result**

  - session не создаёт вопрос с дублями;
  - показан понятный `not enough options` state;
  - Done безопасно возвращает назад;
  - progress/outbox не изменены.

## IOS-E2E-017 Content update и неизвестный card template

- Priority: P1
- Execution: Mock CI + Dev E2E
- Fixtures: release R1, release R2, future template fixture

### Description

Проверяет атомарность content update и forward-compatible поведение клиента.

**Preconditions:**

- R1 содержит card A и asset v1;
- R2 сохраняет learning card ID, но обновляет asset до v2;
- отдельный snapshot содержит template, неизвестный этой сборке.

### Scenario

- На R1 изучить card A и зафиксировать progress.

  **Expected result**

  - progress относится к learning card ID;
  - asset checksum соответствует v1.

- Опубликовать R2 и вернуть приложение foreground.

  **Expected result**

  - release применяется целиком, без смешения R1/R2;
  - отображается asset v2;
  - progress card A сохранён.

- Попытаться начать новую session с future template.

  **Expected result**

  - unsupported card исключается из новой composition;
  - остальные совместимые карточки работают;
  - диагностическое событие не содержит чувствительных данных.

- Открыть заранее сохранённую session, уже содержащую future template.

  **Expected result**

  - вместо crash показан unsupported-card state;
  - пользователь может безопасно закрыть session;
  - неизвестный template не интерпретируется как другой известный тип.
