# Country Flags Design

## Source of truth

- Status: Draft, ready for paid-deck and admin-redesign implementation
- Last refreshed: 2026-09-05
- Primary product surfaces: iOS learner app and React Admin console
- Evidence reviewed:
  - `docs/16-ios-design-language.md`
  - `docs/adr/ADR-012-dark-scene-design-language.md`
  - `docs/17-paid-decks-storekit.md`
  - `docs/18-multi-content-paid-decks.md`
  - `docs/19-admin-redesign.md`
  - `docs/adr/ADR-014-admin-console-architecture.md`
  - `ios/CountryFlagsKit/Sources/CountryFlagsFeatures/DesignTokens.swift`
  - `ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Design/`
  - `ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Content/CatalogView.swift`
  - `ios/CountryFlagsKit/Sources/CountryFlagsFeatures/Content/DeckDetailsView.swift`

Visual prototypes:

- [Paid deck in Catalog](docs/design/paid-decks/catalog-paid-deck-v1.png)
- [European Coats — approved hero fan / locked paywall](docs/design/paid-decks/locked-paywall-v1.png)
- [Coat-of-arms card — question](docs/design/paid-decks/coat-of-arms-card-front-v1.png)
- [Coat-of-arms card — answer](docs/design/paid-decks/coat-of-arms-card-answer-v1.png)
- [U.S. State Flags — locked deck](docs/design/paid-decks/us-state-flags-deck-v1.png)
- [Unified paid catalog](docs/design/paid-decks/catalog-paid-decks-v2.png)
- [U.S. State Flags — unified locked deck](docs/design/paid-decks/us-state-flags-deck-v2.png)
- [European Coats — unified locked deck](docs/design/paid-decks/european-coats-deck-v2.png)
- [Coat of arms — More details](docs/design/paid-decks/coat-of-arms-more-detail-v1.png)
- [Paid catalog — gold CTA](docs/design/paid-decks/catalog-paid-decks-v3.png)
- [U.S. State Flags — final direction](docs/design/paid-decks/us-state-flags-deck-v3.png)
- [European Coats — final direction](docs/design/paid-decks/european-coats-deck-v3.png)
- [Coat of arms — More details bento](docs/design/paid-decks/coat-of-arms-more-detail-v2.png)
- [Paid catalog — restrained gold CTA](docs/design/paid-decks/catalog-paid-decks-v4.png)
- [U.S. State Flags — restrained final](docs/design/paid-decks/us-state-flags-deck-v4.png)
- [European Coats — restrained final](docs/design/paid-decks/european-coats-deck-v4.png)
- [Coat of arms — restrained facts bento](docs/design/paid-decks/coat-of-arms-more-detail-v3.png)
- [U.S. State Flags — product-preview candidate](docs/design/paid-decks/us-state-flags-deck-v5-product-preview.png)
- [European Coats — product-preview candidate](docs/design/paid-decks/european-coats-deck-v5-product-preview.png)
- [Catalog CTA candidate A — outlined glass](docs/design/paid-decks/catalog-paid-decks-v5-cta-outline.png)
- [Catalog CTA candidate B — action shelf](docs/design/paid-decks/catalog-paid-decks-v5-cta-shelf.png)
- [Catalog CTA candidate C — prismatic glass](docs/design/paid-decks/catalog-paid-decks-v6-prismatic-cta.png)
- [U.S. State Flags — interactive sample candidate](docs/design/paid-decks/us-state-flags-deck-v6-sample-card.png)
- [European Coats — interactive sample candidate](docs/design/paid-decks/european-coats-deck-v6-sample-card.png)
- [European Coats — story spotlight experiment](docs/design/paid-decks/european-coats-deck-v6-story-spotlight.png)
- [European Coats — current minimal paywall](docs/design/paid-decks/european-coats-deck-v7-minimal-paywall.png)
- [U.S. State Flags — carousel preview experiment](docs/design/paid-decks/us-state-flags-deck-v7-carousel-preview.png)
- [U.S. State Flags — editorial preview experiment](docs/design/paid-decks/us-state-flags-deck-v8-editorial-preview.png)
- [European Coats — owned deck list](docs/design/paid-decks/european-coats-owned-list-v1.png)
- [Admin — content workspace](docs/design/admin-redesign/content-workspace-v1.png)
- [Admin — entity media editor](docs/design/admin-redesign/entity-media-editor-v1.png)
- [Admin — deck builder](docs/design/admin-redesign/deck-builder-v1.png)

