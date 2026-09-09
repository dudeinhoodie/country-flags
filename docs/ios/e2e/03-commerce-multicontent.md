# iOS E2E: commerce and multi-content decks

## IOS-E2E-018 Guest покупает платную колоду

- Priority: P0
- Execution: StoreKit Test + Sandbox
- Fixtures: `G0`, `P0`, discovery/IAP flags on

### Description

Проверяет главный revenue flow: locked deck → account → Apple payment →
моментально доступная owned deck.

**Preconditions:**

- paid deck видна в Catalog;
- StoreKit возвращает локализованные product metadata и цену;
- backend offer связан со стабильным entitlement;
- guest не имеет account и paid payload.

### Scenario

- Открыть paid deck из Catalog.

  **Expected result**

  - показаны discovery metadata и разрешённый preview;
  - полный список карточек и Start отсутствуют;
  - цена взята из StoreKit, а не из backend/зашитой строки.

- Нажать Buy.

  **Expected result**

  - StoreKit sheet ещё не открывается;
  - пользователь направлен на Account, потому что purchase требует backend account.

- Успешно войти и вернуться к той же колоде.

  **Expected result**

  - навигационный context сохранён;
  - Buy доступен;
  - purchase использует `appAccountToken` активного пользователя.

- Нажать Buy и подтвердить системную оплату.

  **Expected result**

  - на время операции исключён повторный purchase tap;
  - verified transaction записана durable локально;
  - локальный entitlement открывает экран без relaunch;
  - transaction поставлена на backend delivery.

- Дождаться backend acknowledgement.

  **Expected result**

  - paywall, price, Buy и Restore исчезают;
  - загружаются cards/assets;
  - появляются search, full list и Start learning;
  - повторный launch сохраняет owned state.

## IOS-E2E-019 Отмена, недоступный Store и unverified transaction

- Priority: P0
- Execution: StoreKit Test + Sandbox
- Fixtures: `A0`, `P0`

### Description

Проверяет три неуспешных исхода оплаты без ложной выдачи доступа.

**Preconditions:**

- пользователь авторизован;
- entitlement отсутствует;
- paid deck locked.

### Scenario

- Начать покупку и отменить Apple payment sheet.

  **Expected result**

  - sheet закрывается без error alert;
  - deck остаётся locked;
  - transaction/delivery record не создаются;
  - Buy доступен повторно.

- Настроить StoreKit product unavailable и открыть paywall заново.

  **Expected result**

  - фиктивная цена не отображается;
  - UI сообщает о временной недоступности;
  - Restore остаётся доступен;
  - free catalog продолжает работать.

- Вернуть StoreKit `success + unverified`.

  **Expected result**

  - entitlement не выдаётся ни локально, ни на backend;
  - transaction не finish до безопасной обработки policy;
  - UI показывает безопасную ошибку и support reference;
  - JWS/transaction payload не появляется в тексте или analytics.

## IOS-E2E-020 Pending/Ask to Buy и одобрение после закрытия приложения

- Priority: P0
- Execution: StoreKit Test + Sandbox
- Fixtures: `A0`, `P2`

### Description

Проверяет долгоживущую pending transaction, которая завершается вне открытого
paywall.

**Preconditions:**

- StoreKit purchase настроена как pending;
- entitlement отсутствует;
- transaction listener запускается на root.

### Scenario

- Купить колоду и получить `pending`.

  **Expected result**

  - payment flow закрывается;
  - deck остаётся locked;
  - показан friendly pending badge/status;
  - Start и полный список отсутствуют;
  - повторный tap не создаёт конкурирующую покупку.

- Закрыть приложение, одобрить Ask to Buy и запустить приложение снова.

  **Expected result**

  - root transaction listener получает verified update;
  - локальная выдача и backend delivery выполняются один раз;
  - deck становится owned без повторного Buy;
  - pending status исчезает.

## IOS-E2E-021 Restore purchases на новом устройстве

- Priority: P0
- Execution: StoreKit Test + Sandbox + Dev E2E
- Fixtures: чистое устройство, `A1`, ранее купленный product

### Description

Проверяет восстановление non-consumable покупки и нейтральный результат, если
восстанавливать нечего.

**Preconditions:**

