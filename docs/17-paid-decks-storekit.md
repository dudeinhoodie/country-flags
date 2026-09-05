# Техническое задание: платные колоды и StoreKit

Статус: `Proposed implementation baseline 0.3`

Дата: 4 сентября 2026 года. Ревизия 0.2 того же дня закрывает замечания
технического ревью: bootstrap клиента, бандлинг платных ассетов, оффлайн-импорт
после refund, неймспейс entitlement keys и имена флагов и событий.

Ревизия 0.3 фиксирует границу доставки контента: общий Entity API и глобальный
change feed являются только публичной projection, а paid-only assets выдаются
через entitlement-protected deck payload и короткоживущие signed URLs.

Архитектурное решение: [ADR-019](./adr/ADR-019-paid-deck-entitlements.md)

Зависимости: [Product spec](./00-product-spec.md), [Backend spec](./01-backend-spec.md), [iOS spec](./02-ios-spec.md), [Admin ADR](./adr/ADR-014-admin-console-architecture.md), [Publisher ADR](./adr/ADR-017-in-product-publisher-and-rollback.md)

## 1. Цель

Добавить продажу отдельных колод как разовых покупок внутри iOS-приложения.

Система должна:

- показывать бесплатные колоды всем пользователям;
- показывать платные колоды в каталоге, но блокировать их содержимое и запуск обучения без покупки;
- принимать оплату на iOS только через Apple In-App Purchase;
- после подтверждённой покупки открывать колоду навсегда для аккаунта;
- восстанавливать покупку на новом устройстве;
- синхронизировать доступ между устройствами и в будущем между iOS, Android и Web;
- обрабатывать pending purchase, повторную доставку, refund и revocation;
- позволять создавать платные колоды и связывать их с товарами Apple в админке;
- сохранять существующий immutable content-release flow;
- не связывать доступ с количеством или типом карточек внутри колоды.

Внутри платной колоды MAY быть любое поддерживаемое число карточек с флагами, гербами и будущими типами контента. Entitlement проверяется на уровне колоды, а не отдельного изображения или карточки.

## 2. Принятые продуктовые решения

### 2.1 Модель оплаты

Для первой версии используется **разовая покупка Apple Non-Consumable In-App Purchase**.

- Покупка не является подпиской.
- Покупка не истекает по времени.
- Покупка не расходуется.
- Один Apple product MAY открывать одну колоду или набор колод.
- Для продажи одной колоды создаётся один offer, выдающий entitlement этой колоды.
- Для набора создаётся отдельный offer, выдающий entitlement каждой входящей колоды.
- В доменной модели количество платных колод не ограничено. Текущий лимит Apple — до 10 000 In-App Purchase products на одно приложение; поэтому Deck и Store product не связаны один-к-одному, а bundles и повторное использование entitlement позволяют не расходовать product catalog без необходимости.
- Consumable credits, внутренняя валюта и Advanced Commerce API не входят в первую версию.

Apple требует использовать In-App Purchase для цифрового контента и функций, открываемых внутри приложения. Apple Pay, Stripe, банковская карта, license key, QR-код или внешний checkout для этого iOS-flow не используются.

### 2.2 Пользовательские состояния

Различаются три состояния:

1. **Guest** — пользователь без backend-аккаунта. Бесплатные колоды доступны, платные заблокированы.
2. **Free account** — авторизованный пользователь без нужного entitlement. Бесплатные колоды доступны, платные заблокированы.
3. **Owner** — авторизованный пользователь с активным entitlement. Соответствующая колода доступна.

Покупка требует входа в backend-аккаунт. Допустим Sign in with Apple или Google. Apple Account, которым пользователь подтверждает оплату в App Store, не обязан совпадать по email со способом входа в Country Flags.

Причина обязательного входа: покупка должна получить стабильный `appAccountToken`, восстановиться на другом устройстве и позднее открыться на Android/Web через тот же backend entitlement.

### 2.3 Семейный доступ

Family Sharing в первом релизе **не включается**.

Это отдельное последующее решение, потому что:

- после включения Family Sharing для IAP его нельзя выключить;
- появляются `familyShared` transactions и отдельные revocation-сценарии;
- нужно определить, к какому Country Flags аккаунту привязывать entitlement члена семьи.

Модель данных сохраняет `ownershipType`, поэтому поддержку можно добавить без изменения transaction ledger.

### 2.4 Правила владения

- Активный owner сохраняет доступ, если товар снят с продажи.
- Изменение цены не влияет на существующих владельцев.
- Добавление или замена карточек внутри той же колоды входит в уже купленный доступ.
- Выключенный storefront/feature flag не блокирует уже купленную колоду.
- Refund или Apple revocation прекращает создание новых учебных сессий после получения события.
- Уже начатая учебная сессия не прерывается посередине.
- Прогресс по купленной колоде не удаляется после refund; он снова отображается при восстановлении entitlement.
- Paid deck нельзя физически удалить, пока существуют покупки. Его можно снять с продажи и скрыть от новых пользователей, сохранив доступ владельцам.

### 2.5 Изменение access policy

- Опубликованную бесплатную колоду нельзя молча перевести в платную: это отнимет существующий доступ. Требуется новая колода с новым `code` либо отдельная утверждённая migration/grandfathering policy.
- Платную колоду можно сделать бесплатной, но админка должна показать необратимое предупреждение; предыдущие покупки не возвращаются автоматически.
- `requiredEntitlementKey` опубликованной платной колоды нельзя заменить без entitlement migration.
- Состав grants уже продававшегося Apple product нельзя уменьшать. Для другого набора прав создаётся новый offer/product ID.

## 3. Термины

| Термин | Значение |
| --- | --- |
| Deck | Опубликованная учебная колода |
| Entitlement | Стабильное право доступа, например `entitlement.european_coats` |
| Offer | Внутреннее коммерческое предложение, выдающее один или несколько entitlements |
| Store product | Товар конкретного магазина, например Apple product ID |
| Transaction | Подписанный Apple факт покупки/refund/revocation |
| Grant | Один источник активного или отозванного entitlement пользователя |
| Owner | Пользователь, у которого существует хотя бы один активный grant нужного entitlement |

Deck не равен Store product. Это ключевая граница:

~~~text
Apple product ──► Commerce offer ──► Entitlement(s) ──► Deck access
Google product ─┘
Web purchase ───┘
~~~

Так одна колода может продаваться отдельно и внутри bundle, а один backend entitlement позднее может выдаваться Apple, Google Play или Web provider-ом.

### 3.1 Неймспейс entitlement keys

Entitlement key живёт в собственном неймспейсе `entitlement.*` и никогда не
переиспользует редакционный `deck.*`:

~~~text
editorial deck key:  deck.european_coats
deck code в API:     EUROPEAN_COATS
entitlement key:     entitlement.european_coats
offer code:          EUROPEAN_COATS_LIFETIME
~~~

Причины две. Первая — ADR-019 делает entitlement самостоятельной бизнес-границей,
которая MAY пережить колоду, покрыть несколько колод или выдаваться другим
провайдером; имя, начинающееся с `deck.`, обещает обратное. Вторая —
практическая: пока entitlement назывался `deck.europe_coats` при колоде
`deck.european_coats`, две почти одинаковые строки различались одной буквой, а
у `U.S. State Flags` совпадали полностью. Разные неймспейсы делают такую путаницу
невозможной и на review, и в миграции.