These images fix the proposed hierarchy and mood, not literal production copy
or asset ownership. SwiftUI implementation remains authoritative for native
glass, Dynamic Type and accessibility behavior.

**Most iOS prototype images are not in version control yet.** They sit in
`docs/design/paid-decks/` in the authoring checkout and come to roughly 43 MB,
against a 69 MB repository. Committing them would be the single largest addition
this repository has taken and cannot be undone without rewriting history, so it
is a deliberate decision rather than a side effect of writing this document.
Until it is made, every link above resolves only on the machine that produced
them. The alternatives are to commit them anyway, to keep a smaller set of the
approved directions and drop the rejected experiments, or to host them outside
the repository and link by URL.

The three admin-redesign references are intentionally kept in version control:
they are the small approved implementation set, not an archive of experiments.

`ADR-012` overrides the historical light/system-theme guidance in
`docs/16-ios-design-language.md`. The active iOS language is an always-dark
scene with native iOS 26 glass, content-led hero elements and a single
high-contrast action per screen.

## Brand

- Personality: curious, calm, crafted, geographic, confident without feeling
  academic or transactional.
- Trust signals: native Apple purchase sheet, transparent one-time wording,
  familiar restore action, visible content scope, no fake discounts or urgency.
- Avoid: casino-like premium gold, crowns and VIP language; storefront grids;
  aggressive sale badges; hidden prices; decorative locks covering country art.

Paid is an access state, not a second brand. A paid deck remains recognisably a
Country Flags deck before and after purchase.

## Product goals

- Goals:
  - let a user understand what a paid deck contains before purchase;
  - make locked, purchasing, pending, owned and unavailable states unambiguous;
  - convert without making the learning catalog feel like a shop;
  - move seamlessly from successful purchase to the existing study flow;
  - preserve trust around one-time price, restore and retained progress.
- Non-goals:
  - a dedicated Store tab in the first release;
  - subscription tiers, virtual currency or limited-time offers;
  - custom payment forms;
  - exposing the full paid card list before entitlement;
  - a separate visual theme for owners.
- Success signals:
  - users identify locked decks from the catalog without opening them;
  - users can explain that the price is one-time before tapping Buy;
  - purchase, pending, cancellation and restore never look like the app froze;
  - an owner reaches Start without relaunching or navigating away;
  - free-deck discovery and study metrics do not regress.

## Personas and jobs

- Primary personas:
  - guest exploring available topics;
  - signed-in free learner considering one specialist deck;
  - owner restoring access on another device;
  - editor configuring a paid deck in admin.
  - content editor maintaining countries, subdivisions and their media;
  - release manager validating and publishing a draft.
- User jobs:
  - inspect a deck, understand its scope and price, buy once, start learning;
  - distinguish content unavailable from network/store unavailable;
  - restore a legitimate previous purchase;
  - publish paid content without accidentally exposing or withdrawing it.
- Key contexts of use: one-handed iPhone use, short sessions, intermittent
  network, Dynamic Type, VoiceOver and an Apple payment interruption.

## Information architecture

- Primary navigation remains unchanged. Paid decks live in the existing Catalog.
- No Store tab is added for the first release.
- Core learner flow:

~~~text
Catalog locked row
  -> Locked deck details
    -> Sign in, if guest
    -> Buy with Apple
      -> Pending | Cancelled | Failed | Verified
      -> Verified: download content
        -> Existing deck details
          -> Start
~~~

- Restore purchases is available both from the locked deck and Account/Settings.
- Purchase history and transaction diagnostics do not appear in the learner app.
- Admin gains Commerce navigation alongside Content, not inside the deck list.
- Admin is organized around a selected draft workspace. Published content is a
  separate read-only view; entity, media and deck editing always happens in the
  visible draft context.

## Design principles

1. **Access, not luxury.** Lock, price and purchase state communicate access.
   They do not recolor the whole deck or imply a superior learning tier.
2. **The deck stays the hero.** The existing silhouette or card fan remains the
   most visually important content. Commerce metadata stays compact.