- Apple Account имеет verified current entitlement;
- Country Flags account A1 является допустимым владельцем;
- локальный store пуст;
- обычный launch не вызывает принудительный `AppStore.sync()`.

### Scenario

- Войти как A1 и открыть locked deck.

  **Expected result**

  - до refresh/restore deck не выдаёт доступ из предположения;
  - Restore виден.

- Нажать Restore purchases и завершить системную авторизацию.

  **Expected result**

  - `AppStore.sync()` вызван только после явного tap;
  - verified current entitlements отправлены backend;
  - snapshot обновлён атомарно;
  - deck становится owned без новой оплаты.

- Повторить Restore.

  **Expected result**

  - операция idempotent;
  - второй grant/review/content duplicate не создаётся.

- Выполнить Restore в отдельном account без покупок.

  **Expected result**

  - показан нейтральный `nothing to restore` результат;
  - это не трактуется как системная ошибка.

## IOS-E2E-022 Verified локально, backend временно недоступен

- Priority: P0
- Execution: StoreKit Test + Dev E2E
- Fixtures: `A0`, successful verified transaction, `N2`

### Description

Проверяет разделение local delivery и server acknowledgement: оплаченный
контент не должен исчезнуть из-за временной ошибки backend.

**Preconditions:**

- StoreKit подтверждает transaction;
- endpoint transaction delivery отвечает timeout/5xx;
- локальный store доступен для durable write.

### Scenario

- Завершить покупку при недоступном backend.

  **Expected result**

  - verified transaction сохранена до `finish`;
  - локальный доступ открыт;
  - backend delivery помечена pending;
  - пользователь не просится купить повторно.

- Перезапустить приложение всё ещё offline.

  **Expected result**

  - owned deck доступна по durable local entitlement;
  - ранее скачанные cards/assets работают;
  - pending delivery не потеряна.

- Восстановить backend и вернуть приложение foreground.

  **Expected result**

  - delivery повторяется с тем же transaction identity;
  - backend подтверждает entitlement;
  - pending status исчезает;
  - transaction не создаёт второй purchase event.

## IOS-E2E-023 Refund/revocation во время обучения

- Priority: P0
- Execution: Dev E2E + Sandbox
- Fixtures: `P1`, активная paid session

### Description

Проверяет отзыв доступа без прерывания оплаченной ранее активной сессии и без
удаления учебной истории.

**Preconditions:**

- entitlement active;
- paid cards/assets загружены;
- пользователь ответил часть карточек текущей session.

### Scenario

- Пока session открыта, доставить refund/revocation и выполнить entitlement refresh.

  **Expected result**

  - текущая immutable session не закрывается посередине;
  - уже записанные ответы сохраняются;
  - новый grant не создаётся.

- Завершить session и вернуться к deck detail.

  **Expected result**

  - новая session не запускается;
  - deck снова отображается locked/revoked по product copy;
  - paid cards/assets очищаются согласно cache policy;
  - progress не удаляется.

- Доставить refund reversed/восстановить entitlement.

  **Expected result**

  - доступ возвращается;
  - прежний progress снова виден;
  - повторная покупка не требуется.

## IOS-E2E-024 Sign out владельца и повторный offline вход

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: `P1`, затем guest и тот же A1

### Description

Проверяет, что entitlement принадлежит аккаунту, а не устройству, и что
подтверждённый owner может использовать ранее скачанную колоду offline.

**Preconditions:**

- A1 владеет deck и скачал её полностью;
- entitlement snapshot сохранён в account scope.

### Scenario

- Выйти из A1.

  **Expected result**

  - guest не видит owned state;
  - private paid cards/assets A1 удалены или недоступны;
  - discovery metadata может оставаться публичной;
  - free content не очищается.

- Войти как A2 без entitlement.

  **Expected result**

  - deck locked;
  - данные A1 не используются для открытия или preview.

- Выйти, отключить сеть и восстановить локально известную session A1.

  **Expected result**

  - если policy допускает offline re-entry с валидной сохранённой session,
    entitlement snapshot A1 открывает ранее скачанную deck;
  - новый контент без кеша не притворяется доступным;
  - при восстановлении сети snapshot сверяется с backend.

## IOS-E2E-025 Покупка привязана к другому Country Flags аккаунту