## 4. Как проходит оплата через Apple

### 4.1 До разработки

В App Store Connect необходимо:

1. Принять актуальный Paid Apps Agreement.
2. Заполнить banking и tax information.
3. Создать отдельный Non-Consumable IAP для каждого продаваемого offer.
4. Задать неизменяемый product ID.
5. Добавить RU/EN display name и description.
6. Выбрать цену и storefront availability.
7. Добавить App Review screenshot и review notes.
8. Настроить production и sandbox URLs App Store Server Notifications V2.
9. Отправить IAP на review; первый IAP отправляется вместе с новой версией приложения.

Пример идентификаторов:

~~~text
offer code:          EUROPEAN_COATS_LIFETIME
entitlement key:     entitlement.european_coats
production product:  app.countryflags.deck.european_coats.lifetime.v1
dev product:         app.countryflags.dev.deck.european_coats.lifetime.v1
~~~

Product ID и purchase type после сохранения не редактируются и не переиспользуются. Цена меняется через price schedule без создания нового entitlement.

### 4.2 Что видит пользователь

1. Приложение получает offer и Apple product ID с backend.
2. `StoreKit.Product.products(for:)` загружает продукт.
3. Название, локализованная цена и валюта берутся из StoreKit.
4. По нажатию «Купить» StoreKit показывает системный Apple payment sheet.
5. Пользователь подтверждает оплату Face ID/Touch ID/паролем Apple Account.
6. Приложение получает `PurchaseResult` и подписанную transaction.
7. Verified transaction немедленно открывает колоду локально и отправляется backend для серверной проверки и account entitlement.

Приложение и backend никогда не получают номер карты или другой payment instrument. В UI нельзя собирать или имитировать собственную платёжную форму.

### 4.3 Цена и выплаты

- Цена задаётся только в App Store Connect.
- iOS показывает только `Product.displayPrice`; backend/admin не формируют цену строкой и не конвертируют валюту.
- Apple рассчитывает цены по storefront, валюте и налогам.
- Developer proceeds равны customer price за вычетом применимых налогов и комиссии Apple.
- Если аккаунт соответствует App Store Small Business Program, текущая программа предусматривает комиссию 15%; eligibility и реальные proceeds проверяются в актуальном agreement/App Store Connect, а не кодируются в продукте.

## 5. Целевая архитектура

~~~mermaid
sequenceDiagram
    participant U as User
    participant IOS as iOS + StoreKit 2
    participant API as NestJS API
    participant DB as PostgreSQL
    participant APPLE as Apple App Store

    U->>IOS: Открывает платную колоду
    IOS->>API: GET offers + entitlements
    IOS->>APPLE: Product.products(productIds)
    APPLE-->>IOS: Localized product + price
    U->>IOS: Купить
    IOS->>APPLE: purchase(appAccountToken)
    APPLE-->>IOS: Verified signed transaction
    IOS->>IOS: Durable purchase outbox + local unlock
    IOS->>API: POST signed transaction
    API->>API: Verify JWS, bundle, environment, product, token
    API->>DB: Idempotent transaction + entitlement grant
    API-->>IOS: Current entitlements
    IOS->>APPLE: transaction.finish()
~~~

Отдельный server-to-server поток:

~~~mermaid
sequenceDiagram
    participant APPLE as Apple
    participant API as Notification endpoint
    participant DB as PostgreSQL
    participant JOB as Reconciliation job

    APPLE->>API: App Store Server Notification V2
    API->>API: Verify signedPayload
    API->>DB: Idempotent notification + transaction state
    API->>DB: Grant / revoke / reinstate entitlement
    JOB->>APPLE: Transaction/refund/notification history
    JOB->>DB: Repair missed or stale state
~~~

## 6. Модель данных backend

### 6.1 Изменение существующих моделей

`User` (`backend/prisma/schema.prisma:288`) получает:

- `storeAccountToken UUID UNIQUE NOT NULL DEFAULT uuid()`;
- relations к store transactions и entitlement grants.

`Deck` (`backend/prisma/schema.prisma:795`) получает:

- `accessModel: FREE | ENTITLEMENT`, default `FREE`;
- `requiredEntitlementKey String?`;
- relation к `EntitlementDefinition`.

Инварианты:

- `FREE` → `requiredEntitlementKey IS NULL`;
- `ENTITLEMENT` → `requiredEntitlementKey IS NOT NULL`;
- access policy входит в content release и меняется только через draft/publisher;
- entitlement key стабилен и не зависит от `contentVersion`.

### 6.2 Новые модели

#### `EntitlementDefinition`

- `key String @id`;
- `status: ACTIVE | RETIRED`;
- `description` — внутреннее описание;
- timestamps.

Ключ не локализуется и после первой публикации не переименовывается.

#### `CommerceOffer`

- `id UUID`;
- `code String UNIQUE`;
- `kind: ONE_TIME`;
- `status: DRAFT | ACTIVE | RETIRED`;
- `sortOrder`;
- optional internal notes;
- timestamps.

#### `CommerceOfferLocalization`

- `offerId`;
- `locale`;
- `title`;
- `description`;
- primary key `(offerId, locale)`.

Текст служит для fallback UI и админки. Customer-facing Apple title/description всё равно проходят App Store review; iOS использует StoreKit metadata, когда продукт доступен.

#### `CommerceOfferGrant`

- `offerId`;
- `entitlementKey`;
- primary key `(offerId, entitlementKey)`.

После первой подтверждённой продажи grants MAY расширяться только отдельной audited migration; уменьшение запрещено.

#### `StoreProduct`

- `id UUID`;
- `offerId`;
- `provider: APPLE_APP_STORE | GOOGLE_PLAY | WEB`;
- `storeEnvironment: LOCAL_TEST | SANDBOX | PRODUCTION`;
- `bundleId`;
- `productId`;
- `productType: NON_CONSUMABLE`;
- `status: DRAFT | VALIDATED | ACTIVE | RETIRED | INVALID`;
- `storeStatus String?` — opaque status последнего App Store Connect sync;
- `lastValidatedAt`, `validationError`;
- timestamps;
- unique `(provider, storeEnvironment, bundleId, productId)`.

Цена не хранится как authorization source. Допустим short-lived diagnostic cache цены, но он не участвует в покупке, выдаче доступа или пользовательском display.

#### `StoreTransaction`

- `id UUID`;
- `provider`;
- `storeEnvironment`;
- `transactionId`;
- `originalTransactionId`;
- `productId`;
- `storeAccountToken UUID?`;
- `userId UUID?`;
- `ownershipType: PURCHASED | FAMILY_SHARED | UNKNOWN`;
- `purchasedAt`;
- `revokedAt`, `revocationReason`;
- `signedPayloadHash`;
- `verifiedAt`;
- `claimState: CLAIMED | RELEASED_BY_ACCOUNT_DELETION | CONFLICT | QUARANTINED`;
- timestamps;
- unique `(provider, storeEnvironment, transactionId)`.

