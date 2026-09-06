# ТЗ: редизайн admin console для стран, штатов, медиа и колод

Статус: `Design and implementation baseline 1.0`

Дата: 5 сентября 2026 года

Связанные документы:

- [DESIGN.md](../DESIGN.md) — общий визуальный контракт;
- [17-paid-decks-storekit.md](./17-paid-decks-storekit.md) — StoreKit, entitlements и commerce;
- [18-multi-content-paid-decks.md](./18-multi-content-paid-decks.md) — GeoEntity, гербы, штаты и multi-content колоды;
- [ADR-014](./adr/ADR-014-admin-console-architecture.md) — draft/proposal/release архитектура;
- [ADR-020](./adr/ADR-020-geo-entities-and-card-variants.md) — страны, подразделения и варианты карточек.

Визуальные референсы:

- [Content workspace](./design/admin-redesign/content-workspace-v1.png);
- [Entity media editor](./design/admin-redesign/entity-media-editor-v1.png);
- [Deck builder](./design/admin-redesign/deck-builder-v1.png).

Референсы фиксируют иерархию, плотность и основные компоненты, но не являются
pixel-perfect макетами. Реализация использует существующие React Admin, MUI,
theme tokens и generated API client.

## 1. Цель

Сделать admin console понятным редакторским инструментом, в котором можно без
правки JSON:

- создать и отредактировать страну или административное подразделение;
- загрузить флаг, герб, карту и будущие типы media в контексте сущности;
- собрать колоду из конкретных вариантов карточек;
- настроить публичные preview и доступ к платной колоде;
- увидеть ошибки до release validation;
- безопасно провести draft через `Edit → Validate → Review → Publish`.

Редактор должен работать с продуктовым содержанием, а не с внутренними DTO,
foreign keys и storage object keys.

## 2. Что сейчас мешает работе

Текущая реализация функциональна, но повторяет backend-модель в UI:

- `Dashboard` показывает статистику, но не подсказывает следующую работу;
- `DraftShow` смешивает навигацию по контенту и release operations;
- `EntityEditor` представляет страну одним длинным техническим form и содержит
  raw overrides;
- `DraftAssets` требует вручную вводить `entityContentKey`, поэтому asset легко
  прикрепить не к той сущности;
- `DeckMembersEditor` выбирает преимущественно entity keys и плохо объясняет,
  какая именно карточка — флаг или герб — попадёт в колоду;
- missing media, локали, provenance, access и public preview проверяются слишком
  поздно и находятся на разных экранах.

Редизайн не отменяет draft/proposal модель. Он меняет представление и объединяет
связанные действия в task-oriented workflows.

## 3. Принципы

1. **Контекст важнее таблицы.** Флаг и герб загружаются со страницы Германии,
   а не через глобальную форму с ручным ключом.
2. **Сущность, карточка и колода различимы.** Страна хранит assets; deck member
   указывает `entity + template + schema version`.
3. **Validation рядом с причиной.** Ошибка отображается у поля и в общем health
   summary, а не только в конце публикации.
4. **Без скрытой публикации.** UI всегда показывает draft, environment и
   последствия действия.
5. **Доступ — вычисляемое состояние.** `Public`, `Preview` и `Paid-only`
   показываются около asset и карточки, но вычисляются из опубликованных
   FREE-memberships, preview allowlist и entitlement memberships.
6. **Одна основная кнопка на контекст.** `Save entity`, `Save deck`, `Validate`
   или `Publish`; конкурирующие primary actions запрещены.
7. **Цена не является контентом.** Admin отображает цену read-only из store
   metadata и никогда не предлагает вводить её вручную.

## 4. Информационная архитектура

### 4.1 Глобальная навигация

~~~text
Overview

Published content
  Countries & regions
  Decks

Draft workspace
  Countries & regions
  Deck builder
  Media
  Validation & release

Commerce
  Products & offers
  Entitlements
  Diagnostics

Administration
  Users & roles
  Audit log
  Settings
~~~

`Published content` — read-only проекция активного release. Все изменения
создаются только в выбранном draft workspace.

### 4.2 Верхняя панель

На всех экранах видны:

- environment badge `DEV` или `PRODUCTION`;
- выбранный draft с возможностью переключения;
- глобальный поиск по country name, entity key, ISO/subdivision code и deck;
- состояние сохранения текущего документа;
- профиль и роль пользователя.

Для production красный используется только в environment badge и подтверждении
опасного действия. Вся рабочая поверхность остаётся одинаковой между dev и
production, чтобы не создавать две визуальные системы.

### 4.3 Целевые routes

