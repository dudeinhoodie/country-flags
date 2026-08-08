# API and schema contracts

`openapi.yaml` is the canonical REST API contract for every client. Business
operations are described before implementation and carry one of these extension
values:

- `x-implementation-status: planned` — stable contract, no production route yet;
- `x-implementation-status: implemented` — NestJS route must exist.

The backend E2E suite compares implemented operations with the actual Express
router. A new route without an OpenAPI operation, or an operation incorrectly
marked as implemented, fails CI.

## Enum forward compatibility

Generated clients (including the official Swift OpenAPI Generator) turn `enum`
into a closed type: an unrecognized value makes the whole payload fail to
decode, not just one field. The contract therefore splits string enums in two:

- **Protocol and state values** stay closed `enum`s — `AnswerMode`, `Rating`,
  `SelectionOrigin`, study session `status`, `CardState.state`, review result
  `status`, `MasteryTier`, `AuthProvider`, platform, consent status, request
  bodies. Adding a value to one of them changes the client state machine and is
  a breaking change that requires an API major version bump.
- **Content and taxonomy values owned by the content pipeline** are declared as
  `type: string` with an `x-extensible-enum` list of the values known today:
  `Asset.type`, `Fact.type`, `GeoEntity.kind`, `GeoEntity.recognitionStatus`,
  `Deck.kind`, `ContentChange.resourceType`,
  `StudySessionCard.selectionReason` and `UserSettings.extraFactTypes`. New
  values may ship with a content release without an API version bump.

## Unknown response fields

Response schemas do not set `additionalProperties: false`. A generated client
rejects the whole payload when it meets a field it has never heard of, so one
added field would cost a released app an entire screen rather than one value.
Ignoring unknown fields is also what `docs/02-ios-spec.md` requires of the
client.

Request schemas keep `additionalProperties: false`, and so do the versioned JSON
Schema documents under `schemas/` and the registries: a client must not send a
value it does not understand, and those documents are extended by publishing a
new versioned `$id` rather than by growing in place.

`x-extensible-enum` is documentation and lint input only; it never narrows the
wire format. Clients MUST map an unlisted value onto their own `unknown(String)`
case, keep the surrounding payload, and degrade the affected UI element rather
than dropping the record. Requests stay closed: a client never sends a value it
does not understand.

`swift-client-check/` regenerates a Swift client from the bundle and asserts
both halves of this rule.

## Layout

```text
contracts/
├── openapi.yaml
├── openapi/components.yaml
├── schemas/
│   ├── analytics/
│   ├── configuration/
│   ├── content/
│   └── security/
├── registries/
├── fixtures/
│   └── openapi/           # response fixtures validated against the bundle
├── scripts/
└── swift-client-check/    # generated Swift client + forward-compatibility tests
```

JSON Schemas use Draft 2020-12 and versioned absolute `$id` values. Registry and
security-sensitive documents reject unknown top-level fields. Fixtures and
registries are validated by Ajv, while additional semantic checks enforce:

- unique flag, event and placement keys;
- default-off advertising flags;
- valid placement-to-flag references;
- analytics event/property allowlists;
- registered property types and required fields.

## Commands

From the repository root:

```bash
corepack yarn contracts:lint
corepack yarn contracts:bundle
corepack yarn contracts:schemas
corepack yarn contracts:fixtures
corepack yarn contracts:compat
corepack yarn contracts:check
```

`contracts:fixtures` validates every document in `fixtures/openapi/` against the
component schema it claims to represent, so mock-server payloads cannot drift
from the contract. The Swift check is separate because it needs a Swift 6
toolchain and network access:

```bash
./swift-client-check/run.sh
```

Bundled output is generated in `contracts/dist/` and is not committed.

Compatibility validation compares against `CONTRACT_BASE_REF`, or
`origin/master` locally. A removed OpenAPI operation requires an API major
version bump. Breaking JSON Schema changes require a new versioned `$id`, and
breaking registry changes require `schemaVersion` increment. Existing versioned
schema files cannot be deleted.