Полный JWS нельзя писать в application logs. Если raw signed payload нужен для расследования, он хранится encrypted и удаляется по отдельной retention policy; нормализованные transaction identifiers сохраняются для idempotency, restore и anti-fraud.

#### `UserEntitlementGrant`

- `id UUID`;
- `userId`;
- `entitlementKey`;
- `sourceType: STORE_TRANSACTION | SUPPORT_OVERRIDE | MIGRATION`;
- `sourceTransactionId UUID?`;
- `status: ACTIVE | REVOKED`;
- `grantedAt`, `revokedAt`, `revocationReason`;
- timestamps;
- unique `(userId, entitlementKey, sourceType, sourceTransactionId)`.

Доступ активен, если существует хотя бы один ACTIVE grant. Refund одного product не закрывает entitlement, если тот же entitlement выдан другим активным product/bundle.

`SUPPORT_OVERRIDE` зарезервирован, но ручная выдача доступа через админку не входит в MVP. Для промо используются Apple offer codes либо отдельная утверждённая migration.

#### `StoreNotification`

- `notificationUuid` как unique idempotency key;
- provider/environment/type/subtype;
- signed date;
- payload hash;
- processing status/error;
- received/processed timestamps.

#### `StoreReconciliationState`

- provider/environment/scope key;
- last revision/cursor;
- last successful reconciliation;
- last error;
- timestamps.

## 7. Контракты API

Consumer API остаётся в `contracts/openapi.yaml`; admin commerce endpoints — в `contracts/admin-openapi.yaml`, сохраняя существующую изоляцию (`contracts/admin-openapi.yaml:1`).

### 7.1 Consumer endpoints

#### `GET /v1/commerce/offers?platform=IOS`

Возвращает активные предложения:

~~~json
{
  "items": [
    {
      "code": "EUROPEAN_COATS_LIFETIME",
      "kind": "ONE_TIME",
      "storeProduct": {
        "provider": "APPLE_APP_STORE",
        "productId": "app.countryflags.deck.european_coats.lifetime.v1"
      },
      "grants": ["entitlement.european_coats"]
    }
  ]
}
~~~

Цена отсутствует: её возвращает StoreKit.

#### `GET /v1/me/entitlements`

Требует auth. Возвращает текущие entitlement keys, revision/ETag и время серверной проверки.

#### `POST /v1/me/commerce/apple/transactions`

Требует auth и `Idempotency-Key`. Принимает batch verified JWS transactions для purchase, transaction listener и restore. Максимум — 100 элементов и ограниченный body size.

Backend MUST:

1. проверить JWS через Apple root certificates;
2. проверить `bundleId` и `appAppleId` для production;
3. проверить sandbox/production environment;
4. найти известный StoreProduct;
5. проверить NON_CONSUMABLE type;
6. сравнить `appAccountToken` с `User.storeAccountToken` при первой claim;
7. применить transaction идемпотентно;
8. выдать/revoke соответствующие grants;
9. вернуть полный актуальный entitlement snapshot.

Нельзя доверять `deckId`, `offerCode`, цене, валюте или entitlement keys из client request. Источник grants — только серверный StoreProduct → Offer mapping.

#### `POST /v1/commerce/apple/notifications`

Публичный endpoint без consumer auth. Принимает App Store Server Notification V2 `signedPayload`.

- exact body limit;
- JWS verification до обработки;
- idempotency по `notificationUUID`;
- prod принимает только production payload нужного bundle/app Apple ID;
- dev принимает только sandbox payload dev app;
- неизвестный product/transaction помещается в quarantine и создаёт alert;
- endpoint отвечает быстро, повторяемая бизнес-обработка выполняется безопасно.

Обязательные события первой версии:

- `ONE_TIME_CHARGE` — покупка non-consumable; именно этот `notificationType`
  Apple присылает для разовой покупки, отдельного `PURCHASE` не существует;
- `REFUND` → revoke соответствующего grant;
- `REFUND_REVERSED` → reinstate grant;
- `REVOKE` сохраняется и поддерживается моделью, хотя Family Sharing выключен;
- `TEST` — проверочное уведомление.

Обработчик MUST игнорировать неизвестный `notificationType`, сохраняя его в
`StoreNotification`, а не падать: Apple добавляет типы без версионирования
endpoint-а.

### 7.2 Изменение Deck DTO

К существующему `Deck` (`contracts/openapi/components.yaml:960`) добавляется объект:

~~~json
{
  "access": {
    "model": "FREE | ENTITLEMENT",
    "requiredEntitlementKey": "entitlement.european_coats",
    "offerCodes": ["EUROPEAN_COATS_LIFETIME"]
  }
}
~~~

Для `FREE` key и offers отсутствуют.

Поле добавляется additive и остаётся optional в схеме, как требуют ADR-009 и
документ 18 §7.3: обязательным его делает не OpenAPI, а поведение клиента.
Отсутствие `access` клиент читает как `FREE`, поэтому старый клиент, который
поля не знает, ведёт себя ровно как сегодня. Это не открывает платный контент:
locked-колода закрыта серверным guard-ом, а не наличием поля, и до первого
платного релиза действует `minimumClientVersion` gate из §20.

### 7.3 Доступ к карточкам и обучению

- `GET /v1/decks` и deck metadata доступны всем: locked deck должен быть виден для discovery.
- `GET /v1/decks/{deckId}` возвращает metadata, access policy и card count.
- `GET /v1/decks/{deckId}/cards` для paid deck требует authenticated active entitlement.
- Backend возвращает `403 ENTITLEMENT_REQUIRED` с `deckId` и `offerCodes`, но без цены.
- Некорректный/просроченный bearer token по-прежнему даёт `401`.
- Уже существующая active session MAY быть завершена после revocation.
- Review/progress sync не отклоняется только из-за текущего отсутствия entitlement: право доступа и право сохранить собственный прогресс — разные вещи.

Весь enforcement централизуется в `DeckAccessService`; разрозненные `if paid` в controllers запрещены. Сейчас content cards читаются без account context (`backend/src/modules/content/content.service.ts:312`), а новая server session проверяет только существование published deck (`backend/src/modules/study-sessions/study-sessions.service.ts:164`) — обе точки MUST использовать общий guard.

#### Публичная projection `GeoEntity` не раскрывает paid-only assets

Каноническая `GeoEntity` внутри backend и admin содержит все связанные assets,
включая флаг и герб одной страны. Consumer `GET /v1/entities/{entityId}` не
является сериализацией этой внутренней модели. Это стабильная публичная
projection без account context, чтобы её можно было безопасно кешировать и не
допустить смешивания ответов разных пользователей.

В public entity projection входят:

- имена и общие географические facts, уже доступные в бесплатном продукте;
- asset, на который ссылается хотя бы одна активная карточка опубликованной
  `FREE`-колоды;
- явно опубликованный public preview платной колоды. Выбор preview означает, что
  соответствующее изображение и его preview metadata сознательно становятся
  публичными.

В public entity projection не входят:

- asset, встречающийся только в entitlement-колодах и не выбранный preview;
- его representations, URL, localized description/attribution payload и
  связанные editorial details;
- полный состав, порядок и карточные данные платной колоды.