| Route | Назначение |
| --- | --- |
| `/` | action-oriented Content workspace |
| `/published/entities` | read-only опубликованные страны и подразделения |
| `/published/decks` | read-only опубликованные колоды |
| `/releases` | что читают клиенты, публикация и откат (ADR-017) |
| `/drafts/:draftId/overview` | состояние выбранного draft |
| `/drafts/:draftId/entities` | список сущностей draft |
| `/drafts/:draftId/entities/:entityKey/:tab?` | редактор сущности |
| `/drafts/:draftId/decks` | список колод draft |
| `/drafts/:draftId/decks/:deckKey/:tab?` | редактор колоды |
| `/drafts/:draftId/media` | глобальная очередь проблем и replacements |
| `/drafts/:draftId/release` | validation, diff, review, publish |
| `/commerce/*` | entitlements, offers, products, diagnostics |

Существующие URLs MUST сохранить redirect на соответствующую новую вкладку,
чтобы не сломать bookmarks и ссылки из audit log.

## 5. Content workspace

Главная страница отвечает на вопрос «что мне делать дальше», а не только
показывает totals.

Обязательные блоки:

- lifecycle текущего draft: `Edit → Validate → Review → Publish`;
- active release и время публикации;
- выбранный draft и время последнего изменения;
- число entities/decks, требующих внимания;
- work queue с черновиками, completeness и основной кнопкой
  `Continue editing`;
- validation summary с группировкой Passed/Warnings/Errors;
- recent activity с автором и ссылкой на изменённый объект.

Если draft отсутствует, главный CTA — `Create draft from current release`.
Формулировка `Import draft` не используется для обычного редакторского потока.

## 6. Countries & regions

### 6.1 Список

Список поддерживает:

- поиск по локализованному имени, canonical key и identifiers;
- filters: `Country | Subdivision | Region`, parent, status, in catalog,
  missing flag, missing coat, missing localization, validation state;
- saved filter presets: `Needs attention`, `U.S. states`, `Missing coats`;
- колонки: name, kind, parent, flag, coat, locale completeness, used in decks,
  validation, updated at;
- bulk actions только для безопасных metadata changes и validation;
- создание `Country`, `Subdivision` или `Region` через явный type chooser.

Штаты США показываются как `Subdivision` под parent `United States`; они не
смешиваются с country-only catalog даже при совпадении остальных полей.

### 6.2 Редактор сущности

Header содержит primary image, localized display name, canonical key, kind,
status, catalog state, parent и сохранение. Форма делится на вкладки:

1. `Overview` — kind, status, parent, identifiers, catalog inclusion;
2. `Names & locales` — имена и описания по locale, completeness и fallback;
3. `Facts` — capital, population, area, languages, currency и type-specific
   facts, включая statehood/admission date и motto;
4. `Media` — флаг, герб, карта и другие media текущей сущности;
5. `Deck usage` — карточки и колоды, использующие сущность;
6. `History` — audit trail, draft diff и published version.

Raw dotted-path overrides удаляются из основного UI. Если аварийный advanced
editor временно остаётся, он доступен только роли `content_admin`, скрыт за
feature flag и показывает schema validation до сохранения.

### 6.3 Entity health rail

На desktop справа закреплён summary:

- Names/locales;
- core facts;
- required assets;
- provenance/license;
- card compatibility;
- decks using the entity.

Пункт открывает проблемное поле. Rail не заменяет inline errors. На узком
экране он превращается в collapsible summary над формой.

## 7. Контекстный Media editor

### 7.1 Основной экран

Вкладка `Media` показывает asset slots, а не глобальную upload form:

- `Flag`;
- `Coat of arms`;
- `Map`;
- `Other media` и будущие типы.

Каждый заполненный slot содержит:

- rendered preview с переключателем светлого/тёмного фона;
- asset type и variant;
- read-only delivery badge `Public`, `Public preview` или `Paid-only`;
- source URL, license, attribution и provenance completeness;
- localizations completeness;
- validity interval и current/retired state;
- список использующих карточек/колод;
- действия `Replace`, `Edit metadata`, `View details`, `Retire`.

Пустой slot содержит `Add flag`, `Add coat of arms` и объясняет, какой template
после этого станет доступен. Флаг и герб — независимые slots одной GeoEntity.

### 7.2 Upload/replace flow

Upload открывается drawer/modal из конкретного slot. `entityKey` и `assetType`
заполняются контекстом и не редактируются вручную.

Шаги:

1. drop/select SVG или PNG;
2. client-side MIME/size check и безопасный preview;
3. source, license, attribution;
4. localized display name/description;
5. validity и variant;
6. review changes и сохранить в draft.

