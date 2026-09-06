// Imported by the paid-deck suites BEFORE the application module:
// ConfigModule.forRoot validates process.env at import time of app.module.ts,
// so a minimum set inside beforeAll arrives too late to reach the
// ConfigService snapshot and every client would read as too old.
export const originalMinimumClientVersions =
  process.env.PAID_CONTENT_MINIMUM_CLIENT_VERSIONS;

/** The first build this deployment believes understands `Deck.access`. */
export const MINIMUM_CLIENT_VERSION = "2.0.0";

process.env.PAID_CONTENT_MINIMUM_CLIENT_VERSIONS = `ios=${MINIMUM_CLIENT_VERSION}`;

/** A build shipped with StoreKit, the paywall and the locked catalog row. */
export const PAID_AWARE_CLIENT = {
  "X-Client-Platform": "ios",
  "X-Client-App-Version": "2.1.0",
};
/** A build from before any of that existed. */
export const PAID_UNAWARE_CLIENT = {
  "X-Client-Platform": "ios",
  "X-Client-App-Version": "1.9.9",
};
/**
 * Something that will not say what it is: either a build old enough to
 * predate the client headers, or not the app at all. Both get the
 * conservative answer.
 */
export const UNIDENTIFIED_CLIENT: Record<string, string> = {};
