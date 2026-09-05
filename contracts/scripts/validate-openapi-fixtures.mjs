import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";

const contractsRoot = fileURLToPath(new URL("..", import.meta.url));
const bundlePath = join(contractsRoot, "dist/openapi.bundle.yaml");

/**
 * Response fixtures every client (and the iOS mock server) can rely on. Each
 * entry pins one document to the canonical component schema it must satisfy.
 */
const fixtures = [
  ["openapi/auth-session.json", "AuthSession"],
  ["openapi/token-refresh.json", "AuthSession"],
  ["openapi/settings.json", "UserSettings"],
  ["openapi/settings-unknown-fact-type.json", "UserSettings"],
  ["openapi/privacy-settings.json", "PrivacySettings"],
  ["openapi/deck.json", "Deck"],
  ["openapi/deck-paid.json", "Deck"],
  ["openapi/decks.json", "DeckPage"],
  ["openapi/deck-cards.json", "LearningCardPage"],
  ["openapi/entity.json", "GeoEntity"],
  ["openapi/entity-subdivision.json", "GeoEntity"],
  ["openapi/commerce-offers.json", "CommerceOfferList"],
  ["openapi/entitlements.json", "EntitlementSnapshot"],
  ["openapi/content-changes.json", "ContentChangePage"],
  ["openapi/study-session-self-rated.json", "StudySession"],
  ["openapi/study-session-multiple-choice.json", "StudySession"],
  ["openapi/study-session-client-offline.json", "StudySession"],
  ["openapi/study-session-completed.json", "StudySession"],
  ["openapi/review-batch-partial.json", "ReviewBatchResult"],
  ["openapi/user-changes.json", "UserChangePage"],
  ["openapi/progress.json", "ProgressSummary"],
  ["openapi/progress-deletion.json", "ProgressDeletionResult"],
  ["openapi/achievements.json", "AchievementPage"],
  ["openapi/error-envelope.json", "ErrorEnvelope"],
  // Values that do not exist today: the contract must keep accepting them so a
  // content release can add taxonomy values without an API version bump.
  ["openapi/deck-unknown-kind.json", "Deck"],
  ["openapi/entity-unknown-taxonomy.json", "GeoEntity"],
  ["openapi/content-changes-unknown-resource.json", "ContentChangePage"],
];

const bundleSource = await readFile(bundlePath, "utf8").catch(() => {
  throw new Error(
    `${bundlePath} is missing; run "yarn bundle" before validating fixtures.`,
  );
});
const bundle = parseYaml(bundleSource);
const schemas = bundle.components?.schemas ?? {};

// OpenAPI 3.1 schemas are JSON Schema 2020-12 with a few annotation keywords
// the validator only has to ignore.
const ajv = new Ajv2020({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
});
addFormats(ajv);
ajv.addSchema(
  {
    $id: "https://country-flags.app/contracts/openapi/bundle",
    components: { schemas },
  },
  "bundle",
);

const failures = [];
for (const [fixturePath, schemaName] of fixtures) {
  if (schemas[schemaName] === undefined) {
    failures.push(`${fixturePath}: unknown component schema ${schemaName}`);
    continue;
  }

  const validate = ajv.compile({
    $ref: `https://country-flags.app/contracts/openapi/bundle#/components/schemas/${schemaName}`,
  });
  const data = JSON.parse(
    await readFile(join(contractsRoot, "fixtures", fixturePath), "utf8"),
  );
  if (!validate(data)) {
    failures.push(
      `fixtures/${fixturePath} does not match ${schemaName}:\n  - ${ajv
        .errorsText(validate.errors, { separator: "\n  - " })
        .replace(/^data/gu, "")}`,
    );
  }
}

if (failures.length > 0) {
  throw new Error(
    `OpenAPI fixture validation failed:\n\n${failures.join("\n\n")}`,
  );
}

console.log(
  `Validated ${fixtures.length} OpenAPI response fixtures against the bundled contract.`,
);
