/**
 * Why a signed transaction was not believed.
 *
 * The codes are internal and stable: they name the operational metric, the
 * alert and the support answer, so they must not drift with wording. They are
 * returned to the client as the `reason` of a typed refusal, which is safe —
 * every one of them is a statement about the payload the client itself sent,
 * and none of them says anything about another account.
 */
export const APPLE_VERIFICATION_CODES = [
  /** The JWS did not verify against Apple's root certificates. */
  "SIGNATURE_INVALID",
  /** Signed for a different app than this deployment serves. */
  "APP_IDENTITY_MISMATCH",
  /** Signed in the other store: Sandbox reaching production, or the reverse. */
  "ENVIRONMENT_MISMATCH",
  /** Verified, but missing a field a purchase cannot be recorded without. */
  "PAYLOAD_INCOMPLETE",
  /** The account token in the payload is not a UUID and so binds nothing. */
  "APP_ACCOUNT_TOKEN_INVALID",
  /** Not a one-off purchase; this product model sells nothing else. */
  "PRODUCT_TYPE_UNSUPPORTED",
  /** A Family Sharing copy, and Family Sharing is off in this version. */
  "OWNERSHIP_TYPE_UNSUPPORTED",
  /** Verified, but this deployment sells no such product. */
  "UNKNOWN_PRODUCT",
  /** Apple could not be reached to finish the check; the client may retry. */
  "VERIFICATION_UNAVAILABLE",
  /** This deployment has no store credentials yet and can verify nothing. */
  "STORE_NOT_CONFIGURED",
] as const;

export type AppleVerificationCode = (typeof APPLE_VERIFICATION_CODES)[number];

/**
 * Codes that mean "ask again later" rather than "this will never work". They
 * are the difference between a client that retries a restore and a client
 * that tells a customer their purchase is invalid.
 */
const RETRYABLE = new Set<AppleVerificationCode>([
  "VERIFICATION_UNAVAILABLE",
  "STORE_NOT_CONFIGURED",
]);

/**
 * Carries a code and nothing else, on purpose. The JWS that failed, the
 * transaction it named and the library's own message are all evidence about a
 * purchase, and none of them may reach a log, an error report or a client
 * (docs/17-paid-decks-storekit.md §16).
 */
export class AppleVerificationError extends Error {
  constructor(readonly code: AppleVerificationCode) {
    super(`Apple transaction verification failed: ${code}`);
    this.name = "AppleVerificationError";
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}