3. **One promise, one action.** The paywall says what opens, that the payment is
   one-time, and the localized price. The only prominent action is Buy.
4. **Ownership disappears into the product.** After purchase the screen becomes
   the normal deck screen; persistent sales chrome is removed.
5. **Honest state over optimistic copy.** Unknown price, pending approval,
   offline verification and store unavailability are distinct states.
6. **Backend access and visual state agree.** A lock is never only decorative;
   the cards and new study session are protected by entitlement.

Tradeoff: discovery metadata remains visible to non-owners, but the complete
country/card list does not. A small curated preview communicates value without
downloading the paid payload.

## Visual language

- Color: reuse the always-dark `AppScene` and current scene palette. White is
  the primary purchase action. Paid state itself introduces no second theme;
  the compact catalog discovery CTA may use a contained prismatic material
  treatment without recoloring the row or emitting an outer glow.
- Typography: existing `DesignTokens.Typography`; rounded hero numerals may be
  used for card count, not for price. Price uses title/headline hierarchy and
  `.monospacedDigit()` only when layout stability is required.
- Spacing/layout rhythm: existing 4/8/16/24/32 token scale and
  `maximumContentWidth`.
- Shape/radius/elevation: `GlassCard`, continuous radii, native glass controls;
  one elevation level.
- Motion: lock-to-check and CTA replacement use a short semantic transition.
  No looping shimmer or paywall entrance animation.
- Imagery/iconography: existing flag fan/continent silhouette and SF Symbols.
  Use `lock.fill`, `checkmark.circle.fill`, `clock`,
  `arrow.clockwise` and `exclamationmark.triangle` as state symbols.

## Components

### Existing components to reuse

- `AppScene` and `SceneScrollView`
- `GlassCard`
- `SectionLabel`
- `GlassProminentActionStyle` / `PrimaryActionStyle`
- `GlassActionStyle`
- `FlagFanView`
- `ContinentSilhouetteView`
- `ContentStatusBanner`

### New or changed learner components

#### `DeckAccessBadge`

- Compact glass capsule with symbol and short label.
- Locked: a small sparkle + “Платный контент” on a white material capsule that
  visually relates to the purchase action. It is informational and not
  tappable; the purchase card retains the explicit lock/access metaphor.
- Pending: `clock` + “Ожидает”.
- Owned is normally omitted. It may briefly show
  `checkmark.circle.fill` + “Куплено” after a successful transition.
- Never use color alone and never place the badge over flag artwork.

#### `StorePriceView`

- Shows localized `Product.displayPrice` and the text “Разовая покупка”.
- Loading: reserved text area + redaction, not a fake price.
- Unavailable: “Покупка временно недоступна”.
- Price does not come from backend copy.

#### `PaidDeckPreview`

- Reuses the existing fan grammar with up to three explicitly public preview
  assets.
- European Coats uses the approved arrangement: Austria on the left, Poland as
  the centered visual hero, and Czechia on the right. Preserve this order and
  relative scale on both the locked screen and the compact owned-deck header.
- Mixed decks may fan flags and coats, each preserving its own aspect ratio.
- A small lock belongs beside the title, not on top of imagery.

#### Middle panel of the paywall: none

The locked screen goes from the public three-card hero and the short editorial
description straight to the purchase explanation. There is no learning-path,
mechanic-preview, interactive-sample or story-spotlight panel between them.

Four candidates for that slot were built and rejected in design review. They are
kept in **Appendix A** as future A/B material and must not be implemented from
this section.

#### `FeaturedDeckCTA`

A compact catalog-only action on a paid row. Whatever the final treatment, it
holds to these rules:

- it opens the deck details screen and never starts StoreKit;
- it must not dominate the deck title or artwork, and carries no outer glow or
  halo;
- any accent is confined to this one control and does not recolor the badge,
  the row, the paywall or the purchase action;
- any entrance animation runs once, never loops or pulses, and Reduce Motion
  removes it while keeping the static treatment;
- the label keeps WCAG AA contrast in every state.

The filled champagne version was rejected as visually cheap. Three candidates
are open, and **C is the current default** unless review picks otherwise:

- **A** — smoked-glass capsule, fine champagne outline, integrated circular
  chevron. Label `View deck`.
