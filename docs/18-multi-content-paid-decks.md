# ТЗ: гербы, штаты и платные multi-content колоды

Статус: `Draft 0.1 — implementation ready after contract approval`  
Дата: 4 сентября 2026 года  
Связанные решения: [ADR-019](./adr/ADR-019-paid-deck-entitlements.md),
[ADR-020](./adr/ADR-020-geo-entities-and-card-variants.md)  
Визуальный контракт: [DESIGN.md](../DESIGN.md)

## 1. Цель

Расширить существующие backend, content pipeline, admin и iOS так, чтобы:

- страна могла иметь флаг, герб и будущие визуальные материалы;
- штаты США хранились в общей модели геосущностей, но не считались странами;
- колода могла содержать произвольное число карточек разных типов;
- платная колода открывалась Apple Non-Consumable purchase и backend
  entitlement;
- до покупки клиент видел только discovery metadata, после покупки — полный
  список и стандартный учебный flow;
- dev/Sandbox и production commerce/content оставались полностью разделены.

## 2. Утверждённые продуктовые решения

1. Герб хранится как `COAT_OF_ARMS` asset соответствующей страны.
2. Штаты хранятся в `geo_entities`, но имеют kind `SUBDIVISION` и родителя США.
3. Флаг и герб одной страны — разные learning cards и разный progress.
4. Колода содержит learning-card variants, а не абстрактные страны.
5. Доступ и покупка задаются на уровне Deck; внутри платной колоды допустимо
   любое количество флагов, гербов и будущих templates.
6. Первая iOS-модель оплаты — разовая покупка Apple Non-Consumable.
7. Количество платных колод доменно не ограничено. Один offer MAY выдавать одну
   колоду или bundle нескольких entitlements.
8. Бесплатный пользователь видит locked deck и публичный preview, но не получает
   полный список карточек и не может создать сессию.
9. После покупки commerce chrome исчезает; отображаются поиск, полный список,
   progress и `Start learning`/`Continue`.

## 3. Первые новые колоды

### 3.1 European Coats

- code: `EUROPEAN_COATS`;
- editorial key: `deck.european_coats`;
- entitlement: `deck.europe_coats`;
- 52 карточки на момент первого контентного релиза; точный список утверждается
  редакционно и не зашивается в код;
- subject kind: `COUNTRY`, `TERRITORY` или утверждённая special-area entity;
- template: `COAT_OF_ARMS_TO_COUNTRY`, schema version `1`;
- prompt: один актуальный герб без названия страны;
- answer: страна, локализованное название герба, столица и дополнительные факты;
- выбранный public-preview fan: Австрия слева, Польша в центре, Чехия справа.

Рабочая коммерческая конфигурация:

~~~text
offer:       EUROPE_COATS_LIFETIME
entitlement: deck.europe_coats
prod IAP:    app.countryflags.deck.europe_coats.lifetime.v1
dev IAP:     app.countryflags.dev.deck.europe_coats.lifetime.v1
~~~

### 3.2 U.S. State Flags

- code: `US_STATE_FLAGS`;
- editorial key: `deck.us_state_flags`;
- entitlement: `deck.us_state_flags`;
- ровно 50 штатов в v1;
- Washington, D.C. и территории США в v1 не входят;
- subject kind: `SUBDIVISION`;
- parent: `country.united_states`;
- template: `FLAG_TO_COUNTRY`, schema version `1`, или совместимый
  subdivision-вариант того же
  renderer;
- prompt: флаг штата без подписи;
- answer: штат, столица, дата вступления и короткая история символа;
- выбранный public-preview fan: Washington, California, Texas; California в
  центре.

Рабочая коммерческая конфигурация:

~~~text
offer:       US_STATE_FLAGS_LIFETIME
entitlement: deck.us_state_flags
prod IAP:    app.countryflags.deck.us_state_flags.lifetime.v1
dev IAP:     app.countryflags.dev.deck.us_state_flags.lifetime.v1
~~~

Product IDs являются предложенной naming convention. Перед production их MUST
сверить с фактически созданными immutable identifiers в App Store Connect.

## 4. Целевая доменная модель

### 4.1 GeoEntity

В `GeoEntityKind` добавляется:

~~~text
SUBDIVISION
~~~

Отдельная таблица `State` не создаётся. В Prisma остаётся `GeoEntity`, потому
что names, facts, assets, source provenance, validity и publishing lifecycle у
страны и административной единицы одинаковы.