Для герба preview MUST показывать safe area и предупреждать об обрезанном crown,
supporters или ribbon. Для флага отображается aspect-ratio check. Replace создаёт
новую revision и сохраняет audit history; физическое удаление published asset из
UI отсутствует.

### 7.3 Глобальный Media screen

Глобальный экран остаётся, но служит очередью и аудитом:

- assets with validation errors;
- missing provenance/license;
- stale/retired representations;
- failed processing jobs;
- assets shared by FREE and ENTITLEMENT decks;
- replacements awaiting review.

Он не является основным способом загрузки и не требует ручных entity keys.

### 7.4 Защита платного контента

Delivery badge вычисляется сервером через общую projection policy:

- asset в published FREE card → `Public`;
- asset выбран в paid deck public preview → `Public preview`;
- asset встречается только в entitlement content → `Paid-only`.

Редактор не может произвольно сделать URL private/public отдельным toggle.
Изменение membership или preview немедленно пересчитывает статус и показывает
последствие до сохранения. Использование одного asset в FREE- и paid-deck
показывает warning: этот asset станет публичным для release.

## 8. Deck builder

### 8.1 Вкладки

1. `Details` — key, kind, локализованные name/description, taxonomy;
2. `Content` — состав и порядок карточек;
3. `Presentation` — artwork, catalog fan и до трёх public previews;
4. `Access & store` — FREE/ENTITLEMENT, entitlement, offer и store status;
5. `Review` — resolved result, validation и diff.

### 8.2 Content workspace

Desktop layout состоит из трёх колонок.

**Card library**:

- поиск по country/state/region;
- filters по entity kind, parent, asset type, template, locale, validation и
  missing media;
- каждая строка показывает entity, image preview, template и add action;
- bulk recipes: `All 50 U.S. states`, `All European coats`, `All countries with
  valid flag`;
- disabled item объясняет, какого asset/template/locale не хватает.

**Deck content**:

- resolved rows `entity + template code + schema version`;
- thumbnail и human-readable card name;
- drag/drop и keyboard reordering;
- multiselect, remove, change template и batch validation;
- manual, alphabetical и taxonomy sort с явным предупреждением перед
  перезаписью editorial order;
- duplicates запрещены на уровне одной resolved card, но flag и coat одной
  страны могут одновременно входить в смешанную колоду.

**Deck summary**:

- resolved card count, template count, missing assets/locales;
- compact read-only preview каталога;
- три public preview cards и их порядок;
- access model, entitlement и offer;
- предупреждения об accidental public exposure;
- ссылка на validation details.

На ширине ниже 1280 px summary переносится в drawer; library и content остаются
двумя колонками. Полноценное редактирование на телефоне не поддерживается.

### 8.3 Presentation

Редактор выбирает не «красивые картинки», а конкретные public preview cards из
membership. Максимум — три. Нельзя выбрать карточку вне колоды или asset,
который не прошёл validation.

Preview показывает:

- catalog row/card;
- locked deck hero fan;
- owned deck header/list thumbnail;
- локали RU и EN;
- missing artwork fallback.

Это компактная product preview, а не симулятор всего iOS paywall.

### 8.4 Access & store

Для FREE deck показывается только access model. Для ENTITLEMENT deck:

- stable entitlement key;
- offer code;
- App Store product id текущего environment;
- validation status и last sync;
- localized price read-only;
- кнопка перехода в diagnostics.

Production mapping нельзя менять без роли и typed confirmation. Deck content
можно сохранить без готового store product, но `READY/PUBLISH` остаются
заблокированными.

## 9. Validation, сохранение и конфликт изменений

- Используется explicit save, а не невидимый autosave.
- Sticky action bar содержит `Discard changes`, `Validate` и один primary
  `Save entity/deck`.
- Dirty state виден в header и блокирует случайный уход через confirm dialog.
- Все writes передают draft revision/ETag для optimistic concurrency.
- При конфликте UI показывает changed fields и предлагает reload или copy
  unsaved values; молчаливый last-write-wins запрещён.
- Локальная validation запускается по мере редактирования; server validation —
  вручную и перед переходом в Review.
- Каждая server finding содержит route/tab/field pointer, чтобы клик из report
  открывал источник ошибки.
- Publish screen группирует diff по Entity, Asset, Card template, Membership,
  Presentation, Access и Commerce mapping.

## 10. Visual language

Admin — спокойный дневной рабочий инструмент, а не копия тёмного iOS-клиента.