- **B** — inset dark action shelf with a separate champagne chevron control.
  Label `View deck`.
- **C** — wider liquid-glass capsule with a contained
  cobalt-to-indigo-to-plum material bloom, white label and a small integrated
  chevron orb, no metallic or gold fill. Label `Explore deck`.

Picking among them is a visual decision, not an implementation blocker: the
component's contract above is settled, so the surrounding screens can be built
before the treatment is chosen.

#### `PurchaseActionBar`

- Lives in the same bottom safe-area position as the existing Start action.
- Locked and ready: one white prominent “Купить за {price}”.
- Guest: “Войти, чтобы купить”; after sign-in the user returns to the deck and
  explicitly taps Buy.
- Pending: disabled glass action “Ожидает подтверждения”.
- Delivering: “Открываем колоду…” with bounded progress state.
- Owned: replaced by the existing “Начать” action.
- Store unavailable: prominent action is absent; Retry and Restore remain
  secondary.

Interaction contract:

- Tapping the purchase action — “Купить за {price}” in Russian, “Buy for
  {price}” in English — refreshes StoreKit product and eligibility data,
  disables repeat taps and presents the native StoreKit 2 confirmation. It never
  opens a custom payment form. There is no “Unlock” wording: the action says
  plainly that this is a purchase.
- A verified purchase refreshes the backend entitlement, downloads the deck and
  replaces the purchase action with the existing Start action.
- User cancellation returns to the unchanged locked screen without an error.
- Tapping `Restore purchases` calls `AppStore.sync()`, refreshes current
  entitlements and reconciles them with the backend. A matching purchase unlocks
  its deck; no matching purchase produces a neutral informational result.

#### `PurchaseStatusCard`

- Appears only when a state needs explanation: pending, delivery retry,
  refunded/revoked or store unavailable.
- Uses icon + title + short recovery text.
- A cancellation does not create an error card.

### Catalog

The current `GlassCard` row remains intact. A paid row adds:

- `DeckAccessBadge` at the top trailing edge of the text area;
- “Разовая покупка · {price}” below card count/progress;
- full-row navigation to the locked details screen.

Paid decks share one row template under `Featured decks`; free content appears
under `Free decks`. The full paid row and its compact `View deck` action both
open the same details/paywall screen. Neither starts StoreKit directly.

For curated rows the existing flag fan remains trailing; commerce metadata stays
inside the leading text column so badge and fan do not compete.

~~~text
┌────────────────────────────────────────────┐
│ [Europe shape]  Гербы Европы    🔒 Платная │
│                 52 карточки                │
│                 Разовая покупка · 249 ₽    │
│                 ━━━━━━━────────            │
└────────────────────────────────────────────┘
~~~

Free rows do not receive a “Бесплатно” badge; unchanged content should remain
visually quiet.

### Locked deck details

The hierarchy is:

1. deck title and compact access badge;
2. public preview hero;
3. description and card/content summary;
4. one glass purchase explanation;
5. bottom purchase action.

Every paid content type uses this same hierarchy and component set. Content may
change the artwork, counts and ambient accent, but not the paywall layout. There
is no middle feature, learning-path or card-preview panel in the current
direction. Only navigation, purchase and Restore are interactive.

~~~text
‹ Каталог                         🔒 Платная

Гербы Европы
52 карточки · флаги и гербы

       [three-card preview fan]

Изучите официальные гербы стран Европы
и научитесь отличать похожие символы.

┌──────────────────────────────────────┐
│ Разовая покупка              249 ₽   │
│ Доступ остаётся навсегда.            │
│ Покупка привязана к вашему аккаунту. │
│                                      │
│ Восстановить покупки                 │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│           Купить за 249 ₽            │
└──────────────────────────────────────┘
~~~

Do not show a crossed-out price, percent discount, countdown, testimonial,
feature comparison table or repeated Buy buttons in the first release.

### Owned deck

- On verified purchase, lock becomes a check, then disappears.
- The purchase card collapses; content loads into the existing country list.
- The bottom action morphs to the existing Start action.
- Use success haptic and a subtle symbol replacement; no full-screen confetti.
- On future visits the deck looks like any other owned/free deck.
- The owned screen uses a compact title/metadata header and a reduced version of
  the approved three-card fan so the list remains visible above the fold.