Для subdivision каноническая связь с родителем хранится в `GeoRelation`:

~~~text
parent:       country.united_states
child:        subdivision.us.california
taxonomyCode: ADMINISTRATIVE
relationType: CONTAINS
~~~

Backend MUST валидировать:

- ровно одного active primary administrative parent;
- parent kind `COUNTRY` или `TERRITORY`;
- отсутствие циклов;
- `includeInCountryCatalog = false`;
- `recognitionStatus = NOT_APPLICABLE`.

### 4.2 Идентификаторы подразделений

`EntityReference` и admin contract получают опциональные ключи:

- `isoSubdivision` — ISO 3166-2, например `US-CA`;
- `localCode` — официальный внутренний код;
- `fipsCode` — только когда источник явно публикует FIPS.

Нельзя записывать `US-CA` в `isoAlpha2`/`isoAlpha3`.

### 4.3 Assets

Одна `GeoEntity` MAY иметь несколько assets:

- `FLAG`;
- `COAT_OF_ARMS`;
- `MAP`;
- будущие типы через extensible enum.

Для каждого ассета обязательны:

- `assetType`;
- `variant`, baseline — `current`;
- representations и checksums;
- dimensions/aspect ratio;
- source, license и attribution;
- `validFrom`/`validTo`, если изображение историческое;
- локализованные `displayName` и `description`, если у символа есть собственное
  название или история.

Добавляется `AssetLocalization(assetId, locale, displayName, description)`.
История герба относится к конкретному asset/variant и не должна жить одним
неструктурированным полем в стране.

Уникальность активного изображения:

~~~text
(geoEntityId, assetType, variant, validFrom)
~~~

### 4.4 Facts

Существующие универсальные факты переиспользуются. Для subdivision добавляются
extensible fact types:

- `STATEHOOD_DATE` — дата принятия/образования в контексте родителя;
- `MOTTO`;
- `LARGEST_CITY`;
- `OTHER` остаётся fallback, но не используется вместо известных типов.

`SYMBOL_DESCRIPTION` не добавляется в `Fact`: описание конкретного герба или
флага хранится в `AssetLocalization`.

### 4.5 CardTemplate и LearningCard

Минимальные templates:

| Template | Prompt | Answer | Subjects |
| --- | --- | --- | --- |
| `FLAG_TO_COUNTRY` v1 | `FLAG/current` | entity name + configured facts | country, territory, area, subdivision |
| `COAT_OF_ARMS_TO_COUNTRY` v1 | `COAT_OF_ARMS/current` | entity + asset title + configured facts | country, territory, area |

Одна Германия получает минимум две независимые карточки:

~~~text
(country.germany, FLAG_TO_COUNTRY, 1)
(country.germany, COAT_OF_ARMS_TO_COUNTRY, 1)
~~~

`LearningCard.id` является progress identity. Общая `subjectEntityId` не
объединяет scheduling/mastery разных templates.

Material replacement правила применяются независимо к каждому asset type:

- техническая замена representations сохраняет card ID/progress;
- существенная смена официального символа создаёт новую semantic card version;
- изменение герба не supersede карточку флага.

## 5. Editorial JSON schema v3

Pipeline MUST читать v2 через migration adapter и записывать новые изменения в
v3. Новый subdivision пример:

~~~json
{
  "key": "subdivision.us.california",
  "type": "subdivision",
  "status": "active",
  "parentKey": "country.united_states",
  "config": {
    "includeInCountryCatalog": false
  },
  "recognitionStatus": "not_applicable",
  "identifiers": {
    "isoSubdivision": "US-CA",
    "fipsCode": "06"
  },
  "names": {
    "en": { "short": "California" },
    "ru": { "short": "Калифорния" }
  }
}
~~~

Asset override больше не ограничен flag и не конфликтует по имени:

~~~json
{
  "entityKey": "country.germany",
  "assetType": "coat_of_arms",
  "variant": "current",
  "sourceUrl": "https://example.invalid/source",
  "license": "Public domain",
  "reason": "Verified official artwork",
  "localizations": {
    "en": {
      "displayName": "Federal Eagle",
      "description": "Official federal emblem of Germany."
    },
    "ru": {
      "displayName": "Федеральный орёл",
      "description": "Официальная федеральная эмблема Германии."
    }
  }
}
~~~

