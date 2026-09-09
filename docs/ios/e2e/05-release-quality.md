# iOS E2E: release quality and compatibility

## IOS-E2E-036 Feature flags и безопасные activation boundaries

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: provider failure, immediate/nextSession/nextLaunch flags

### Description

Проверяет безопасные defaults и то, что remote flag не меняет уже начатую
операцию или право доступа.

**Preconditions:**

- registry содержит objective, review submission, commerce/content и ad flags;
- active session и owned paid deck доступны fixtures.

### Scenario

- Запустить приложение при недоступном feature provider.

  **Expected result**

  - используются registry defaults;
  - free catalog и self-rated study работают;
  - экспериментальные/commerce/ad surfaces не включаются случайно.

- Изменить immediate presentation flag.

  **Expected result**

  - разрешённый surface обновляется без relaunch;
  - navigation state не сбрасывается.

- Во время active session изменить nextSession learning flag.

  **Expected result**

  - текущий snapshot не меняется;
  - значение действует только для следующей session.

- Изменить nextLaunch flag и обновить config.

  **Expected result**

  - текущий run не меняется;
  - значение активируется после relaunch.

- Выключить paid discovery/IAP для owner.

  **Expected result**

  - entitlement продолжает открывать купленную deck;
  - ни один flag не выдаёт доступ non-owner.

## IOS-E2E-037 Forced update и forward-compatible content/API

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: min-supported build выше client, unknown enum/template/field

### Description

Проверяет контролируемый отказ по compatibility contract вместо crash или
повреждения локального store.

**Preconditions:**

- сохранён рабочий catalog и progress;
- backend может потребовать новую версию;
- отдельный response содержит additive field и неизвестный enum case.

### Scenario

- Вернуть min-supported build выше установленного.

  **Expected result**

  - показан forced-update state с рабочим App Store CTA;
  - обучение, запрещённое contract, не стартует;
  - локальный catalog/progress не удаляются.

- Вернуть поддерживаемую версию и response с additive field/unknown enum.

  **Expected result**

  - известные данные декодируются и отображаются;
  - неизвестное значение получает безопасный fallback;
  - app не crash и не записывает неверный known case.

- Вернуть 403 только для paid cards non-owner.

  **Expected result**

  - paid payload не раскрыт;
  - бесплатный catalog/change feed продолжают синхронизацию;
  - global content sync не считается полностью упавшим.

## IOS-E2E-038 Localization, Dynamic Type, VoiceOver и Reduce Motion

- Priority: P0
- Execution: Mock CI + Device
- Fixtures: RU/EN, iPhone SE, accessibility sizes, VoiceOver, Reduce Motion

### Description

Проверяет проходимость основных journeys с поддерживаемыми локалями и
системными accessibility-настройками.

**Preconditions:**

- catalog содержит длинные RU/EN названия;
- app запускается на маленьком экране;
- screenshot attachments включены.

### Scenario

- Пройти guest → Catalog → deck → self-rated result на RU, затем на EN.

  **Expected result**

  - нет raw localization keys или смешения локалей интерфейса;
  - CTA и значения не обрезаны;
  - fallback content locale явно обозначен, если применён.

- Повторить ключевые экраны с максимальным Dynamic Type.

  **Expected result**

  - auth buttons, search, cards, options, result и settings доступны скроллом;
  - touch targets не перекрываются;
  - важный текст не truncates без альтернативы.

- Включить VoiceOver и пройти один self-rated и один objective вопрос.

  **Expected result**

  - порядок фокуса соответствует визуальному flow;
  - front не озвучивает правильный ответ;
  - correct/incorrect различимы не только цветом;
  - Close/Reveal/Rating/Next имеют понятные labels.

- Включить Reduce Motion и завершить session.

  **Expected result**

  - ни один шаг не требует анимации или swipe;
  - celebration/gauge не вызывают обязательного ожидания;
  - result остаётся полностью читаемым.

## IOS-E2E-039 Release privacy, NoOp ads и environment isolation

- Priority: P0
- Execution: Mock CI + Device + archive validation
- Fixtures: Prod archive, Dev/Mock builds, ads flags on/off

### Description

Проверяет, что production не содержит тестовый backend, optional реклама ничего
не ломает, а environment data не смешиваются.

**Preconditions:**

- собраны Prod, Dev и Mock targets;
- первый релиз использует `NoOpAdvertisingProvider`;
- analytics/diagnostics consent off.

### Scenario

- Установить Mock, создать guest progress, затем установить/запустить Dev и Prod.

  **Expected result**

  - у каждого environment отдельный store;
  - Mock progress не появляется в Dev/Prod;
  - environment badge виден только там, где разрешены debug affordances.

- В Prod пройти Home, Catalog и session result при включённых remote ad flags.

  **Expected result**

  - NoOp provider не резервирует пустое место;
  - ATT prompt не показывается;
  - IDFA не запрашивается;
  - no-fill/provider absence не создают пользовательскую ошибку.

- Проверить archive contents и основные flows с consent off.

  **Expected result**

  - нет mock resources, fixtures, debug sign-in и mock host strings;
  - privacy manifest соответствует фактическим collectors;
  - optional analytics/diagnostics payload не отправляются;
  - auth, study, progress и purchase работают независимо от consent.

- Обновить приложение с предыдущей persistence schema.

  **Expected result**

  - guest/account scope, settings, content cache, active session и commerce
    records мигрируются без потери или межаккаунтного смешения.
