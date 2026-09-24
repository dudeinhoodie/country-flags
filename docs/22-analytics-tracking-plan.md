# Analytics tracking plan: first release

This plan sets out what the first release of Vexi measures, which events
answer each question, and exactly when each event fires. It sits on top of
`docs/06-observability-analytics.md`: the envelope, the registry, the outbox
and the privacy rules there still apply. The provider and the consent model
are decided in ADR-025.

The canonical list of events is `contracts/registries/analytics-events.json`.
An event that is not in the registry is rejected at ingestion, so this plan
changes nothing on its own. Each change reaches the registry, the iOS
`AnalyticsRegistry` and the parity test together, in the implementation issues
listed at the end.

## 1. What the numbers cover

- **Only learners who allowed product analytics.** They are asked once, after
  their first completed session (ADR-025). Anyone who declines, or never
  finishes a session, is invisible here by design.
- **Totals come from App Store Connect:** downloads, installations, active
  devices, crashes. The consent rate is the number of persons in PostHog
  divided by the number of active devices in App Store Connect.
- **Learning outcomes come from the database, not from analytics.** Mastery,
  countries learned and review history are canonical in PostgreSQL
  (`docs/06` §16); analytics describes behaviour, not knowledge.
- **The first session of every learner is missing.** The question is asked
  after it, and nothing from before the answer is kept. An activation funnel
  therefore starts at the first session the learner completed.

## 2. Questions and metrics

| Question | Metric | Built from |
| --- | --- | --- |
| Do new learners come back for a second session? | **Activation:** share of new persons who complete a second session within 48 hours of the consent answer | `consent.granted`, `study.session_completed` |
| How many people use the app? | **DAU / WAU / MAU** of persons with any product event; **stickiness** DAU / MAU | `app.opened` and every product event |
| Do they keep coming back? | **Retention D1 / D7 / D30** by the week of the first event; a return is `app.opened` or `study.session_started` on the day | `app.opened`, `study.session_started` |
| Does the three-hour rhythm work? | Share of `portion.closed_shown` followed by a session within six hours after the portion opens; share of sessions that fell back to `standard` | `portion.closed_shown`, `study.session_started` |
| How do people study? | Sessions per active day, cards per session, mode mix, correct-rate distribution, completion vs. abandonment | `study.session_*` |
| Which decks carry the app? | Sessions and opens per deck | `deck.opened`, `study.session_started` |
| Do guests become accounts? | Funnel from `auth.prompt_shown` to `auth.completed` with `result: success`, by surface; share of active persons who are identified | `auth.prompt_shown`, `auth.completed` |
| Is search used, and does it find things? | Searches per active learner; share with no results, by scope | `search.performed` |
| Do reminders bring people back? | Share of learners with reminders on; sessions started after a reminder was opened | `settings.changed`, `reminder.opened` |

## 3. Conventions

- **Names** are `object.action` in lowercase, past tense or `_shown`/`_viewed`
  for what the learner saw (`study.session_completed`, `auth.prompt_shown`).
- **Properties** are camelCase. Values are enums in lowercase snake case
  wherever a closed set exists. Counts are integers, and anything that would
  be a precise measurement of a person is a bucket.