Путь файла MUST включать тип и variant:

~~~text
editorial/overrides/assets/<entityKey>/<assetType>/<variant>.svg
~~~

## 6. Контракт состава колоды

Текущий `memberEntityKeys` недостаточен: у одной entity несколько learning
cards. `EditorialDeck` v3 получает `defaultTemplateCode` и
`defaultTemplateSchemaVersion`, а members поддерживает
явные card refs.

Однородная колода:

~~~json
{
  "key": "deck.european_coats",
  "kind": "curated",
  "defaultTemplateCode": "COAT_OF_ARMS_TO_COUNTRY",
  "defaultTemplateSchemaVersion": 1,
  "members": ["country.germany", "country.poland"]
}
~~~

Смешанная колода:

~~~json
{
  "key": "deck.symbols_sampler",
  "kind": "curated",
  "members": [
    {
      "entityKey": "country.germany",
      "templateCode": "FLAG_TO_COUNTRY",
      "templateSchemaVersion": 1
    },
    {
      "entityKey": "country.germany",
      "templateCode": "COAT_OF_ARMS_TO_COUNTRY",
      "templateSchemaVersion": 1
    }
  ]
}
~~~

Правила:

- string members требуют `defaultTemplateCode` и
  `defaultTemplateSchemaVersion`;
- explicit object member MAY переопределить default;
- одна пара entity/template не повторяется;
- порядок members является редакционным `sortOrder`;
- `all-current` по умолчанию использует `FLAG_TO_COUNTRY` v1 и исключает
  `SUBDIVISION`;
- taxonomy selection задаёт template явно;
- publisher резолвит members в `DeckCard.learningCardId`, после чего runtime не
  угадывает template.

Deck metadata дополнительно содержит:

- `contentKinds` — derived unique list `FLAG`, `COAT_OF_ARMS`, ...;
- `previewCardIds` — 0...3 явно публичных карточных preview;
- `access` — `FREE` или `ENTITLEMENT` из ADR-019.

`contentKinds` и `cardCount` вычисляются publisher-ом и не редактируются руками.

## 7. Consumer API

### 7.1 GeoEntity contract

`GeoEntity.kind` extensible enum получает `SUBDIVISION`.

Добавляются nullable поля:

~~~json
{
  "parent": {
    "id": "uuid",
    "kind": "COUNTRY",
    "name": "United States"
  },
  "identifiers": {
    "isoSubdivision": "US-CA",
    "localCode": null,
    "fipsCode": "06"
  }
}
~~~

`parent` отсутствует для обычной страны. Клиент не выводит subdivision в
country-only списках только по отсутствию parent; фильтрация использует `kind`.

`Asset` получает локализованные nullable `displayName` и `description`. Полный
provenance продолжает храниться на backend; consumer получает существующие
license/attribution поля.

### 7.2 Deck contract

`Deck` получает обязательные для нового клиента поля:

~~~json
{
  "contentKinds": ["COAT_OF_ARMS"],
  "access": {
    "model": "ENTITLEMENT",
    "requiredEntitlementKey": "deck.europe_coats",
    "offerCodes": ["EUROPE_COATS_LIFETIME"]
  },
  "previewCards": []
}
~~~

`GET /v1/decks` и `GET /v1/decks/{id}` доступны без entitlement и возвращают:

- название/описание/count;
- content kinds;
- access policy и offer codes;
- только явно опубликованные preview assets/cards.

`GET /v1/decks/{id}/cards`:

- owner/free deck: полный список;
- locked paid deck: `403 ENTITLEMENT_REQUIRED`;
- response не фильтрует карточки по asset type и сохраняет editorial order.

`LearningCard` сохраняет `templateCode`/`templateSchemaVersion`; prompt asset
может быть `FLAG` или `COAT_OF_ARMS`. Клиент обязан выбирать renderer по
template, а не по Deck name или entity kind.

### 7.3 Версионирование

- OpenAPI сначала расширяется additive nullable/extensible полями.
- `SUBDIVISION` добавляется в `x-extensible-enum`.
- release с новым обязательным template публикуется только после поднятия
  `minimumClientVersion`.
- iOS generated contract и mock fixtures обновляются одной PR с OpenAPI.

## 8. Backend и pipeline

Backend MUST:

