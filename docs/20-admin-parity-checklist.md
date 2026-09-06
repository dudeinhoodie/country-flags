# Parity checklist редизайна админки

Статус: `ADM-016 (#355), Phase D`
Дата: 6 сентября 2026 года

Документ выполняет acceptance criterion #355: «старый editor удаляется только
после documented parity checklist для entity, asset и deck workflows».
Он фиксирует, чем именно закрыт каждый workflow, каким тестом это проверяется
и что остаётся за feature flag.

## 1. Что уже удалено, а что нет

Отдельного «legacy editor» в дереве не осталось: pre-redesign экраны были
заменены на месте в #317 (entity), #318 (asset), #319 (deck) и #368 (shell).
Поэтому ADM-016 не удаляет параллельный редактор — удалять нечего, — а
завершает переход и закрывает то, что §6.2 и §7.3 явно требуют убрать:

| Что | Состояние | Где |
| --- | --- | --- |
| Raw dotted-path overrides в основном UI сущности | Убраны. Остаются как аварийный advanced editor: feature flag `advancedOverrides` **и** роль `ADMIN` | `EntityEditor.tsx` → `AdvancedOverrides` |
| Upload form на глобальном media screen | Убрана. Загрузка идёт из slot сущности, где `entityKey` и `assetType` берутся из контекста | `DraftAssets.tsx`, `EntityMedia.tsx` |
| Клиентский подбор card candidates по списку entities | Убран. Библиотека карточек читается с сервера | `useCardCandidates` в `useDraftDecks.ts` |
| Bulk recipe «Add the U.S. states», зашитый в клиент | Убран. Вместо него `Add all N matching` поверх серверных фильтров | `DeckMembersEditor.tsx` |

Feature flag `advancedOverrides` объявляется в `/config.json` и по умолчанию
выключен (`admin/docker/40-runtime-config.sh`, переменная
`ADMIN_ADVANCED_OVERRIDES`). Локальный mock-конфиг включает его, чтобы hatch
не сгнил незамеченным.

## 2. Entity workflow

| Проверка | Чем закрыта |
| --- | --- |
| Создание/правка U.S. subdivision с выбором parent без ручного ввода ключа | `entity-editor.spec.tsx` → «offers subdivision and asks it for the country it belongs to», «sends the parent and the facts the form holds» |
| Identifiers валидируются до сохранения, `US-CA` не попадает в ISO-код страны | `entity-editor.spec.tsx` → «blocks a save while an identifier is the wrong shape» |
| Facts (capital, statehood date, population, languages) редактируются и уходят в PATCH | там же, вкладка `Facts` |
| Названия и locale-overrides | вкладка `Names & locales`, те же тесты + `useFieldFocus` по `/names/{locale}/{field}` |
| Перенос опубликованного subdivision требует подтверждения | `entity-editor.spec.tsx` → «asks before moving a published subdivision to another country» |
| Dirty state, `Discard changes`, «нечего сохранять» | «nothing is saveable or discardable until something changes», «puts the form back the way it was loaded» |
| Optimistic concurrency: `If-Match` уходит, `409` не перезаписывается | «sends the parent and the facts the form holds» (проверяет заголовок), «refuses to overwrite a revision somebody else moved» |
| Field-addressable validation: вкладка и поле открываются по ссылке | «opens the tab a finding names and focuses the field», «carries a pointer into another tab» |
| Raw overrides не видны без флага | «keeps the raw override table out of the ordinary editor» |
| Deck usage сущности | вкладка `Deck usage`, данные из `AdminDraftEntityDetail.usages` |

## 3. Asset workflow