- **Content identity** is allowed and personal identity is not. `deckCode` (the
  catalogue's code, such as `ALL` or `EUROPE`) is a product question. Which
  countries a person got right is not, and never leaves the database.
- **Never sent:** free text, including search queries; individual reviews;
  which card or country was answered; exact response times; exact
  percentages; account, device or provider identifiers; the user id. This is
  the list from `docs/06` §16 and §21, repeated so nobody has to look for it.
- **Schema versions.** Adding an optional property keeps the version. Removing
  or renaming a property, or making one required, bumps it. The registry keeps
  the old version for as long as released builds send it.
- **Registry support needed:** `deckCode` is a string with a pattern
  (`^[A-Z][A-Z0-9_]{0,39}$`). The registry schema knows only `enumValues`
  today, so the instrumentation issue adds an optional `pattern` (and
  `maxLength`) to property definitions, and the backend enforces it.

### Context on every event

Set by the app, not by each call site: `platform`, `appVersion`, `build`,
`locale` and `featureConfigVersion`, which today is always empty and becomes
the loaded app-config version. The backend adds `authState`
(`guest` | `authenticated`) from the request, and the exporter adds
`$session_id` and `$geoip_disable` (ADR-025).

## 4. Events

**Status** says what has to happen to each event:

- **keep**: correct as it is;
- **fix**: emitted today, but wrongly or incompletely;
- **wire**: registered but never emitted;
- **new**: to be added;
- **dormant**: stays registered and is not emitted in the first release.

### 4.1 App and consent

| Event | Status | Fires when | Properties |
| --- | --- | --- | --- |
| `app.opened` | new | The app becomes active after a cold launch, or returns to the foreground after at least 30 minutes in the background. Not on every scene change. | `launch`: `cold` \| `warm` |
| `consent.granted` | new | The learner allows product analytics, as the first event after the choice. Declining sends nothing, by definition. | `surface`: `prompt` \| `settings` |
| `onboarding.completed` | dormant | There is no onboarding. The app opens straight into guest mode. | `authState` |

### 4.2 Home, catalogue and decks

| Event | Status | Fires when | Properties |
| --- | --- | --- | --- |
| `deck.opened` | wire, v2 | The deck screen appears for a deck, once per visit. | `deckCode`; `source`: `home` \| `catalog` \| `search` |
| `search.performed` | new | The search field is dismissed or cleared after a non-empty query, once per use of the field. Never per keystroke. | `scope`: `catalog` \| `deck`; `results`: `none` \| `some` |
| `card.detail_opened` | keep | The country details sheet opens. | `contentKind` |
| `portion.closed_shown` | new | Home shows that today's portion is done and when the next one opens (`nextPortionAt`, #431), once per appearance of the card. | `waitBucket`: `under_1h` \| `1_2h` \| `2_3h` |

### 4.3 Study

| Event | Status | Fires when | Properties |
| --- | --- | --- | --- |
| `study.session_started` | fix, v2 | A session is dealt or resumed and its first card is on screen. Both runners, self-rated and multiple choice. | `mode`; `requestedCardCount`; `deckCode`; `composition`: `due_only` \| `standard` \| `standard_fallback`; `entry`: `home` \| `deck`; `resumed`: boolean |
| `study.session_completed` | fix, v2 | The summary is built. | `mode`; `deckCode`; `composition`; `requestedCardCount`; `uniqueCardCount`; `reviewCount`; `durationBucket`; `correctRateBucket` |
| `study.session_abandoned` | wire, v2 | The learner closes a session before its summary, with cards still owed. Being sent to the background is not abandoning. | `mode`; `deckCode`; `progressBucket` |
| `achievement.earned` | wire | The app first shows an achievement it has not shown before. The backend decides that it is earned (ADR-016). | `category`; `tier` |

What is fixed in the study events:

- `deckType` is always `system` today. It is replaced by `deckCode`.
- A resumed session is reported as a fresh one, with the requested size
  taken from the resumed cards. `resumed` now says which it was.
- The silent fall-through from `due_only` to `standard` (#431) becomes the
  value `standard_fallback`, and is no longer indistinguishable from a
  standard session.
- `study.session_abandoned` has a reporter (`reportAbandonment`) with no
  caller.

### 4.4 Account

| Event | Status | Fires when | Properties |
| --- | --- | --- | --- |
| `auth.prompt_shown` | new | A guest is shown an invitation to sign in, once per appearance. | `surface`: `home` \| `progress` \| `settings` \| `paid_deck` |
| `auth.completed` | fix, v2 | Sign-in finishes, whatever the outcome. | `provider`; `result`: `success` \| `cancelled` \| `failed`; `surface`: `home` \| `progress` \| `settings` \| `account` \| `paid_deck` |

What is fixed: closing the provider sheet or failing before the token
exchange sends nothing today (`AccountStore.swift:236-252`), so the funnel
would show only successes.

Signing out and deleting an account are **not** analytics events. They
change identity (section 5) and have their own audit trail.

### 4.5 Settings and reminders

| Event | Status | Fires when | Properties |
| --- | --- | --- | --- |
| `settings.changed` | new | The learner changes a setting, once per change. | `setting`: `session_size` \| `haptics` \| `reminders`; `value`: `5` \| `10` \| `20` \| `on` \| `off` |
| `reminder.opened` | new | The app is opened from a study reminder notification. This needs a notification delegate, which the app does not have yet. | none |

### 4.6 Not in the first release

- **Commerce** — `paid_deck.impression`, `paid_deck.opened`,
  `paywall.viewed`, `paid_deck.content_loaded`, `paid_deck.study_started`,
  `purchase.*`: dormant. The first release sells nothing, so the storefront
  is off and they do not fire. They stay registered for the paid-deck release
  (`docs/18` §12).
- **`feature.exposed`**: dormant until the first experiment. The recorder
  exists, has no caller, and is the path described in `docs/06` §19.
- **`ad.*`**: not registered. Advertising is off (`docs/07`).

### 4.7 Operational, not product

`sync.completed` and `content.update_completed` keep flowing through the batch
endpoint, but they are **not exported to PostHog** (ADR-025). They are logged,
and their success rates become log-based metrics next to the other health
signals in `docs/20`.

### 4.8 Volume budget

A typical active day is about two `app.opened`, one or two `deck.opened`, two
`study.session_started`, one or two `study.session_completed`, and one or two
of everything else. That is about eight events per active learner per day.
PostHog's free 1M events a month therefore cover about 4,000 consenting daily
learners.

## 5. Identity lifecycle

| Moment | Install id (`anonymousId`) | `distinct_id` at PostHog | Provider action |
| --- | --- | --- | --- |
| Install, nothing answered | Created lazily, nothing sent | — | — |
| Consent granted | Kept | Install id | A person appears with the first event |
| Sign-in | Kept | Analytics subject id | One `$identify` folds the install into the subject, recorded once per pair |
| Sign-out | Rotated | New install id | None; the old person stays with the account's subject |
| Account deletion | Rotated | New install id | The subject's person and its events are deleted (a job with retries) |
| Consent withdrawn | Rotated; queue cleared | — | None. The server stores `DENIED` for an account and purges its pending rows. |

The analytics subject id is `HMAC-SHA256(userId, ANALYTICS_SUBJECT_KEY)` and is
never the user id (ADR-025). A guest's person has no account to delete it by.
It ages out with the 12-month retention.

## 6. The consent prompt

- **When:** after the first completed session, once the summary is dismissed,
  never on top of it. Once per install. It is not shown again after an answer,
  or after it was dismissed without one.
- **What it says:** one sentence on what is collected and why ("how you use
  Vexi, so we can make it better — never your answers"), where it can be
  changed (Settings), and two equal buttons, **Allow** and **Don't allow**.
  Neither is preselected or styled as the default.
- **Before the answer** no product event is queued, and events from the first
  session are not kept to be sent later.
- **An account's choice** is stored on the server and follows the account to
  its other devices. A guest's choice stays on the device and is sent with the
  first sign-in.
- **Enforcement.** The app gates the queue and loads the choice at launch and
  whenever the scope changes. The backend rejects product events from an
  account without `GRANTED`, and from a guest batch that does not declare the
  choice as granted.

Copy for the prompt and the policy text are part of the consent issue. The
policy must name PostHog as a processor, the EU hosting and the 12-month
retention.

## 7. Dashboards

A single dashboard in the production project, **Vexi — first release**:

1. **Activation.** `consent.granted` → `study.session_completed` (the second
   session) within 48 hours.
2. **Active learners.** DAU, WAU and MAU, and stickiness.
3. **Retention.** D1, D7 and D30 by the week of the first event.
4. **Study.** Sessions per active day, `reviewCount` per session, mode mix,
   `correctRateBucket`, and completed vs. abandoned.
5. **Rhythm.** `portion.closed_shown`, returns after it, and the share of
   `standard_fallback` sessions.
6. **Decks.** Opens and sessions by `deckCode`.
7. **Accounts.** `auth.prompt_shown` → successful `auth.completed`, by surface.
8. **Search and reminders.** `search.performed` by scope and results, the
   reminders share, and `reminder.opened`.

Dashboards are provider-side configuration. This section is their
definition, so a lost dashboard can be rebuilt from it.

## 8. Implementation

Tracked in the First release milestone:

- **#454 Backend: PostHog exporter.** Configuration, mapping, operational
  events excluded, deployment wiring.
- **#455 Identity.** Analytics subject id, one merge per pair, rotation, and
  provider deletion on account deletion.
- **#456 Consent.** The prompt, loading at launch, backend enforcement, and the
  privacy policy, privacy manifest and App Store privacy answers.
- **#457 Instrumentation.** The registry changes in section 4, the `pattern`
  support, and every emission site.
- **#458 Setup and dashboards.** The PostHog organisation and projects, keys and
  settings (owner), then the dashboard in section 7.