1. добавить Prisma enum/migration для `SUBDIVISION` и новых fact types;
2. добавить `AssetLocalization` и published mapping;
3. поднять editorial schema до v3;
4. расширить asset candidates/overrides на `COAT_OF_ARMS`;
5. убрать flag-only reject в proposal publisher;
6. сделать object key зависимым от entity/type/variant/checksum;
7. создавать learning cards для каждой допустимой пары entity/template;
8. резолвить deck members в пары entity/template;
9. публиковать/валидировать public preview отдельно от закрытого deck payload;
10. применять `DeckAccessService` к cards и session creation;
11. не блокировать review sync после refund;
12. включить content/card/asset changes в существующий cursor feed.

Обязательные validation codes:

- `SUBDIVISION_PARENT_REQUIRED`;
- `SUBDIVISION_PARENT_INVALID`;
- `SUBDIVISION_IN_COUNTRY_CATALOG`;
- `ADMINISTRATIVE_RELATION_CYCLE`;
- `CARD_TEMPLATE_UNKNOWN`;
- `CARD_TEMPLATE_SUBJECT_KIND_UNSUPPORTED`;
- `CARD_TEMPLATE_ASSET_MISSING`;
- `DECK_CARD_DUPLICATE`;
- `DECK_PREVIEW_NOT_MEMBER`;
- `DECK_PREVIEW_NOT_PUBLIC`;
- существующие entitlement/store validation errors из §12 документа 17.

## 9. Admin console

### 9.1 Entity editor

Добавить:

- type option `subdivision`;
- обязательный searchable Parent selector для subdivision;
- identifiers `isoSubdivision`, `localCode`, `fipsCode`;
- фильтры list: kind, parent, status, missing flag, missing coat;
- отдельный toggle `In country catalog` disabled/off для subdivision;
- facts form для statehood date, motto, capital, population, area, language;
- явный warning, если меняется parent опубликованного subdivision.

### 9.2 Asset editor

Для одной entity показывать секции `Flag`, `Coat of arms`, `Map`, `Other`.

Каждая секция поддерживает:

- upload SVG/PNG;
- variant и validity;
- preview на тёмном/светлом фоне;
- source URL, license, attribution;
- локализованные display name/description;
- replace/retire без удаления audit history;
- validation размеров, MIME, sanitizer и aspect-fit safe area.

Герб MUST проходить visual validation без обрезки crown/supporters/ribbon.

### 9.3 Deck editor

Membership editor выбирает не только entity, но и card template.

Обязательные возможности:

- фильтры по entity kind, parent, template и наличию нужного asset;
- bulk-add 50 US subdivisions;
- preview resolved count до сохранения;
- drag/drop sort order для curated deck;
- смешанные card refs;
- выбор до трёх public preview cards и их порядка;
- компактный preview catalog fan/details/list;
- Access block и commerce validation из документа 17;
- environment badge на всех commerce mutations.

Редактор не вводит цену. Цена синхронизируется read-only из App Store Connect.

### 9.4 Publication safety

READY/PUBLISH запрещены, если:

- subdivision нарушает parent/catalog invariants;
- member не резолвится в active LearningCard;
- template требует отсутствующий asset;
- нет обязательных en/ru localizations;
- asset не имеет provenance/license;
- paid deck не имеет стабильного entitlement/active offer/current-environment
  validated store product;
- preview раскрывает карточку, не объявленную публичной;
- free → paid выполнен без migration operation.

Release diff группирует изменения по Entity, Asset type, Card template, Deck
membership, Access и Commerce mapping.

### 9.5 Delta admin API contract

Новые возможности расширяют существующие `/v1/admin/content/drafts/*`
endpoints в `contracts/admin-openapi.yaml`; параллельный CRUD для штатов или
гербов не создаётся.

`AdminEntityType` получает `subdivision`. В
`AdminDraftEntity`/`AdminDraftEntityUpdateRequest` добавляются:

~~~yaml
parentKey: string | null
identifiers:
  isoSubdivision: string | null
  localCode: string | null
  fipsCode: string | null
facts:
  capital: localized value | null
  population: measured value | null
  area: measured value | null
  languages: localized values[]
  statehoodDate: date | null
  motto: localized value | null
  largestCity: localized value | null
~~~

`parentKey` MUST быть non-null для `subdivision` и MUST быть null для типов,
которым административный parent не нужен. List response добавляет
`parentKey`, `hasFlag`, `hasCoatOfArms`, чтобы UI мог фильтровать без N+1.