- Show a quiet progress readout and native progress track, followed by the
  existing searchable lazy list.
- Each coat row contains an aspect-fit emblem thumbnail, country name, optional
  localized emblem name and standard disclosure chevron. Tapping the row opens
  the existing country-details sheet; it does not start or grade a review.
- The prominent `Start learning` / `Continue` action remains pinned to the
  bottom safe area while the list scrolls.
- Do not show price, lock, restore action, `PAID CONTENT`, an ownership badge or
  other commerce chrome after entitlement has been verified.

### Study cards by content type

The study flow, gestures and progress model stay identical for flags, coats of
arms and future visual content. Only the active card renderer and relevant fact
rows vary by content type.

Renderer selection is a content contract, not a visual guess: SwiftUI selects
the renderer by `templateCode + templateSchemaVersion`. `FLAG_TO_COUNTRY` v1
serves both countries and subdivisions; `COAT_OF_ARMS_TO_COUNTRY` v1 serves
country coats. Deck title, entity kind and asset availability must never be used
to infer the renderer. One country may therefore appear as two independent card
rows with separate progress when a mixed deck explicitly contains both
templates.

#### Coat of arms

- Front: show one emblem centered on a neutral dark card plane. Preserve the
  complete vector bounds and add at least 12% optical inset; never crop a crown,
  supporters, motto ribbon or shield.
- Do not show a country name, flag colors as a full-card background, captions or
  other answer clues on the front.
- Very wide or tall heraldry uses aspect-fit. The card remains 4:3 so the stack
  does not jump between content types.
- Answer: reuse the current country answer card. The first content-specific row
  may identify the symbol or official emblem name; remaining rows use useful
  country facts. The country silhouette remains a low-contrast decoration.
- Decorative gradients and card colors must not modify the heraldic artwork.
  Production uses verified source vectors; generated mock artwork is layout
  reference only.
- `More` presents a scrollable full-screen sheet over the active study session.
  Closing it returns to the same revealed card and does not grade it, advance
  the session or change scheduling state.
- Extended country facts use an editorial bento: a large map/area tile, capital
  and population tiles, followed by a compact currency/language/code strip.
  These tiles are informational; `View on map` is the only navigational row.
- Facts use muted flat symbols, low-contrast graphite hairlines and matte map
  artwork. No fact tile, map or icon uses glow, bloom or neon styling.

#### U.S. state flags

- Model this as a separate deck and entity kind (`subdivision`), scoped to the
  parent country United States. Do not model states as countries or mix their
  progress with the United States country card.
- Deck title: “U.S. State Flags”; subtitle: “United States · 50 cards”. The
  initial release contains the 50 states only; Washington, D.C. and territories
  require an explicit later collection or deck version.
- Front: the state flag fills the existing 4:3 card with aspect-fit/letterbox
  behavior matching country flags. It contains no state-name overlay.
- Answer: state name plus `Capital`, `Admission` and one short `Symbol` fact.
  Optional detail may include region, largest city, motto and a state-outline
  silhouette. Localized values come from structured content, not Swift strings.
- Public paid preview uses exactly three cards so each flag keeps a legible 4:3
  silhouette. The selected set is Washington, California and Texas, with
  California centered as the visual hero. Preview metadata must not unlock the
  underlying study payload.
- Production flag assets must come from verified official or public-domain
  sources and retain source/provenance metadata. The prototype fixes composition,
  not the canonical artwork.

### Admin

- Detailed interaction and layout contract: `docs/19-admin-redesign.md`.
- Reuse React Admin, MUI, generated API client, resource lists, status chips and
  environment badge. Do not introduce a second frontend framework.
- Use a light neutral work canvas, deep-navy navigation and cobalt primary
  actions. Flag and coat artwork provides content color; avoid iOS glass, neon
  and decorative gradients in the data-dense admin surface.
- Keep the selected draft and DEV/PRODUCTION environment visible globally.
- Dashboard becomes a Content workspace with lifecycle, work queue, validation
  summary and recent activity.
- Entity editor treats a state as `SUBDIVISION` in the shared geo-entity model,
  requires a parent country and keeps it out of country-only catalogs.