- canvas: neutral light background;
- navigation/chrome: deep navy;
- primary action and focus: existing cobalt blue;
- success/warning/error: semantic green/amber/red;
- красный не используется как декоративный цвет;
- контентные изображения флагов и гербов являются главным цветовым акцентом;
- borders и elevation тихие, без glassmorphism, neon и больших градиентов;
- базовый spacing rhythm: 4/8/12/16/24/32;
- field radius 8–10 px, card radius 10–14 px;
- data density выше iOS, но строки имеют минимум 40 px и ясное hover/focus
  состояние.

Существующий MUI theme расширяется semantic tokens. Новая дизайн-система или UI
dependency не создаётся.

## 11. Accessibility и responsive

- WCAG 2.2 AA для contrast, focus и keyboard operation;
- все icon-only actions имеют label/tooltip;
- drag/drop имеет keyboard alternative и move up/down action;
- validation state передаётся icon + text, не только цветом;
- tabs, drawers и dialogs возвращают focus инициатору;
- таблицы сохраняют логический reading order;
- desktop target: 1280–1920 px;
- tablet: right rail/drawer и stacked metadata;
- phone: просмотр статуса и approval MAY поддерживаться, полное редактирование
  не входит в scope.

## 12. API/contract requirements для UX

Admin API MUST предоставить UI агрегированные read models, чтобы не создавать
N+1 и не переносить projection rules в браузер:

- entity list: `kind`, `parent`, `hasFlag`, `hasCoatOfArms`, locale/validation
  summary, used-in-decks count;
- entity detail: typed facts, assets, computed delivery status и deck usages;
- searchable card library: resolved card candidates, template compatibility,
  asset/locale readiness и disabled reason;
- deck detail: resolved members, sort order, preview cards, presentation,
  access/store summary и validation summary;
- validation finding: stable code, severity, object identity, route/tab and field
  pointer;
- asset upload: contextual entity/type, processing status и optimistic revision;
- mutations: current draft revision/ETag и structured conflict response.

`admin/src/api/generated` регенерируется из `contracts/admin-openapi.yaml`.
Frontend не создаёт параллельные handwritten DTO и не вычисляет, является ли
asset paid-only.

## 13. Аналитика и audit

Внутренняя продуктовая аналитика MAY собирать:

- открытие workflows и время до успешного save;
- validation failures по стабильному error code;
- abandon upload/deck edit;
- использование bulk recipes.

Не отправляются asset bytes, названия файлов, free-form descriptions, source
URLs и PII редактора. Все content mutations независимо пишутся в audit log с
actor, draft, object, revision и before/after diff.

## 14. Этапы реализации

### Phase A — shell и workspace

- новая navigation model и draft selector;
- action-oriented dashboard;
- route migration/redirects;
- shared sticky action bar и validation summary.

### Phase B — entity и media

- новый entity list и tabbed editor;
- subdivision/parent workflow;
- contextual media slots и upload/replace drawer;
- health rail и computed delivery badges;
- global media queue.

### Phase C — deck builder

- searchable resolved card library;
- three-column membership editor;
- bulk recipes, ordering и keyboard controls;
- presentation/public preview;
- access/store summary.

### Phase D — review и polish

- field-addressable validation report;
- release diff и production confirmations;
- audit/activity UX;
- accessibility, tablet layout и performance pass.

Phase A–C могут выходить последовательно за feature flags. Старые editors
сохраняются как fallback до завершения migration и удаляются после parity tests.

## 15. Acceptance criteria

1. Редактор создаёт U.S. subdivision, выбирает United States как parent и
   загружает флаг, ни разу не вводя entity key вручную в asset form.
2. Редактор добавляет Германии герб, видит `Paid-only` и колоды, через которые
   он доступен; public Entity API при этом не раскрывает asset.
3. `European Coats` собирается bulk action из совместимых coat cards; resolved
   count, missing assets и duplicates видны до save.
4. В колоду можно добавить флаг и герб одной страны как две разные карточки.
5. Для paid deck выбираются ровно до трёх preview cards; UI предупреждает, что
   их assets станут публичными.
6. Price read-only и приходит из store metadata; отсутствие mapping блокирует
   Publish, но не редактирование.
7. Validation issue открывает конкретную сущность, вкладку и поле.
8. Concurrent edit не перезаписывается молча.
9. Основные entity/deck/media workflows доступны с клавиатуры и проходят WCAG
   2.2 AA checks.
10. Старые deep links перенаправляются на соответствующие новые экраны.

## 16. Не входит в первую итерацию

- визуальный page builder;
- создание App Store products из admin console;
- полноценное mobile editing;
- AI-generation флагов, гербов или описаний;
- bulk import без preview/dry run;
- изменение canonical entity keys после публикации;
- независимый asset ACL toggle, обходящий общую access projection policy.