`AdminDeckMembers` v3 принимает строковые entity keys и explicit card refs:

~~~yaml
entityKey: string
templateCode: string
templateSchemaVersion: integer >= 1
~~~

Create/update deck получают `defaultTemplateCode`,
`defaultTemplateSchemaVersion`, `access` и `previewCardIds`.
`AdminDraftDeckDetail` вместо неоднозначного `memberKeys` возвращает
`resolvedMemberCards[]` с `learningCardId`, entity/template, asset type и
`sortOrder`; старое поле MAY временно оставаться deprecated только на период
миграции generated admin client.

`POST /v1/admin/content/drafts/{draftId}/assets` сохраняется multipart и
дополняется `validFrom`, `validTo` и JSON-объектом `localizations`.
Добавляется:

~~~text
PATCH /v1/admin/content/drafts/{draftId}/assets/{assetId}
~~~

Он меняет только metadata/validity/localizations и использует текущий draft
revision для optimistic concurrency; новые bytes по-прежнему загружаются через
POST. Ответы asset endpoints возвращают `assetType`, `variant`, validity,
provenance и localizations. Любое изменение contract сопровождается
regeneration `admin/src/api/generated` и drift check в CI.

## 10. iOS

### 10.1 Domain/persistence

- `StoredGeoEntityKind` поддерживает unknown/extensible + `SUBDIVISION`;
- entity хранит nullable parent summary и subdivision identifiers;
- asset хранит type, variant и localized display metadata;
- deck хранит contentKinds, access и preview metadata;
- cache identity остаётся UUID/content version; один asset type не перезаписывает
  другой;
- card progress keyed by `LearningCard.id`.

### 10.2 Rendering

Добавить registry renderer-ов по `templateCode`:

- `FLAG_TO_COUNTRY` v1 — существующий flag front/back, поддерживает country и
  subdivision;
- `COAT_OF_ARMS_TO_COUNTRY` v1 — neutral dark front, aspect-fit герб; answer с
  country/asset title/facts;
- неизвестный template не падает: карточка получает unsupported state и не
  входит в новую session.

Нельзя выбирать renderer по названию колоды.

### 10.3 Catalog и locked deck

- locked deck отображается среди обычных deck rows;
- metadata и public fan доступны без entitlement;
- полный card list отсутствует;
- CTA открывает details, но не запускает StoreKit напрямую;
- purchase action использует только `Product.displayPrice`;
- выбранные visual references и состояния находятся в `DESIGN.md`.

### 10.4 После покупки

После verified transaction + entitlement refresh:

1. purchase chrome исчезает;
2. cards/assets загружаются и кешируются;
3. отображается compact hero, progress, search и полный lazy list;
4. строка показывает aspect-fit flag/coat thumbnail, entity name, optional
   asset display name и chevron;
5. tap открывает существующий detail sheet;
6. нижняя кнопка становится `Start learning` или `Continue`;
7. экран обновляется без pop/relaunch.

Reference: `docs/design/paid-decks/european-coats-owned-list-v1.png`.

### 10.5 Детали и study session

- detail sheet показывает `Country facts` для country и `State facts` для
  subdivision;
- subdivision показывает parent country, capital, admission/statehood, area,
  population и symbol story при наличии;
- self-rated Again/Good и objective mode одинаковы для flag/coat templates;
- distractors ограничиваются совместимым template и subject kind;
- country coat никогда не смешивается с subdivision flag как случайный ответ;
- VoiceOver label описывает symbol без выдачи ответа на front side.

### 10.6 Offline

- non-owner кеширует только discovery metadata/public preview;
- owner может открыть ранее скачанную колоду и продолжить offline;
- локально verified новая покупка MAY открыть immediate UX, transaction уходит в
  outbox для backend verification;
- logout удаляет account-scoped paid payload с устройства;
- refund блокирует новую session после authoritative refresh, progress остаётся.

## 11. Commerce и доступ

Все правила [17-paid-decks-storekit.md](./17-paid-decks-storekit.md) обязательны.
Дополнения:

- один entitlement открывает Deck независимо от состава и будущих обновлений;
- изменение card count/content не требует нового Apple product;
- bundle offer MAY выдавать оба `deck.europe_coats` и `deck.us_state_flags`;
- entitlement не открывает отдельные assets вне доступных пользователю decks;
- если одна и та же card входит в free и paid deck, она доступна через free deck;
  guard защищает маршрут paid deck, а не глобально «секретную страну»;
