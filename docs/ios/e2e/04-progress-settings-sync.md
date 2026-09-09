# iOS E2E: progress, settings and synchronization

## IOS-E2E-029 Progress, mastery и achievements

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `G0`, затем `A1` с server mastery definitions

### Description

Проверяет путь от пустого Progress до изменения mastery и выдачи достижения.

**Preconditions:**

- fresh guest не имеет review;
- backend fixture умеет повысить и затем понизить current mastery;
- highest achievement уже выдан после первого повышения.

### Scenario

- Открыть Progress на чистой установке.

  **Expected result**

  - показан осмысленный empty state;
  - экран не выглядит как незавершённая загрузка.

- Ответить одну карточку и снова открыть Progress.

  **Expected result**

  - deck row показывает обновлённые counts;
  - можно открыть deck progress и начать session;
  - общий card progress не дублируется между колодами.

- Войти как A1 и синхронизировать повышение до Gold.

  **Expected result**

  - current mastery показывает Gold;
  - achievement появляется один раз;
  - повторный sync не дублирует награду.

- Применить server state с понижением current mastery до Silver.

  **Expected result**

  - current mastery становится Silver;
  - highest achievement остаётся Gold;
  - UI не сообщает, что награда была отобрана.

## IOS-E2E-030 Настройки: persistence, account sync и conflict

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `G0`, затем `A1` на двух устройствах

### Description

Проверяет immediate UI, локальное сохранение, серверную синхронизацию и
детерминированное разрешение version conflict.

**Preconditions:**

- default session size 10, sound/haptics on;
- A1 имеет server settings version V1;
- оба устройства начали с V1.

### Scenario

- Как guest выбрать size 20, выключить sound и haptics, уйти со страницы и вернуться.

  **Expected result**

  - controls отвечают сразу;
  - значения сохранены локально;
  - новая session использует size 20 и не воспроизводит отключённый feedback.

- Перезапустить приложение.

  **Expected result**

  - три значения восстановлены в том же guest scope.

- Войти как A1 и изменить size на 5 online.

  **Expected result**

  - значение сначала durable сохранено локально;
  - backend принимает новую version;
  - следующая session использует 5.

- На устройстве B изменить settings от V1, затем отправить stale update с A.

  **Expected result**

  - conflict не ретраится бесконечно;
  - A перечитывает canonical server settings;
  - UI показывает convergence notice;
  - ни одно устройство не смешивает settings другого account scope.

## IOS-E2E-031 Напоминания и системное permission

- Priority: P0
- Execution: Device
- Fixtures: notification authorization `notDetermined`, затем denied/authorized

### Description

Проверяет, что системное разрешение запрашивается только после явного действия
и локальное состояние не притворяется синхронизированным permission другого
устройства.

**Preconditions:**

- приложение ещё не запрашивало notifications;
- reminders выключены;
- scheduled requests отсутствуют.

### Scenario

- Открыть Settings, но не трогать Reminders.

  **Expected result**

  - системный prompt не появляется.

- Включить Reminders и нажать Allow reminders.

  **Expected result**

  - prompt появляется после явного действия;
  - при Allow preference остаётся on и notification scheduled;
  - повторный вход не вызывает prompt снова.

- Выключить Reminders.

  **Expected result**

  - scheduled notification удаляется;
  - permission системы не изменяется.

- Сбросить fixture, повторить flow и выбрать Don’t Allow.

  **Expected result**

  - notification не scheduled;
  - UI показывает denied explanation и ссылку в System Settings;
  - повторный toggle не вызывает недоступный prompt.

- Разрешить notifications в System Settings и вернуться в приложение.

  **Expected result**

  - authorization перечитан;
  - reminder scheduled только если preference включён;
  - setting, пришедший с другого устройства, не показывает prompt автоматически.

## IOS-E2E-032 Product analytics и diagnostics consent

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: clean install, controllable analytics/diagnostics collectors

### Description

Проверяет независимый opt-in, остановку сбора и очистку неотправленной optional
телеметрии.

**Preconditions:**

- оба consent имеют default denied/off;
- test collectors и delivery endpoint ведут счёт событий без payload PII.

