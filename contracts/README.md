# API and schema contracts

`openapi.yaml` is the canonical REST API contract for every client. Business
operations are described before implementation and carry one of these extension
values:

- `x-implementation-status: planned` — stable contract, no production route yet;
- `x-implementation-status: implemented` — NestJS route must exist.

The backend E2E suite compares implemented operations with the actual Express
router. A new route without an OpenAPI operation, or an operation incorrectly
marked as implemented, fails CI.

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
└── scripts/
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
corepack yarn contracts:compat
corepack yarn contracts:check
```

Bundled output is generated in `contracts/dist/` and is not committed.

Compatibility validation compares against `CONTRACT_BASE_REF`, or
`origin/master` locally. A removed OpenAPI operation requires an API major
version bump. Breaking JSON Schema changes require a new versioned `$id`, and
breaking registry changes require `schemaVersion` increment. Existing versioned
schema files cannot be deleted.