- Entity editor is tabbed: Overview, Names & locales, Facts, Media, Deck usage
  and History. Raw overrides are not part of the normal workflow.
- Asset editor is contextual to its entity and presents Flag and Coat of arms as
  separate typed slots, each with provenance, validity and localized metadata.
  Editors never type an entity key into the upload flow.
- Asset delivery badges are computed and read-only: Public, Public preview or
  Paid-only. The browser must not recreate access projection rules.
- Deck membership selects a resolved card variant (`entity + template code +
  schema version`), not a bare country row.
- Deck content uses a three-column builder: searchable card library, ordered
  resolved members, and sticky summary with validation/public preview/access.
- Provide bulk recipes for all 50 U.S. subdivisions and all valid European coat
  cards, while preserving explicit resolved membership and editorial order.
- Deck editor gets one Access section: Free or Entitlement required.
- Commerce gets separate Entitlements, Offers, Store products and diagnostics
  resources.
- Production mutations keep the existing confirmation and audit patterns.
- Do not simulate the learner paywall in the form. Provide a read-only compact
  preview of title, count, access badge and public-preview selection.
- Product price is read-only store metadata and is never entered as deck data.
- Use explicit Save with optimistic concurrency and a visible dirty state; do
  not silently autosave or resolve conflicts with last-write-wins.

## Accessibility

- Target: WCAG 2.2 AA intent plus native iOS accessibility conventions.
- Every visual state pairs symbol and text; lock color alone conveys nothing.
- Catalog row is one VoiceOver element: deck, card count, paid state, price and
  progress in that order.
- Purchase price and one-time nature are spoken before the Buy action.
- Buy and Restore remain separate controls with distinct labels.
- Dynamic Type may move the badge below the title and the price onto its own
  line; content never truncates to preserve the fan.
- Reduce Motion replaces lock/CTA morph with a crossfade.
- Increase Contrast must keep glass labels readable against all scene palettes.
- Focus returns to the deck heading after sign-in and to Start after purchase.
- Admin drag/drop has keyboard move actions; validation pairs icon, text and
  field focus target; dialogs/drawers return focus to their initiator.

## Responsive behavior

- Supported devices: iPhone on iOS 26+, from the smallest supported width to
  Pro Max.
- Default size: catalog metadata and badge may share a row.
- Large accessibility sizes: the catalog row becomes a vertical text layout;
  decorative silhouette/fan may shrink but not disappear if it identifies the
  deck.
- Bottom action respects keyboard, safe area and VoiceOver focus.
- No horizontal scrolling.
- Admin targets 1280–1920 px. Below 1280 px the health/summary rail becomes a
  drawer; phone editing is outside the first redesign scope.

## Interaction states

| State | Catalog | Deck details | Bottom action |
| --- | --- | --- | --- |
| Free | Existing row | Existing details | Start |
| Locked + price ready | Lock + price | Preview + purchase card | Buy for price |
| Locked + price loading | Lock + placeholder | Content visible, price loading | Disabled/loading |
| Guest | Lock + price | Purchase value visible | Sign in to buy |
| Purchasing | Unchanged | System sheet owns focus | No duplicate tap |
| Pending | Clock + Pending | Status card | Disabled Pending |
| Delivering entitlement | Check/progress | “Opening deck” | Disabled briefly |
| Owned | Normal row | Existing content | Start |
| Store unavailable | Lock, no fake price | Recovery card | Retry/Restore |
| Offline owner | Normal cached row | Cached accessible content | Start |
| Offline non-owner | Lock | Clear network requirement | Restore when online |
| Refunded/revoked | Lock | Neutral access-ended card; progress retained | Buy/Restore if valid |

Admin interaction states are specified separately in
`docs/19-admin-redesign.md`: clean/dirty/saving/saved, local/server-invalid,
processing asset, revision conflict, draft ready and publish blocked.

## Content voice

- Tone: direct, calm and factual.
- Say “Разовая покупка”, not “Навсегда бесплатно после покупки”.
- Say “Доступ остаётся у вас”, but legal copy remains the authority for refund
  and revocation cases.
- Say “Восстановить покупки”, matching platform convention.
- Cancellation is silent or neutral; never “Платёж не удался” for user cancel.
- Avoid “Premium”, “VIP”, “Лучшее предложение” and artificial urgency.
- Russian and English strings ship together; no commerce copy is hardcoded in a
  SwiftUI view.

