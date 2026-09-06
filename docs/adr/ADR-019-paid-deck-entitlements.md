# ADR-019 — Платные колоды: non-consumable StoreKit product выдаёт backend entitlement

- Статус: Принято (2026-09-06). Реализовано: стадии A–D эпика #309 в master —
  контракты, `entitlement`-модель, `DeckAccessService` как единственный гард,
  проверка транзакций Apple, нотификации и реконсиляция, StoreKit на iOS.
- Дата: 2026-09-04
- Полное ТЗ: [17-paid-decks-storekit.md](../17-paid-decks-storekit.md)

## Контекст

Country Flags должен продавать произвольное число отдельных колод. Колода может содержать флаги, гербы и будущие карточки, обновляться после покупки и входить как в индивидуальное предложение, так и в bundle. iOS — первый платёжный клиент, но доступ должен позднее работать на Android/Web.

Прямое поле `appleProductId` на `Deck` связывает content model, магазин и право доступа слишком жёстко:

- один bundle не сможет открыть несколько колод;
- Android потребует второй набор условий в Deck;
- снятие товара с продажи может ошибочно отнять доступ;
- refund, restore и два источника покупки нельзя выразить одним boolean.

## Решение

1. Каждая платная колода требует стабильный `entitlementKey` в собственном
   неймспейсе `entitlement.*`. Он не переиспользует редакционный `deck.*`,
   потому что право доступа MAY пережить колоду, покрыть несколько колод и
   выдаваться другим провайдером, а два почти одинаковых ключа в одном
   неймспейсе неизбежно путаются на review.
2. Разовая iOS-покупка реализуется Apple Non-Consumable IAP.
3. Store product связан с внутренним `CommerceOffer`.
4. Offer выдаёт один или несколько entitlement keys.
5. Backend независимо проверяет Apple JWS и материализует `UserEntitlementGrant`.
6. Доступ активен при наличии хотя бы одного active grant.
7. Price и customer-facing payment sheet принадлежат StoreKit/App Store Connect.
8. Покупка требует Country Flags account и передаёт стабильный `appAccountToken`.
9. Family Sharing, subscriptions и external checkout не входят в первую версию.
10. Feature flag управляет storefront rollout, но не выдаёт и не отзывает entitlement.
11. Общий Entity API и глобальный content change feed являются только публичной
    projection и не меняют ответ в зависимости от пользователя.
12. Paid-only assets выдаются только внутри entitlement-protected deck payload.
    Их representations хранятся в private namespace и скачиваются по
    короткоживущим signed URLs; public preview является явным исключением.
13. Изменение закрытого контента увеличивает `Deck.contentRevision`: locked-клиент
    обновляет только metadata, owner выполняет guarded targeted refresh.

## Драйверы

- соблюдение App Review Guideline 3.1.1 для цифрового контента;
- восстановление покупки и серверная обработка refund/revocation;
- backend enforcement вместо доверия UI;
- возможность bundle и будущих Google Play/Web providers;
- сохранение immutable content-release и текущего progress model.

## Рассмотренные альтернативы

### `Deck.appleProductId` + `User.purchasedDeckIds`

Отклонено: простое начало, но нет bundles, нескольких providers, нескольких grants и корректной refund history.

### Подписка на весь premium catalog

Отклонено для первой версии: пользователь запросил покупку отдельных колод, а recurring billing создаёт expiry, grace period, billing retry и subscription group semantics.

### Consumable credits

Отклонено: пользователь покупает постоянный доступ; расходуемая валюта усложняет restore и может восприниматься как непрозрачная монетизация.

### Внешний Web checkout / Apple Pay

Отклонено для iOS: цифровой контент, открываемый в приложении, продаётся через In-App Purchase. Региональные external-purchase исключения не нужны для baseline и усложняют review/legal.

### Apple product напрямую выдаёт Deck IDs

Отклонено: Deck IDs/content versions — publishing detail, entitlement должен быть стабильной бизнес-границей.

## Последствия

Положительные:

- одна entitlement-модель для iOS/Android/Web;
- bundle без копирования колод;
- refund одного из нескольких grants не обязательно закрывает доступ;
- content колоды можно обновлять без нового Apple product;
- цена и валюта всегда корректно локализованы StoreKit.

Стоимость:

- новые commerce tables и server notification/reconciliation контур;
- отдельная StoreKit persistence migration на iOS;
- App Store Connect становится внешним control plane, который нужно сверять с админкой;
- удаление аккаунта требует безопасного release/reclaim transaction binding;
- каждый индивидуальный product проходит App Store configuration/review lifecycle.

## Инварианты

- Client/UI/feature flag не является источником entitlement.
- Цена не участвует в authorization.
- Store transaction применяется идемпотентно.
- Product/grants, по которым уже были продажи, не уменьшаются.
- Снятый с продажи product продолжает подтверждать права прежних владельцев.
- Sandbox и production полностью разделены.
- Free → paid для опубликованной колоды требует нового code или explicit migration.
- Review/progress пользователя не удаляется только из-за refund.
- Каноническая GeoEntity может содержать paid-only asset, но её публичная
  consumer projection никогда этот asset не раскрывает.
- Asset, используемый хотя бы одной опубликованной FREE-карточкой, является
  публичным для всего content release.
- Paid-only representation не имеет unsigned public URL.

## Follow-up

- отдельный ADR перед Family Sharing;
- отдельный ADR перед subscription/premium catalog;
- Google Play Billing mapping на те же entitlement keys;
- legal/accounting sign-off для transaction retention;
- расширение content pipeline на `COAT_OF_ARMS`, `SUBDIVISION` и card-variant
  membership по [ADR-020](./ADR-020-geo-entities-and-card-variants.md) и
  [полному ТЗ](../18-multi-content-paid-decks.md).