### Scenario

- Пройти guest session, не меняя privacy toggles.

  **Expected result**

  - core progress работает;
  - optional product events и diagnostic payload не отправлены.

- Включить только Product analytics и повторить действия.

  **Expected result**

  - отправляются только зарегистрированные product events;
  - diagnostics остаётся off;
  - payload не содержит country answer, auth token или StoreKit JWS.

- Включить Diagnostics, затем создать контролируемую recoverable error.

  **Expected result**

  - diagnostic report разрешён;
  - product и diagnostics queues независимы;
  - request/support identifiers не содержат secret.

- Отключить оба consent offline.

  **Expected result**

  - соответствующие pending optional queues очищены;
  - после восстановления сети старые payload не отправляются;
  - обучение и sync progress продолжают работать.

## IOS-E2E-033 Offline session → online outbox synchronization

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `A1`, `N1`, затем `N0`

### Description

Проверяет основной offline-sync контракт и idempotency повторной доставки.

**Preconditions:**

- A1 авторизован и имеет скачанную free deck;
- outbox пуст;
- backend snapshot/cursor зафиксированы.

### Scenario

- Отключить сеть и пройти session из 5 карточек.

  **Expected result**

  - session не блокируется;
  - пять review durable записаны до изменения UI;
  - outbox содержит пять уникальных IDs;
  - sync status показывает pending work, а не успех.

- Перезапустить приложение offline.

  **Expected result**

  - локальный progress и outbox сохранены;
  - account не разлогинен из-за network error.

- Восстановить сеть.

  **Expected result**

  - sync запускается foreground/reachability trigger;
  - backend принимает каждый review ровно один раз;
  - canonical states применяются;
  - pending count доходит до нуля.

- Принудительно повторить тот же batch.

  **Expected result**

  - backend отвечает idempotently;
  - progress/counts не меняются второй раз;
  - cursor остаётся монотонным.

## IOS-E2E-034 Partial batch, timeout и session refresh

- Priority: P1
- Execution: Dev E2E
- Fixtures: `A1`, batch из accepted/retryable/terminal events

### Description

Проверяет восстановление синхронизации при частичном ответе, 5xx и 401.

**Preconditions:**

- outbox содержит три известных review;
- backend может последовательно вернуть partial, timeout, 401+refresh success.

### Scenario

- Отправить batch и вернуть один accepted, один retryable, один terminal result.

  **Expected result**

  - accepted удалён из pending;
  - retryable остаётся с bounded retry metadata;
  - terminal не отправляется бесконечно и имеет безопасный diagnostics code;
  - UI не объявляет весь batch успешным.

- На retry вернуть timeout/5xx.

  **Expected result**

  - account остаётся authenticated;
  - local progress не откатывается;
  - status допускает retry.

- На следующем запросе вернуть 401, затем успешный refresh token exchange.

  **Expected result**

  - выполняется один refresh для конкурирующих запросов;
  - исходный запрос повторяется один раз;
  - оставшееся событие синхронизируется.

## IOS-E2E-035 Multi-device conflict и canonical convergence

- Priority: P0
- Execution: Dev E2E
- Fixtures: два изолированных устройства A/B одного account, controllable clock

### Description

Проверяет, что offline review с двух устройств не теряются и сходятся к одному
серверному projection независимо от порядка доставки.

**Preconditions:**

- оба устройства получили один canonical state/cursor;
- затем оба переходят offline;
- client sequence и clock фиксируются test harness.

### Scenario

- На A ответить одну card `Again`, на B ту же card `Good`.

  **Expected result**

  - каждое устройство создаёт свой уникальный review ID;
  - локальные projections могут временно различаться;
  - ни одно событие не знает о другом до sync.

- Синхронизировать B, затем A.

  **Expected result**

  - backend сохраняет оба события;
  - порядок определяется canonical effective time/tie-break policy;
  - stale событие запускает reconciliation, а не overwrite истории.

- Синхронизировать оба устройства ещё раз.

  **Expected result**

  - card state, due, progress и cursor одинаковы;
  - повторные pulls не меняют итог;
  - настройки и entitlements account также не дублируются.