Если один asset одновременно используется в бесплатной и платной колоде, он
считается публичным для всего content release. Admin publication validation MUST
показать это как явное предупреждение, чтобы редактор не сделал платный asset
публичным случайно.

Paid-only asset возвращается только внутри успешного
`GET /v1/decks/{deckId}/cards` после `DeckAccessService`. Его representation
содержит `delivery = SIGNED`, короткоживущий signed download URL и `expiresAt`;
клиент скачивает файл и сохраняет его в account-scoped offline cache, используя
checksum, а не URL как identity. Public/free/preview assets
продолжают использовать стабильный public CDN URL. Private object key или
unsigned bucket URL никогда не возвращается consumer API.

TTL signed URL по умолчанию равен 300 секундам и настраивается сервером в
диапазоне 60...900 секунд. Guarded cards response использует
`Cache-Control: private, no-store` и `Vary: Authorization`; его нельзя помещать
в shared CDN cache. Истечение URL не удаляет уже скачанные bytes из разрешённого
account-scoped offline cache.

Для реализации вводится единая `ContentAccessProjectionService`, которую
используют entity mapping, deck-card mapping, public preview, publisher
validation и bundle generation. Повторять правила доступности в controllers
запрещено.

#### Глобальный change feed остаётся публичным

`GET /v1/content/changes` не зависит от авторизации и содержит только изменения
публичной projection плюс безопасные изменения metadata колод. Он не сообщает
paid-only asset/card payload и не заставляет клиента повторно получать entity
из-за изменения, невидимого в её public projection.

`Deck` получает монотонный `contentRevision`. Изменение состава, карточки или
paid-only asset увеличивает revision и создаёт безопасный `DECK` upsert. Клиент:

- обновляет metadata locked-колоды, но не запрашивает её cards;
- при активном entitlement и новой `contentRevision` повторно получает guarded
  deck cards и обновляет account-scoped cache;
- после покупки выполняет тот же targeted fetch, не перезапуская общий
  bootstrap.

Auth-aware варианты общего Entity API и глобального change feed в MVP
запрещены: они усложняют CDN/ETag caching и создают риск вернуть владельческий
ответ другому пользователю.

#### Создание сессии зависит от origin

`POST /v1/study-sessions` обслуживает два разных случая: серверную выдачу новой
сессии и идемпотентный импорт сессии, собранной клиентом офлайн
(`contracts/openapi.yaml:761`, [ADR-010](./adr/ADR-010-offline-study-session-import.md)).
Проверка entitlement различает их:

- `origin = SERVER` — новая сессия создаётся только при активном entitlement,
  иначе `403 ENTITLEMENT_REQUIRED`;
- `origin = CLIENT_OFFLINE` — импорт принимается и без активного entitlement,
  если сессия уже собрана клиентом.

Иначе refund уничтожал бы повторы, которые пользователь честно сделал, пока
владел колодой, и §2.4 «прогресс не удаляется после refund» противоречил бы сам
себе. Импорт при этом ничего не открывает: он не выдаёт entitlement, не
возвращает состав колоды и не разрешает создать следующую сессию. Существующие
проверки ADR-010 — только `SELF_RATED`, только карточки, не ставшие `RETIRED` —
работают без изменений.

#### Один `403` не ломает content sync

Клиент синхронизирует каталог постадийно и на стадии `cards` запрашивает
карточки каждой колоды манифеста
(`ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Content/ContentBootstrapCoordinator.swift:267`).
Платная колода вернёт `403`, поэтому контракт фиксирует: `403` по одной колоде
означает пропуск этой колоды, а не отказ синхронизации. Подробности со стороны
клиента — в §10.2.

### 7.4 Entitlement sync

Не расширять существующий `UserChangeResourceType` в первой итерации: сейчас поток и iOS mapper жёстко моделируют только `CARD_STATE` (`backend/prisma/schema.prisma:278`, `ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/API/UserChangesService.swift:45`).

iOS обновляет `/v1/me/entitlements`:

- после login;
- при launch/foreground;
- после purchase/restore;
- после StoreKit `Transaction.updates`;
- после ошибки `ENTITLEMENT_REQUIRED`.

Endpoint поддерживает ETag, поэтому обычная foreground-проверка дешева. Позднее entitlement MAY стать отдельным versioned account stream.

### 7.5 Admin endpoints

Добавить в `contracts/admin-openapi.yaml`:

~~~text
GET    /v1/admin/commerce/status
GET    /v1/admin/commerce/entitlements
POST   /v1/admin/commerce/entitlements
GET    /v1/admin/commerce/offers
POST   /v1/admin/commerce/offers
GET    /v1/admin/commerce/offers/{offerId}
PATCH  /v1/admin/commerce/offers/{offerId}
POST   /v1/admin/commerce/offers/{offerId}/products
PATCH  /v1/admin/commerce/products/{productId}
POST   /v1/admin/commerce/store-sync-runs
GET    /v1/admin/commerce/store-sync-runs/{runId}
GET    /v1/admin/commerce/transactions/{transactionId}
POST   /v1/admin/commerce/transactions/{transactionId}/reconcile
~~~

Права:

- `VIEWER`: просмотр offers/status;
- `EDITOR`: настройка draft access policy и DRAFT offers;
- `PUBLISHER`: activation/retirement offers и публикация paid deck;
- `ADMIN`: store sync/reconciliation и чувствительные transaction diagnostics.

Transaction IDs в UI маскируются; raw JWS не показывается.

## 8. Apple transaction verification

NestJS использует официальный пакет Apple `@apple/app-store-server-library` через собственную узкую boundary.

~~~text
backend/src/modules/commerce/
├── commerce.module.ts
├── commerce.controller.ts
├── entitlement.service.ts
├── deck-access.service.ts
├── apple/
│   ├── apple-transaction-verifier.ts
│   ├── apple-notification.controller.ts
│   ├── apple-notification.service.ts
│   ├── apple-server-api.client.ts
│   └── apple-reconciliation.service.ts
└── admin/
    ├── admin-commerce.controller.ts
    └── admin-commerce.service.ts
~~~

Требования:

- pin exact reviewed package version;
- production verification использует Apple root certificates, exact bundle ID и app Apple ID;
- private In-App Purchase key хранится в GCP Secret Manager;
- HTTP notification verifier не требует private key;
- App Store Server API key используется только reconciliation/store-sync job;
- ключ и полный JWS не логируются;
- verification errors имеют стабильные internal codes;
- повторная transaction/notification безопасна;
- conflicting claim никогда не переносит покупку между двумя активными аккаунтами автоматически.

## 9. iOS-архитектура StoreKit

StoreKit импортируется только в Infrastructure. Domain и Feature UI работают через protocols.

### 9.1 Новые domain interfaces

~~~swift
public protocol StoreProductLoading: Sendable {
    func products(for identifiers: Set<String>) async throws -> [StoreProductSnapshot]
}

public protocol Purchasing: Sendable {
    func purchase(productID: String, appAccountToken: UUID) async -> PurchaseOutcome
    func currentEntitlements() async -> [VerifiedStoreTransaction]
    func restore() async throws
}

