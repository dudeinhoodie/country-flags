# iOS design language

Status: `Draft 0.1`
Applies to: the iOS client in `ios/`, iOS 17+, iPhone only

Dependencies:

- [00-product-spec.md](./00-product-spec.md)
- [02-ios-spec.md](./02-ios-spec.md) — screen flows in section 9, accessibility
  and localization in section 12

## 1. What this document decides

`02-ios-spec.md` says which screens exist, which states each one must handle and
which data it may read. It does not say what the app should feel like, so every
UI work package would otherwise invent its own answer.

This document sets that bar. The quality target in one sentence: a person who
also keeps Flighty and Lumy on their home screen should not feel a drop in craft
when they open Country Flags.

It constrains appearance and interaction only. It never overrides the data,
privacy, offline or accessibility requirements of `02-ios-spec.md`; where the two
disagree, the spec wins and the conflict becomes an open question here.

## 2. References and what to take from each

Three references. None of them is to be cloned — each one contributes a specific
lesson.

### Lumy

- one hero visual per screen carries the state, and quiet supporting text sits
  around it;
- the palette follows context instead of repeating one brand color everywhere;
- generous vertical rhythm; a screen is allowed to be mostly empty;
- large expressive numerals as the primary readout.

Take from it: the confidence to make one element big and let everything else
recede.

### Flighty

- dense information that stays legible through strong hierarchy, monospaced
  digits and consistent units;
- one bespoke hero component surrounded by entirely stock navigation;
- micro-interactions and haptics that confirm every state change;
- dark mode designed on its own terms rather than inverted from light;
- result surfaces a user would want to show someone.

Take from it: how to be data-rich without turning into a spreadsheet, and how a
custom component reads as native when the chrome around it stays stock.

### Apple's own apps — Fitness, Weather, Health, App Store, Journal

- standard navigation, search, sheets, toolbars and settings;
- SF Symbols throughout;
- grouped lists and materials instead of hand-drawn cards with hard shadows;
- Swift Charts for anything quantitative.

Take from it: the chrome. Anything that is not the hero of a screen MUST be a
system component.

## 3. Principles

1. **Native chrome, bespoke heart.** Navigation, tabs, lists, sheets, toolbars,
   search and settings are system components. Each screen may promote at most
   one element to custom drawing.
2. **The flag is the product.** Flag artwork gets the largest, cleanest,
   most-protected area of any screen it appears on.
3. **Content over chrome.** Decoration that carries no state is removed rather
   than refined.
4. **Motion explains.** Every animation reports a state change; none exists to
   be noticed.
5. **Dark mode is designed.** It is reviewed as its own design, not accepted as
   a byproduct of semantic colors.
6. **Accessibility is an input.** A layout that breaks at accessibility Dynamic
   Type sizes is an unfinished layout, not a later bug.
7. **No third-party UI.** Consistent with `AGENTS.md`, a system API always beats
   a dependency; a UI dependency needs an ADR.

## 4. Foundations

### 4.1 Adaptive system design

The deployment target is iOS 17.0 while release builds are produced with a
current SDK. System components therefore render in the current OS design
language on new devices and in the previous one on older devices at no cost —
but only for components the app has not reimplemented. That is the main
practical reason principle 1 exists.

- The app MUST NOT adopt the compatibility opt-out
  (`UIDesignRequiresCompatibility` in `Config/App-Info.plist`). It is absent
  today and stays absent.
- Views MUST NOT hardcode bar heights, bar backgrounds or blur radii to match
  one OS version.
- Custom surfaces SHOULD be built from `.background(.regularMaterial)`,
  `.ultraThinMaterial`, `Capsule` and
  `RoundedRectangle(cornerRadius:style: .continuous)` rather than reproducing a
  specific system material by hand.
- A visual check on the release toolchain is part of release readiness, because
  CI and the authoring Xcode are not pinned to the same major version. See
  section 12.

### 4.2 Color

- Colors MUST come from semantic system colors or the asset catalog. No hex
  literal appears in a view.
- Every custom colorset MUST define light, dark and increased-contrast variants.
  A colorset with only one appearance is a bug.
- The app has exactly one accent, in `AccentColor.colorset`. A second accent
  requires a product decision.
- Surfaces use the grouped background hierarchy;
  text uses `.primary` / `.secondary` / `.tertiary` rather than gray literals.
- Mastery tiers (Bronze, Silver, Gold, Platinum) each get a colorset **and** a
  distinct SF Symbol **and** a label. `02-ios-spec.md` section 12 forbids color
  as the only carrier, and the four tier colors are indistinguishable to a large
  share of users.
- Correct and incorrect answer states MUST pair color with an icon and text.
- Contrast MUST reach 4.5:1 for body text and 3:1 for large text and meaningful
  glyphs, verified in light, dark and increased contrast.