- Priority: P0
- Execution: Dev E2E + StoreKit Test
- Fixtures: transaction T привязана A1; активен A2

### Description

Проверяет защиту от автоматического переноса одной Apple transaction между
двумя активными аккаунтами приложения.

**Preconditions:**

- T уже подтверждена backend для A1;
- A1 не удалён;
- на устройстве выполнен вход как A2;
- Apple Account возвращает T в current entitlements.

### Scenario

- Как A2 нажать Restore purchases.

  **Expected result**

  - backend отвечает conflict `PURCHASE_BOUND_TO_ANOTHER_ACCOUNT`;
  - A2 не получает entitlement;
  - UI не раскрывает email, ID или иные данные A1;
  - показаны безопасный support reference и понятный следующий шаг.

- Перезапустить приложение и открыть paid deck.

  **Expected result**

  - deck остаётся locked для A2;
  - conflict не превращается в бесконечный restore loop;
  - A1 сохраняет доступ на своём устройстве.

## IOS-E2E-026 Уже купленная колода получает новые карточки

- Priority: P1
- Execution: Dev E2E
- Fixtures: A1 владеет deck release R1; release R2 расширяет состав

### Description

Проверяет lifetime-доступ к обновлениям состава без повторной покупки.

**Preconditions:**

- R1 куплена и частично изучена;
- R2 сохраняет deck code/required entitlement и добавляет карточки/assets;
- transaction/product не меняются.

### Scenario

- Зафиксировать owned list и progress на R1.

  **Expected result**

  - известны исходный card count и изученные learning card IDs.

- Опубликовать R2 и обновить content.

  **Expected result**

  - A1 получает новые карточки без paywall;
  - старые progress records сохранены;
  - новые карточки имеют начальное состояние;
  - removed/replaced assets следуют versioning policy.

- Открыть приложение как non-owner.

  **Expected result**

  - полный R2 payload не раскрывается;
  - публичный preview остаётся ограниченным.

## IOS-E2E-027 European Coats после покупки

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: owner `European Coats`, coat templates/assets

### Description

Проверяет owned list, карточку герба и независимый progress относительно флага
той же страны.

**Preconditions:**

- entitlement active;
- Germany имеет country flag card и country coat card;
- coat содержит symbol name/story и country facts.

### Scenario

- Открыть European Coats из Catalog.

  **Expected result**

  - commerce chrome отсутствует;
  - видны compact hero, progress, search и полный lazy list;
  - thumbnail использует aspect-fit coat asset.

- Найти Germany и открыть detail.

  **Expected result**

  - subject — Germany;
  - отображены Federal Eagle, symbol story и Country facts;
  - данные flag card не подменяют coat-specific поля.

- Начать self-rated session и раскрыть Germany.

  **Expected result**

  - front показывает герб без названия страны;
  - back показывает country name и symbol name;
  - review записывается для coat learning card.

- Открыть progress обычной Germany flag card.

  **Expected result**

  - он независим от coat progress;
  - агрегаты deck считают только собственные card variants.

## IOS-E2E-028 U.S. State Flags после покупки

- Priority: P0
- Execution: Mock CI + Dev E2E
- Fixtures: owner `U.S. State Flags`, California/Washington/Texas

### Description

Проверяет subdivision content, state facts и совместимые distractors.

**Preconditions:**

- entitlement active;
- три state entities имеют parent United States, flags и локализованные facts;
- country flag cards существуют отдельно.

### Scenario

- Открыть owned U.S. State Flags и найти California.

  **Expected result**

  - список состоит из subdivisions, а не country catalog;
  - row показывает state flag и state name;
  - поиск по имени/alias работает.

- Открыть detail California.

  **Expected result**

  - heading — State facts;
  - parent country — United States;
  - capital, admission/statehood, area, population и story показаны только при наличии;
  - штат не назван суверенной страной.

- Пройти одну self-rated state card.

  **Expected result**

  - review относится к subdivision flag learning card;
  - progress флага США не меняется.

- Запустить objective mode.

  **Expected result**

  - distractors состоят только из state flag cards совместимого template;
  - country coats и country flags не смешиваются случайно;
  - VoiceOver front не произносит название штата.