public protocol EntitlementRepository: Sendable {
    func snapshot(scope: AccountScope) async throws -> EntitlementSnapshot
    func replace(_ snapshot: EntitlementSnapshot, scope: AccountScope) async throws
}
~~~

Реализация:

- `StoreKitPurchaseClient` — StoreKit 2 adapter;
- `PurchaseCoordinator` actor — single-flight purchase/restore и transaction listener;
- `CommerceService` — consumer API;
- `SwiftDataEntitlementRepository`;
- durable `PurchaseDeliveryOutbox` для transaction JWS, ожидающих backend sync;
- mock/no-op implementations для previews, unit tests и configurations без StoreKit.

### 9.2 SwiftData migration

Текущая production schema — `LocalSchemaV5` (`ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Persistence/SchemaV5.swift:19`). Добавляется `LocalSchemaV6`:

- `StoredDeck` получает `accessModel`, `requiredEntitlementKey`, `offerCodes`;
- `StoredEntitlement` — account-scoped snapshot;
- `StoredPurchaseDelivery` — encrypted/durable pending JWS delivery;
- `StoredCommerceOffer` — product IDs и fallback copy;
- migration MUST сохранять review outbox и active sessions.

Existing decks мигрируют как `FREE`. Нельзя лечить migration failure удалением store (`ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Persistence/LocalStore.swift:94`).

### 9.3 Purchase lifecycle

1. При старте приложения запускается listener `Transaction.updates`.
2. Product metadata загружается лениво для видимых paid offers и кэшируется только как presentation data.
3. Guest, нажавший «Купить», сначала проходит обычный account login.
4. Purchase вызывается с `.appAccountToken(user.storeAccountToken)`.
5. Обрабатываются outcomes:
   - `success + verified` — durable local delivery, unlock, backend sync;
   - `success + unverified` — не открывать, показать безопасную ошибку/support ID;
   - `pending` — оставить locked и показать «Ожидает подтверждения»;
   - `userCancelled` — закрыть sheet без error alert;
   - network/store unavailable — оставить возможность retry/restore.
6. Verified transaction finish выполняется после durable local record и выдачи локального доступа; backend delivery повторяется до подтверждения.
7. После backend response локальный entitlement snapshot заменяется атомарно.

### 9.4 Restore purchases

- В Account/Settings присутствует явная кнопка «Восстановить покупки».
- Только по нажатию пользователя вызывается `AppStore.sync()`, потому что он MAY показать системную авторизацию.
- После sync приложение читает `Transaction.currentEntitlements`, отправляет verified JWS batch в backend и обновляет snapshot.
- Обычный launch не вызывает принудительный `AppStore.sync()`: StoreKit и так предоставляет current entitlements.
- Restore без покупок завершается нейтральным результатом, не ошибкой.

## 10. Правила блокировки контента

Каноническая проверка:

~~~text
access = FREE
OR
exists ACTIVE UserEntitlementGrant(requiredEntitlementKey)
~~~

Feature flag не может подменить эту проверку.

Rollout управляется флагами `commerce.paid_decks.discovery.enabled` и
`commerce.apple_iap.enabled`, оба по умолчанию `false`. Полный список флагов и
их зоны ответственности — в документе 18 §12; имена следуют существующей
конвенции проекта (`study.review_submission.enabled`, `ads.enabled`).

- `commerce.paid_decks.discovery.enabled` управляет показом платных колод в
  каталоге;
- `commerce.apple_iap.enabled` управляет показом кнопки покупки;
- ни один флаг не выдаёт и не отзывает entitlement;
- при `false` владельцы продолжают пользоваться купленными колодами;
- non-owner видит «Покупка временно недоступна»;
- backend access guard работает независимо от флагов.

### 10.1 Что скачивает бесплатный пользователь

- metadata всех listed decks;
- названия, description, card count, access policy;
- небольшой cover/fan и preview representations, если они явно опубликованы как
  public preview;
- не получает полный `/cards` payload платной колоды.

Если одна LearningCard одновременно входит в бесплатную и платную колоду, доступ через бесплатную колоду разрешён. Платность защищает колоду/подборку и её study flow, а не объявляет общий флаг секретным.

`GET /v1/entities/{entityId}` и `GET /v1/content/changes` также не раскрывают
paid-only assets. Общие факты страны могут оставаться публичными, но metadata,
описание и representations закрытого герба фильтруются вместе с самим asset.

После revocation приложение MUST скрыть paid deck content и запретить новую сессию. Best-effort cleanup удаляет локальные memberships и assets, которые больше не нужны ни одной бесплатной/доступной колоде. Это access control, а не DRM против модифицированного или jailbroken клиента.

### 10.2 Как это ложится на текущий bootstrap клиента

Клиент сейчас проходит стадии `decks` → `cards` → `ready` и на стадии `cards`
запрашивает карточки каждой колоды из манифеста
(`ios/CountryFlagsKit/Sources/CountryFlagsInfrastructure/Content/ContentBootstrapCoordinator.swift:267`).
Ответ `403 ENTITLEMENT_REQUIRED` по платной колоде оборвал бы bootstrap целиком,
и гость остался бы вообще без каталога. Поэтому:

- стадия `cards` MUST пропускать колоду с `access.model = ENTITLEMENT` без
  активного entitlement, помечая её локально как `awaiting-entitlement`;
- `403` по одной колоде не переводит sync в failed state и не показывает
  пользователю ошибку: метаданные такой колоды уже получены на стадии `decks`;
- после purchase/restore клиент догружает карточки только этих колод, не
  повторяя полный bootstrap;
- загрузка получает signed URLs только из guarded cards response, немедленно
  скачивает нужные representations и не сохраняет URL как долговечный идентификатор;
- после revocation колода возвращается в `awaiting-entitlement`, а её локальные
  memberships и assets убираются best-effort по §10.1;
- смена аккаунта и logout переоценивают набор `awaiting-entitlement` колод.

`awaiting-entitlement` — состояние загрузки, а не ошибки. Каталог, поиск и
прогресс по бесплатным колодам обязаны работать, пока платные колоды в этом
состоянии.

### 10.3 Платный контент не попадает в бандл приложения

[ADR-011](./adr/ADR-011-bundled-flag-baseline.md) зашивает изображения одного
контентного релиза внутрь приложения, а `ios/Scripts/sync-flag-assets.mjs`
копирует ассеты релиза в `Flags.xcassets` без фильтра по колоде. Без изменения
скрипта гербы Европы и флаги штатов уехали бы в IPA каждого пользователя, и
платный контент лежал бы на устройстве до покупки.

Поэтому:

- bundled baseline ограничивается ассетами карточек, входящих хотя бы в одну
  колоду с `access.model = FREE`;
- `--check` в CI падает, если в бандл попал ассет, встречающийся только в
  платных колодах;
- ассеты платной колоды скачиваются после entitlement обычным asset flow, и
  ADR-011 продолжает работать для бесплатного каталога без изменений;
- paid-only original/representations публикуются в private storage namespace;
  public CDN содержит только free и явно выбранные preview representations;
- бандл не является границей безопасности: ограничение убирает платный контент
  из бинарника, который раздаётся бесплатно, а не защищает его от
  модифицированного клиента.

## 11. Пользовательский интерфейс iOS

### 11.1 Catalog row