- A gradient MAY be decorative. It MUST NOT be the only thing that carries
  meaning.

### 4.3 Typography

- Text uses system text styles. A view MUST NOT set a fixed point size for
  text. `DesignTokens.Typography` grows by adding named roles.
- Counters, timers, percentages and any number that updates in place MUST use
  `.monospacedDigit()` so the layout does not jitter.
- Display readouts — session progress, mastery, streaks — SHOULD use the
  `.rounded` design; body and labels stay default. That pairing is what makes an
  app read as friendly without a custom font.
- A country name is content, not a label: on the back of a card it takes the
  largest role on screen.
- Country names MUST NOT truncate at default sizes. Allow two lines, then
  `minimumScaleFactor(0.8)`. Long names such as the official form of a state are
  the design case, not the exception.

### 4.4 Layout, spacing and radii

- `DesignTokens.Spacing` is the only source of spacing; a view MUST NOT write a
  bare number. The current 4 / 8 / 16 / 24 / 32 scale stays.
- Corner radii use `.continuous`. Nested surfaces keep their radii matched:
  inner radius equals outer radius minus the padding between them.
- `DesignTokens.Layout.maximumContentWidth` keeps the text measure readable. The
  flag hero is exempt and may span the safe area.
- Every interactive element keeps at least
  `DesignTokens.Layout.minimumTouchTarget` on its smallest side.
- The target is iPhone only. Every screen MUST be verified at the smallest
  supported width (iPhone SE) and at the largest (Pro Max). Neither may need
  horizontal scrolling.

### 4.5 Depth and surfaces

- Prefer grouped lists and materials over free-floating cards.
- When a card is required, it uses a material or the secondary grouped
  background, a continuous radius and either a hairline separator or a soft
  shadow (offset y 2, blur 8, alpha at most 0.08). Hard dark shadows are not
  used.
- At most one elevation level per screen. Stacking cards inside cards is not a
  hierarchy.

### 4.6 Iconography

- SF Symbols only for the MVP; no custom icon set.
- Symbols use hierarchical or palette rendering and match the weight of adjacent
  text.
- Symbol effects (`.bounce`, `.replace`) SHOULD mark state changes and MUST
  degrade under Reduce Motion.

### 4.7 The flag surface

The one bespoke component the whole app shares. It MUST be a single reusable
view, never redrawn per screen.

- The aspect ratio is always preserved with `.fit`. Nothing crops or stretches a
  flag (`02-ios-spec.md` section 9.5).
- It MUST carry an inset hairline border of about `Color.primary.opacity(0.12)`
  in both light and dark. Without it, predominantly white flags — Japan is the
  obvious case — dissolve into the background.
- Continuous corner radius, one radius scale at every size.
- Three sizes: `hero` for the study session, `card` for deck and catalog
  surfaces, `thumb` for rows and results.
- A placeholder state for an asset that has not downloaded keeps the same frame,
  so nothing shifts when the image arrives. `02-ios-spec.md` section 13 requires
  a session to survive a missing asset.
- The flag itself takes no drop shadow; its container may.
- Emoji flags MUST NOT be used as content. They render differently per platform
  and OS version and do not exist for every entity in the catalog.

## 5. Motion

- Springs rather than linear easing: `.snappy` for discrete state changes,
  `.smooth` for continuous ones, `.bouncy` reserved for reward moments — session
  complete, achievement earned.
- Anything the user waits on completes within 0.35 s. A celebration may take up
  to 0.6 s.
- Animation MUST be driven by a state change through `withAnimation` or
  `.animation(_:value:)`, never by a timer.
- The card flip is the app's signature transition. Reduce Motion replaces it
  with a crossfade (`02-ios-spec.md` section 9.5).
- Lists and grids use the system's own transitions.
- No ambient loops, no parallax, no animation that blocks input. Grading buttons
  are hittable as soon as the back of the card is visible.

## 6. Haptics

Haptics are meaning, not texture. They follow the settings toggle from
`02-ios-spec.md` section 9.9 and the system settings, and they are produced
through the `sensoryFeedback` modifier rather than a hand-rolled generator.

| Event                  | Feedback                     |
| ---------------------- | ---------------------------- |
| Reveal the answer      | soft impact                  |
| Correct answer         | success notification         |
| Incorrect answer       | rigid impact                 |
| Session complete       | success notification         |
| Achievement earned     | heavy impact, then success   |

An incorrect answer deliberately does not use the error notification: this is a
learning app, and the failure pattern reads as a reprimand.

Scrolling, appearing and navigating produce no haptics.

## 7. Component vocabulary

Native-first. The right-hand column is a list of things not to build.