- public preview — отдельная projection, а не обход cards authorization;
- dev product никогда не выдаёт production grant и наоборот.

## 12. Feature flags и аналитика

Предлагаемые flags:

- `content.coats_of_arms.enabled`;
- `content.subdivisions.enabled`;
- `commerce.paid_decks.discovery.enabled`;
- `commerce.apple_iap.enabled`;
- `commerce.deck.europe_coats.enabled`;
- `commerce.deck.us_state_flags.enabled`.

Flags управляют rollout/discovery, но не entitlement. Owner не теряет доступ к
уже купленному контенту из-за выключенного storefront flag.

События без PII:

- `paid_deck_impression`;
- `paid_deck_opened`;
- `purchase_started/completed/cancelled/pending/failed`;
- `purchase_restored`;
- `paid_deck_content_loaded`;
- `paid_deck_study_started`;
- `card_detail_opened` с `contentKind`, но без свободного текста;
- `unsupported_card_template` как operational error.

## 13. Миграция и порядок реализации

### Этап A — contract/model

1. ADR-020 и schema v3.
2. Prisma migrations: subdivision/facts/asset localizations/deck access.
3. OpenAPI + generated clients + fixtures.

### Этап B — pipeline/admin

4. Multi-asset pipeline и coat template.
5. Entity/asset/deck admin editors.
6. Publish validation и diff.

### Этап C — backend access/commerce

7. Deck metadata/public preview projection.
8. Entitlement guard, offers, Apple verification, notifications.
9. Environment reconciliation and observability.

### Этап D — iOS

10. Store/persistence migrations and template registry.
11. Coat/subdivision renderers and detail/list UI.
12. StoreKit purchase/restore/pending/refund states.
13. Offline cache and end-to-end fixtures.

### Этап E — content/release

14. Import 52 European coats and 50 state flags with provenance.
15. Configure dev products/offers and run Sandbox E2E.
16. Raise minimum client version, publish content, staged rollout.
17. Configure production products only after dev acceptance.

## 14. Тестирование

### Backend/pipeline

- Germany publishes two card variants with separate IDs.
- California is subdivision of USA and never appears in `deck.all`.
- mixed deck resolves two templates for one entity without collision.
- missing coat blocks coat-card publication but not flag-card integrity.
- content changes preserve unrelated card progress.
- locked cards/session return `ENTITLEMENT_REQUIRED`.
- preview endpoint never returns full paid payload.
- dev/prod transaction mismatch is rejected.

### Admin

- create/edit subdivision with parent;
- upload flag and coat to one entity;
- edit localized asset metadata;
- build homogeneous and mixed decks;
- choose/reorder previews;
- publication blockers and audit events;
- optimistic concurrency for simultaneous editors.

### iOS

- catalog discovery as guest/free/owner;
- purchase, cancel, pending, restore, relaunch, new device;
- coat front/answer and US state front/answer;
- post-purchase list/search/detail/start;
- separate progress for Germany flag and coat;
- offline owner/non-owner/logout/refund;
- Dynamic Type, VoiceOver, Reduce Motion, smallest iPhone and Pro Max.

## 15. Definition of Done

- Editorial v3 валидирует countries, subdivisions, multi-assets и card refs.
- Admin создаёт/редактирует штат, parent, герб и обе новые колоды без raw JSON.
- Publisher выпускает 52 coat cards и 50 state-flag cards с provenance.
- OpenAPI и iOS generated contracts не расходятся.
- Free account видит locked metadata, но не полный список/cards/session.
- Owner после покупки без перезапуска видит полный список и может начать session.
- Флаг и герб одной страны имеют независимый progress.
- Штаты не загрязняют country catalog/taxonomy/distractors.
- StoreKit/backend restore/refund/reversal работают идемпотентно.
- Dev/Sandbox и production разделены конфигурацией, DB и product mapping.
- UI соответствует выбранным references в `DESIGN.md`.

## 16. Не входит в первую итерацию

- Washington, D.C. и территории в U.S. State Flags;
- исторические гербы и исторические флаги;
- Family Sharing;
- подписка на весь каталог;
- Google Play Billing и Web checkout;
- пользовательские колоды из закрытых card variants;
- автоматическое создание/изменение IAP из admin SPA.