~~~text
┌──────────────────────────────────────────┐
│  [гербы/флаги]  Гербы Европы        🔒  │
│                 52 карточки              │
│                 Разовая покупка · 249 ₽  │
└──────────────────────────────────────────┘
~~~

- Lock visible до открытия detail.
- Цена показывается только после ответа StoreKit.
- Пока StoreKit загружается: «Цена загружается», без fake price.
- Если product недоступен: «Покупка временно недоступна».

### 11.2 Locked deck detail / paywall

~~~text
Гербы Европы                         🔒

[cover / 3 preview images]
52 карточки · гербы и флаги

Разовая покупка. Доступ остаётся навсегда.

[ Купить за 249 ₽ ]
[ Восстановить покупки ]

Уже купили на другом устройстве? Войдите в тот же
аккаунт Country Flags и восстановите покупку.
~~~

Полный список карточек не показывается до entitlement. Допустим небольшой явно опубликованный preview, не использующий закрытый cards endpoint.

### 11.3 После покупки

- Lock исчезает без перезапуска экрана.
- Начинается загрузка cards/assets.
- После загрузки появляется существующая кнопка «Начать».
- Ошибка backend sync не отнимает локально verified покупку; показывается ненавязчивый sync state, outbox повторяет доставку.

### 11.4 Pending/refund

- Ask to Buy/pending: «Покупка ожидает подтверждения»; повторный тап не создаёт параллельную purchase.
- Refund/revocation: при следующем entitlement refresh новая сессия блокируется; progress сохраняется.
- Если active session уже открыта, пользователь может её закончить.

### 11.5 Точки изменения текущего UI

- `DeckRecord` сейчас не несёт access policy (`ios/CountryFlagsKit/Sources/CountryFlagsDomain/Persistence/ContentRecords.swift:186`).
- `CatalogView` всегда открывает deck row (`ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Content/CatalogView.swift:95`) — должен открыть locked detail/paywall.
- `DeckDetailsView` всегда предлагает existing Start action при наличии карточек (`ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Content/DeckDetailsView.swift:145`) — action заменяется purchase/restore состоянием без entitlement.
- Routing/composition добавляют commerce dependencies рядом с deck destination (`ios/CountryFlagsKit/Sources/CountryFlagsFeatures/RootView.swift:387`).

## 12. Админка

### 12.1 Deck editor: новый блок Access

~~~text
Access
(•) Free
( ) Paid / entitlement required

Entitlement key:  [ entitlement.european_coats          ]
Offers:           [ EUROPEAN_COATS_LIFETIME   ✓ ]
Preview:          [ cover + 3 samples          ]

Validation
✓ entitlement exists
✓ active Apple non-consumable grants this entitlement
✓ product verified in current environment
~~~

Для опубликованного paid deck entitlement key read-only. Изменение выполняется отдельной migration operation.

### 12.2 Commerce section

Добавить разделы:

- **Entitlements** — stable keys и связанные decks;
- **Offers** — one-time offers, grants и lifecycle;
- **Store products** — Apple product ID, bundle, environment, type, store readiness;
- **Transactions** — только support diagnostics с masked IDs;
- **Store sync runs** — статус App Store Connect sync/reconciliation.

Пример Offer detail:

~~~text
EUROPEAN_COATS_LIFETIME          ACTIVE

Type:        One-time purchase
Grants:      entitlement.european_coats
Apple:       app.countryflags.deck.european_coats.lifetime.v1
Store type:  Non-consumable
Store state: Validated / Ready
Last sync:   2026-09-04 12:20 UTC

[Open in App Store Connect] [Re-check] [Remove from sale]
~~~

Цена read-only и MAY отображаться как diagnostic store metadata; она не редактируется и не обещается пользователю из backend.

### 12.3 Publication validation

Paid content draft не получает READY, если:

- entitlement отсутствует/retired;
- entitlement key отличается от уже опубликованного без migration;
- нет ACTIVE offer, выдающего entitlement;
- для iOS offer не имеет VALIDATED non-consumable Apple product текущего environment;
- grants продававшегося offer уменьшены;
- published free deck переводится в paid без explicit migration;
- paid deck удаляется/retire без owner-access plan.

Release diff показывает отдельно:

- free → paid / paid → free;
- entitlement changes;
- offer/product/grant changes;
- paid deck membership/content changes.

Все mutation/activation/reconciliation действия используют существующий `AdminAuditEvent` (`backend/prisma/schema.prisma:1300`).

### 12.4 App Store Connect остаётся источником store metadata

Первая версия админки не создаёт IAP и не меняет цену внутри Apple автоматически.

- Оператор создаёт/редактирует IAP в App Store Connect.
- Админка хранит mapping и запускает read-only sync/check.
- App Store Connect API key хранится в Secret Manager и используется отдельным job, не browser и не admin SPA.
- Product ID/type считаются immutable после activation.
- Позднее MAY быть добавлено provisioning через App Store Connect API после отдельного permission review.

## 13. Multi-content prerequisite: гербы и subdivisions

Backend enum уже содержит `COAT_OF_ARMS` (`backend/prisma/schema.prisma:149`), а admin upload form его предлагает (`admin/src/resources/drafts/DraftAssets.tsx:22`). Однако текущий editorial schema допускает только `assetType: "flag"` (`contracts/schemas/content/editorial-catalog.v2.schema.json:272`), pipeline type тоже только `flag` (`tools/content-pipeline/src/types.ts:127`), а proposal publisher отклоняет любой другой тип (`backend/src/modules/admin-drafts/draft-proposal.service.ts:194`).

Полная модель и контракты утверждаются в
[18-multi-content-paid-decks.md](./18-multi-content-paid-decks.md) и
[ADR-020](./adr/ADR-020-geo-entities-and-card-variants.md). До публикации первой
новой paid deck MUST:

- поднять editorial catalog schema version;
- сделать asset override path зависимым от asset type, чтобы flag и coat не конфликтовали одним именем файла;
- расширить `AssetCandidate`/built asset key/type;
- добавить card template для coat-of-arms prompt;
- расширить bundle mapper/validator/publisher;
- добавить iOS rendering/selection для нового template;
- проверить progress semantics: флаг и герб одной страны — разные LearningCard, но общий country entity.
- добавить `SUBDIVISION` и administrative parent relation для штатов;
- заменить entity-only deck membership на
  `(entityKey, templateCode, templateSchemaVersion)`;
- расширить consumer/admin contracts и post-purchase list для новых templates;
- расширить gate совместимости шаблонов до пары `templateCode + schemaVersion`
  (документ 18 §7.3): сейчас клиент фильтрует карточки только по номеру версии
  и принял бы герб как поддерживаемую карточку;
- отфильтровать bundled asset baseline по access model колоды (§10.3), иначе
  платные изображения уедут в бинарник вместе с бесплатными.

Монетизация при этом остаётся deck-level и не зависит от типа карточки.

## 14. Dev, CI, Sandbox и Production

| Контур | Store | Bundle ID | Backend/DB | Транзакции |
| --- | --- | --- | --- | --- |
| local/CI | Xcode StoreKit config + test doubles | mock/dev | local/ephemeral | synthetic, не принимаются prod verifier |
| dev | Apple Sandbox, отдельная dev app record | `app.countryflags.mobile.dev` | api-dev / Neon dev | только Sandbox |
| prod | Apple Production | `app.countryflags.mobile` | api-prod / Neon prod | только Production |