## Implementation constraints

- Framework: SwiftUI, StoreKit 2 and existing feature/domain/infrastructure
  boundaries.
- Styling: existing tokens and components; no new UI dependency or second
  design-system layer.
- Price: only StoreKit localized metadata.
- Performance: product metadata loads lazily for visible paid decks; catalog
  scrolling does not wait for all products.
- Security: locked presentation never substitutes backend entitlement checks.
- Assets: paid artwork is not bundled in the app and arrives only after
  purchase, so the owned deck has a real loading state between the verified
  transaction and the first drawn emblem. Design it as content loading, not as
  a spinner over an empty screen.
- Compatibility: iOS 26+, existing dark scene only.
- Tests:
  - SwiftUI previews for every state in the table;
  - UI tests at default and accessibility Dynamic Type;
  - VoiceOver labels/order assertions where practical;
  - screenshots for smallest iPhone and Pro Max;
  - Reduce Motion and Increase Contrast manual release check.
- Admin remains on React Admin 5 + MUI and the existing draft/proposal/release
  architecture. Generated OpenAPI types are authoritative; UI-specific read
  models may be added to the admin contract, but handwritten parallel domain
  DTOs and client-side access-policy duplication are prohibited.
- Admin tests cover route redirects, dirty navigation guard, optimistic
  conflicts, contextual asset upload, keyboard deck ordering, field-addressable
  validation and computed delivery badges.

## Open questions

- [ ] Choose the `FeaturedDeckCTA` treatment among candidates A, B and C;
  owner: product/design; C is the working default, and the choice blocks
  nothing else.
- [ ] Decide whether bundle offers are visible in the first UI or remain
  backend-ready; owner: product; does not block single-deck components.
- [ ] Approve final RU/EN purchase promise and refund wording with legal/store
  metadata; owner: product/legal; blocks release, not prototyping.
- [x] Select the first paid decks and their three public preview assets;
  settled in `docs/18-multi-content-paid-decks.md` §3 — European Coats previews
  Austria, Poland and Czechia with Poland centered, U.S. State Flags previews
  Washington, California and Texas with California centered.
- [x] Capture the current Home and Catalog screens from the Mock release
  simulator for visual comparison; completed 2026-09-04.

## Appendix A — rejected paywall middle panels

These were built, reviewed and rejected. They are recorded so the same ideas are
not re-proposed from scratch, and as material for a later A/B test. Nothing here
is part of the current design; the paywall has no middle panel.

### Rejected: `DeckLearningPath`

- One non-interactive glass surface titled `What you'll master`.
- Three dark glass medallions use quiet tinted rims and softly colored symbols;
  they are connected by one low-contrast cool-to-warm hairline.
- Each step has a symbol, verb and short content-specific noun; it is not a
  button, carousel or navigation control.
- Flags use Recognize / Locate / Remember. Coats use Recognize / Connect /
  Remember. Geometry remains identical across deck types.
- Do not use neon, bloom, particles, cast light or electric saturation. Depth
  comes from native glass reflection, inner highlight, shadow and spacing.

Rejected first, for teaching a vocabulary the product does not otherwise use.
`DeckMechanicPreview` replaced it and was rejected in turn.

### Rejected: `DeckMechanicPreview`

- Shows the real product mechanic inside one non-interactive glass panel:
  miniature question card, restrained flip indicator and miniature answer card.
- Uses the same 4:3 geometry, stack edges, flag/emblem renderer and warm answer
  surface as the study session. It must not introduce a separate illustration
  language.
- The panel title is `Preview a card`; the supporting rhythm is
  `See it · Name it · Remember it`.
- Flags preview the state, capital and admission. Coats preview country, emblem
  name and capital. All preview content is explicit public metadata.
- The icon-heavy count row is removed in this candidate. A two-line editorial
  description states the deck value above the preview.

### Rejected: interactive sample card and story spotlight

Two further experiments filled the same slot: a miniature card the reader could
flip in place, and an editorial spotlight telling the story of one emblem. Both
were rejected for the same reason as the panels above — they delay the purchase
explanation and compete with the hero.