| Проверка | Чем закрыта |
| --- | --- |
| Загрузка флага/герба из slot сущности, без ручного ввода `entityKey` | `EntityMedia.tsx`; e2e `accessibility.spec.ts` → «the upload drawer, opened from a slot» открывает drawer с зафиксированным контекстом |
| Отдельные slots для флага и герба, ни один не перезаписывает другой | `EntityMedia.tsx` (`SLOT_KINDS`), `draft-assets.spec.tsx` → «gives every symbol type a section of its own» |
| Processing/failed состояние и восстановление без повторного ввода сущности | `EntityMedia.tsx`: `PROCESSING` показывает прогресс, `FAILED` объясняет, что заменить нужно только файл; форма drawer не очищается при отказе |
| `If-Match` на upload; ответ несёт новую revision | `useDraftAssets.ts` → `upload`; ревизия берётся из `AdminDraftAssetUploadResult.draft` |
| Метаданные и provenance правятся, отправляется только изменённое | `draft-assets.spec.tsx` → «sends only what changed, stamped with the revision it was read at» |
| Retire вместо удаления опубликованного | «retires a symbol by closing its validity rather than deleting it» |
| Глобальный экран — очередь и аудит, не форма загрузки | «offers no upload form of its own, only the way back to the entity», «flags a drawing nobody can account for» |

Не закрыто: `DELETE` черновикового ассета всё ещё идёт без `If-Match` —
контракт не предлагает этот заголовок на маршруте, и придумывать его на
клиенте означало бы обещать гарантию, которой сервер не даёт.

## 4. Deck workflow

| Проверка | Чем закрыта |
| --- | --- |
| Одна страна двумя шаблонами — две разные карточки | `deck-editor.spec.tsx` → «holds one country under two templates as two members» |
| Библиотека карточек читается с сервера, недоступная строка объясняет причину | «says why a card cannot be added rather than greying it out» |
| Bulk-добавление по фильтрам | «adds every card the filters match in one click» |
| Порядок карточек — editorial order, сохраняется | «reorders members and keeps the order as the deck's own» |
| Полное упорядочивание с клавиатуры, focus не теряется | «reorders from the keyboard and keeps focus on the card it moved»; e2e «a deck can be put in order from the keyboard alone» |
| Preview cards: не больше трёх, только участники колоды | «stars at most three previews, each of them a member» |
| Удаление участника снимает его же из preview | «drops a starred member from the deck and from the preview at once» |
| Access: нет поля цены, environment помечен, published free нельзя сделать paid, entitlement key фиксируется после публикации | четыре теста блока «the Access block» |
| Dirty/discard/conflict | «has nothing to save or discard until something changes», «puts the form back the way it was loaded», «refuses to overwrite a revision somebody else moved» |
| Field-addressable validation до вкладки и поля | «opens the tab and the field a finding names» |

## 5. Release и общий UX

| Проверка | Чем закрыта |
| --- | --- |
| Diff группируется по Entity, Asset, Card template, Membership, Presentation, Access, Commerce | `release-diff.spec.ts`; e2e «groups the release diff the way a reviewer reads it» |
| Блокировка proposal объясняется словами, а не только серым цветом | `ReleasePanel.tsx` → `blockedReason` |
| Navigation guard на dirty form | e2e «asks before leaving an editor with unwritten changes» |
| Findings кликабельны из workspace и из редактора | e2e «a validation finding opens the object, the tab and the field» |
| Rail на 1280 px, drawer на планшете | e2e «keeps the summary rail beside the work on a 1280px desktop», «moves the summary panels into a drawer on a tablet» |
| WCAG 2.2 AA на каждом экране и в обоих диалогах | `e2e/accessibility.spec.ts` |

Роль-гейты, typed confirmation производственной публикации и audit-поведение
не менялись: `ReleasePanel` по-прежнему получает `canPublish` от роли, а
запись в audit log делает backend.

## 6. Чего checklist не покрывает

- Dark theme не сканируется axe: консоль стартует в светлой теме, и переключение
  темы — отдельный сценарий.
- Phone-редактирование вне scope по §11; проверены desktop 1280 px и планшет.
- Backend-часть optimistic concurrency проверяется backend-набором, не здесь:
  консольные тесты доказывают, что заголовок уходит и что `409` не приводит к
  повторной записи.