Текущий Dev build уже имеет suffix `.dev`, а Prod — production bundle ID (`ios/Config/Dev.xcconfig:10`, `ios/Config/Prod.xcconfig:6`). Apple IAP не делится между разными app records, поэтому dev App Store Connect record должен иметь собственные sandbox products/mappings.

Обязательные ограничения:

- prod backend отклоняет Sandbox/Xcode transactions;
- dev backend отклоняет Production transactions;
- разные notification URLs и databases;
- product mappings не копируются из dev в prod без явного promotion/check;
- private IAP key и issuer/key IDs — разные secrets или строго scoped configuration;
- StoreKit local test verifier никогда не включается в production artifact/config;
- commerce feature flags по умолчанию false во всех средах до завершения rollout gate.

## 15. Refund, reconciliation и сбои

### 15.1 Refund/revocation

- Apple notification — основной быстрый путь.
- `REFUND` помечает transaction revoked и отзывает её grants.
- `REFUND_REVERSED` восстанавливает grants.
- `REVOKE` обрабатывается для будущего Family Sharing.
- Если у entitlement остаётся другой ACTIVE grant, доступ сохраняется.

### 15.2 Пропущенные уведомления

Scheduled reconciliation job:

- проверяет notification history;
- запрашивает transaction/refund history по известным transaction IDs;
- хранит Apple revision cursor;
- повторяет transient failures с bounded backoff;
- помещает неизвестные/конфликтные события в quarantine;
- создаёт alert, если lag превышает 15 минут для notifications или 24 часа для scheduled reconciliation.

Apple API позволяет восстанавливать историю пропущенных notifications; job MUST иметь runbook и тестовую notification проверку.

### 15.3 Account conflict

Одна Apple transaction не может автоматически открыть доступ двум активным Country Flags аккаунтам.

- Same transaction + same user → idempotent success.
- Same transaction + another active user → `409 PURCHASE_BOUND_TO_ANOTHER_ACCOUNT`, без раскрытия чужого account.
- Support получает masked transaction reference и request ID.
- Email Apple Account не сравнивается с Google/Apple login email приложения.

### 15.4 Account deletion

Non-consumable purchase принадлежит Apple Account и не «удаляется» вместе с Country Flags account.

При удалении аккаунта:

- progress/auth/devices удаляются по текущей policy;
- user entitlement links удаляются или pseudonymize;
- transaction ledger сохраняет минимальные identifiers, необходимые для финансовых обязанностей, refund, restore и anti-fraud;
- transaction claim получает `RELEASED_BY_ACCOUNT_DELETION` после завершения deletion;
- verified restore MAY привязать покупку к новому аккаунту только из этого состояния;
- если прежний аккаунт активен, автоматический transfer запрещён.

До production отдельно утверждается retention transaction ledger с бухгалтером/legal. Raw JWS default retention — не более 90 дней; normalized identifiers хранятся столько, сколько требуется для действующего entitlement и применимых финансовых обязательств.

## 16. Security

- Сервер является источником истины для account entitlement.
- iOS verified StoreKit transaction даёт immediate local UX, но не может выдать backend entitlement без независимой server verification.
- JWS, transaction IDs и appAccountToken не попадают в analytics/error logs.
- Логи используют masked ID и request ID.
- Notification endpoint имеет body/rate limits и cryptographic verification.
- Product/grant mapping не принимается от клиента.
- SQL unique constraints обеспечивают idempotency.
- Admin lifecycle mutations требуют `PUBLISHER`/`ADMIN` и audit.
- Store API private key хранится только в Secret Manager/job runtime.
- Feature flags не обходят entitlement.
- Price и client clock не участвуют в authorization.

## 17. Observability и аналитика

### 17.1 Essential operational metrics

- Apple notification accepted/rejected/duplicate;
- notification processing lag;
- transaction verification success/failure по reason code;
- unknown product и wrong environment;
- entitlement grant/revoke/reinstate;
- purchase delivery outbox age;
- reconciliation duration/lag/failures;
- cross-account conflicts;
- paid cards endpoint denials.

Alerts:

- invalid signature spike;
- notification lag > 15 минут;
- reconciliation не проходил > 24 часов;
- unknown active product > 0;
- purchase delivery failure rate > 5% за 15 минут;
- prod получил Sandbox transaction > 0.

### 17.2 Product analytics

Добавить типизированные события:

- `paywall.viewed`;
- `purchase.started`;
- `purchase.completed`;
- `purchase.pending`;
- `purchase.cancelled`;
- `purchase.failed` с bounded reason;
- `purchase.restore_completed`;
- `paid_deck.opened`.

Не отправлять transaction ID, appAccountToken, raw price/currency string или Apple Account data. Optional product analytics по-прежнему подчиняется consent; server transaction ledger — essential app functionality, а не analytics.

## 18. Privacy, Terms и App Store metadata

До релиза MUST обновить:

- `site/privacy.html` и `site/privacy.ru.html`;
- `site/terms.html` и `site/terms.ru.html`;
- `ios/StoreMetadata/en.md` и `ios/StoreMetadata/ru.md`;
- `ios/StoreMetadata/review-notes.md`;
- App Store Connect App Privacy answers.

Сейчас публичные тексты явно утверждают, что покупок нет (`site/terms.html:27`, `ios/StoreMetadata/en.md:38`), поэтому включать StoreKit без их изменения нельзя.

Privacy disclosure:

- приложение не собирает Payment Info, потому что payment instrument обрабатывает Apple и разработчику недоступен;
- backend собирает Purchase History, связанную с Country Flags account, для выдачи доступа, restore, support, refunds и anti-fraud;
- Purchase History не используется для tracking или third-party advertising;
- описываются retention и поведение account deletion.

Terms:

- разовая покупка открывает указанный контент без срока действия, пока продукт/аккаунт не нарушает правила и Apple не отозвала transaction;
- price/refund/payment обрабатываются Apple и регулируются App Store terms;
- снятие offer с продажи не отнимает доступ у владельцев;
- приложение может обновлять содержимое купленной колоды без уменьшения основного обещанного доступа.

### 18.1 Обязательный аккаунт и App Review

§2.2 требует входа в аккаунт Country Flags до покупки. Это допустимо, но
Guideline 5.1.1(v) требует, чтобы регистрация запрашивалась только там, где она
нужна функционально. Приложение остаётся полностью работоспособным как гость,
и вход требуется ровно в одной точке, поэтому `review-notes.md` MUST объяснить
это прямо:

- бесплатный каталог, обучение, прогресс и офлайн работают без аккаунта;
- аккаунт запрашивается только в момент покупки и восстановления;
- причина — покупка привязывается к `appAccountToken`, чтобы восстановиться на
  другом устройстве и позднее на других платформах;
- рецензенту даются тестовый аккаунт и sandbox-инструкция для покупки и
  restore.

Экран входа перед покупкой не должен выглядеть как обязательная регистрация
всего приложения: формулировка «Войти, чтобы купить» из DESIGN.md выбрана
именно поэтому.