| Need                      | Use                                        | Do not build          |
| ------------------------- | ------------------------------------------ | --------------------- |
| Screen navigation         | `NavigationStack` with the typed `AppRoute` | a custom nav bar      |
| Top-level sections        | `TabView`                                   | a custom tab bar      |
| Settings                  | `Form` / inset-grouped `List`               | hand-built rows       |
| Search                    | `.searchable`                               | a custom search field |
| Empty, error, offline     | `ContentUnavailableView`                    | an ad-hoc `VStack`    |
| Modals                    | `.sheet` with detents                       | a full-screen overlay |
| Confirmation              | `.confirmationDialog` / `.alert`            | a custom popup        |
| Progress readout          | `ProgressView`, `Gauge`                     | a custom bar          |
| Grade distribution, trends | Swift Charts                                | hand-drawn bars       |
| Refresh                   | `.refreshable`                              | a custom control      |
| Loading placeholder       | `.redacted(reason: .placeholder)`           | a spinner over content |
| First-run explanation     | TipKit                                      | a custom coach mark   |
| Haptics                   | `.sensoryFeedback`                          | a shared generator    |

TipKit covers the requirement in `02-ios-spec.md` section 9.5 for a short
first-use explanation of the `Again / Hard / Good / Easy` buttons.

The mastery ring on Deck Details is the one place a custom progress shape is
expected, because `Gauge` cannot express tier thresholds.

## 8. Screen direction

Each screen names its hero; everything else stays stock. Screen contents and
required states come from `02-ios-spec.md` section 9 and are not restated here.

- **Home** — hero: the resume-study action with the due count as a large
  numeral. One clear action, deck shortcuts below it, nothing competing.
- **Catalog** — a sectioned list; each deck row carries a flag thumbnail, its
  name and a due badge. Sections follow the catalog groupings. A grid is allowed
  only if it does not turn into a wall of equal-weight tiles.
- **Deck Details** — hero: the mastery ring with the current tier. Session size
  as a segmented control, then a primary button for self-rated study and a
  secondary one for the objective quiz.
- **Study Session** — the flag is the screen. Chrome shrinks to the `3 / 10`
  progress and a close control. Grading buttons live in a fixed bottom bar so
  their position never moves between cards.
- **Objective quiz** — four full-width option rows, each at least 56 pt tall.
  Answer state shows as icon, color and text together.
- **Session Result** — the celebration surface: large numbers, the grade
  distribution as a chart, the mastery delta and any new achievement. Its layout
  should stay compatible with a future share card.
- **Progress and Achievements** — Swift Charts for trends, a medal grid for
  achievements. Locked medals render as outline symbols, distinguishable by
  shape rather than by dimming alone.
- **Settings** — a plain `Form`. No custom styling at all.
- **Onboarding and auth** — the system sign-in buttons in their supported form,
  with no restyling of the Apple button.

## 9. Anti-patterns

Explicitly out of bounds:

- reimplementing navigation, tab bars, search or toolbars;
- hex literals in views, or a color without a dark variant;
- fixed font sizes and fixed row heights that break Dynamic Type;
- text laid over flag artwork, whose contrast cannot be known;
- more than one accent color;
- emoji flags as content;
- hard shadows, heavy borders, skeuomorphic gradients;
- an animated splash screen;
- celebrations that block input;
- third-party UI frameworks;
- polish applied only to the happy path. Loading, empty, offline, stale and
  error states get the same care as the success state.

## 10. Accessibility as a design constraint

The requirements live in `02-ios-spec.md` section 12. What this document adds is
when they are checked: a design is reviewed at the largest accessibility Dynamic
Type size, with VoiceOver, Reduce Motion, Increase Contrast and Bold Text
enabled, before its work package is considered finished — not during IOS-013.
IOS-013 verifies the result; it is not the place where accessibility starts.

## 11. Definition of done for a UI change

A UI pull request is finished when:

- the screen was seen in light and dark;
- it was seen at the smallest and largest supported iPhone widths;
- it was seen at the default and the largest accessibility text size;
- VoiceOver reaches every control in a sensible order and reveals nothing early;
- Reduce Motion leaves the screen usable and every state still readable;
- no hex color, bare spacing number or fixed text size was introduced;
- loading, empty, offline and error states exist and were seen;
- new colors carry light, dark and increased-contrast variants.

## 12. Open decisions

1. The accent color and the wider palette are not chosen. `AccentColor` is a
   placeholder until a product decision.
2. The app icon is not designed.
3. Whether the MVP ships a share card from Session Result is undecided; the
   layout only has to stay compatible with one.
4. CI pins an Xcode major version older than the one the project was authored
   on, so the current system design language is not exercised by CI. Either the
   CI toolchain is raised or release readiness gains an explicit visual check on
   the release toolchain. Tracked against IOS-013.
5. Whether `DesignTokens` grows color, motion and haptic layers in place or
   becomes the `DesignSystem` module named in `02-ios-spec.md` section 3 is
   deferred to the first work package that needs more than one of them.