## 19. StoreKit testing

### 19.1 Unit

- access resolver: free/locked/owned/multiple grants/revoked grant;
- purchase state machine: verified/unverified/pending/cancelled/failure;
- StoreProduct mapping;
- account token matching;
- idempotent transaction and notification handling;
- refund/reversed refund;
- feature flag никогда не выдаёт access;
- paid deck validation rules;
- free → paid protection;
- owner access после product retirement.

### 19.2 Xcode StoreKit Test

- successful non-consumable purchase;
- duplicate purchase;
- Ask to Buy/pending;
- interrupted transaction;
- unverified transaction;
- restore with and without purchases;
- refund/revocation simulation;
- app relaunch и transaction listener;
- offline backend во время successful purchase;
- SwiftData migration V5 → V6;
- bootstrap каталога у гостя проходит целиком, когда одна колода отвечает `403`;
- после покупки догружается только купленная колода, полный bootstrap не
  перезапускается;
- после revocation колода возвращается в `awaiting-entitlement`, а бесплатные
  колоды остаются доступны.

### 19.3 Apple Sandbox/TestFlight

- реальные App Store Connect metadata и localized price;
- transaction JWS проходит dev backend verification;
- sandbox server notification;
- refund и refund reversed;
- новый device restore;
- same Apple Account + same Country Flags account;
- conflicting Country Flags account;
- product removed from sale, owner retains access;
- wrong environment rejected.

### 19.4 Backend integration/e2e

1. Free user видит paid deck metadata.
2. Cards и session create возвращают entitlement error.
3. Verified transaction создаёт один ledger record и grants.
4. Повтор JWS не создаёт дубль.
5. Cards/session доступны.
6. Refund notification отнимает новый доступ, progress сохраняется.
7. Refund reversed восстанавливает доступ.
8. Existing active session завершается.
9. Paid deck content не попадает в unauthenticated bootstrap.
10. Admin не публикует paid deck без validated product mapping.
11. `CLIENT_OFFLINE` импорт сессии по колоде принимается после refund, а
    `SERVER` создание сессии по ней отклоняется.
12. `sync-flag-assets.mjs --check` падает, если в бандл попал ассет, входящий
    только в платные колоды.
13. Германия с бесплатным флагом и платным гербом возвращает гостю через Entity
    API только флаг; герб появляется только в guarded deck response владельца.
14. Изменение paid-only герба не создаёт глобальный ENTITY change, раскрывающий
    герб, но увеличивает `Deck.contentRevision`; owner получает обновление
    targeted fetch-ом.
15. Paid-only URL без подписи либо после `expiresAt` не скачивается; public
    preview остаётся доступным без auth.
16. Asset, одновременно входящий в FREE и ENTITLEMENT deck, считается публичным,
    а admin publication preview явно предупреждает об этом.

## 20. Rollout

1. Добавить backend schema/API/verification с commerce-флагами в `false`.
2. Добавить admin offers/access UI и проверить dev products.
3. Выпустить iOS с StoreKit infrastructure, restore и locked UI, но без активных paid decks.
4. Настроить Paid Apps Agreement, tax/banking и App Store products.
5. Пройти Xcode StoreKit, Sandbox и TestFlight tests.
6. Отправить первую IAP вместе с новой app version.
7. После Apple approval опубликовать content release с первой paid deck.
8. Включить `commerce.paid_decks.discovery.enabled` и `commerce.apple_iap.enabled`
   сначала только в dev, затем небольшим production rollout.
9. Проверить notification/reconciliation metrics.
10. Включить всем пользователям.

Старый клиент не должен получить paid deck как обычную бесплатную. До первой paid content release MUST быть активен minimum-client-version gate либо server filtering по client version. Лучший порядок — сначала выпустить StoreKit-capable client, затем контент.

## 21. Не входят в первую версию

- auto-renewable subscription;
- consumable currency/credits;
- external checkout/links;
- Apple Pay для цифровых колод;
- Family Sharing;
- gifting;
- promo/support manual grants в admin UI;
- динамическое создание тысяч внутренних items через Advanced Commerce API;
- программное изменение цен из Country Flags admin;
- transfer покупки между двумя активными аккаунтами;
- строгий DRM против модифицированного устройства;
- Android Google Play Billing и Web checkout — модель готова, реализации отдельные.

## 22. Definition of Done

- Каждый paid deck требует stable entitlement key.
- Каждому активному iOS offer соответствует validated Apple non-consumable product.
- Guest/free account не скачивает полную paid deck и не создаёт новую session.
- Verified owner получает доступ локально и на backend.
- Purchase, relaunch, restore, new device, pending, refund и refund reversal проверены.
- Все server transactions/notifications идемпотентны.
- Sandbox никогда не влияет на production entitlement.
- Owners сохраняют доступ после remove-from-sale.
- Feature flag не блокирует owners и не выдаёт access non-owners.
- Admin publication validation предотвращает опасные access/grant изменения.
- European Coats, U.S. State Flags и mixed deck публикуются только после
  завершения prerequisite из §13 и DoD документа 18.
- Privacy/Terms/App Store metadata соответствуют фактическому поведению.
- Production dashboards и alerts показывают notification/reconciliation health.
- Гость и free account проходят content bootstrap целиком, когда в каталоге
  есть платные колоды.
- Бандл приложения не содержит изображений, доступных только в платных колодах.
- Оффлайн-импорт сессии после refund сохраняет уже сделанные повторы.
- Существующий free learning/progress flow не регрессировал.

## 23. Официальные источники Apple

- App Review Guidelines, In-App Purchase: <https://developer.apple.com/app-store/review/guidelines/>
- In-App Purchase types and setup: <https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/overview-for-configuring-in-app-purchases/>
- StoreKit transactions/current entitlements: <https://developer.apple.com/documentation/storekit/transaction>
- `appAccountToken`: <https://developer.apple.com/documentation/storekit/transaction/appaccounttoken>
- Restore with `AppStore.sync()`: <https://developer.apple.com/documentation/storekit/appstore/sync()>
- App Store Server API: <https://developer.apple.com/documentation/appstoreserverapi>
- App Store Server Notifications types: <https://developer.apple.com/documentation/appstoreservernotifications/notificationtype>
- Apple Node server library: <https://github.com/apple/app-store-server-library-node>
- StoreKit Testing in Xcode: <https://developer.apple.com/documentation/xcode/setting-up-storekit-testing-in-xcode/>
- Sandbox testing: <https://developer.apple.com/documentation/storekit/testing-in-app-purchases-with-sandbox>
- IAP product metadata: <https://developer.apple.com/help/app-store-connect/reference/in-app-purchases-and-subscriptions/in-app-purchase-information/>
- IAP pricing: <https://developer.apple.com/help/app-store-connect/manage-in-app-purchases/set-a-price-for-an-in-app-purchase/>
- Family Sharing: <https://developer.apple.com/help/app-store-connect/configure-in-app-purchase-settings/turn-on-family-sharing-for-in-app-purchases>
- App Privacy data types: <https://developer.apple.com/app-store/app-privacy-details/>
- Small Business Program: <https://developer.apple.com/app-store/small-business-program/>
