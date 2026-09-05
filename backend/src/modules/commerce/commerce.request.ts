import {
  exactRequestKeys,
  requestRecord,
  requiredString,
  validationError,
} from "../../common/http/request-validation";
import { COMMERCE_PLATFORMS, type CommercePlatform } from "./offers.service";

/**
 * A restore submits everything the store currently believes this Apple
 * Account owns, so the batch is a batch by design. The ceiling is the
 * contract's, and the per-item ceiling exists because a JWS carries its own
 * certificate chain: without it a hundred well-formed strings could still be
 * a body nobody meant to send.
 */
const MAX_TRANSACTIONS = 100;
const MAX_SIGNED_TRANSACTION_LENGTH = 8_192;

export function parseCommercePlatform(value: unknown): CommercePlatform {
  if (value === undefined) {
    // iOS is the only client that can buy anything today, and a catalog
    // request without a platform is asking about the store it is running in.
    return "IOS";
  }
  if (
    typeof value !== "string" ||
    !(COMMERCE_PLATFORMS as readonly string[]).includes(value)
  ) {
    validationError(
      "platform",
      `must be one of ${COMMERCE_PLATFORMS.join(", ")}`,
    );
  }
  return value as CommercePlatform;
}

/**
 * Present and plausible, and nothing more is asked of it.
 *
 * What actually makes a resubmission land once is the ledger's unique key
 * over environment and transaction id — a database constraint, as required
 * of every idempotent operation here, rather than a promise a client keeps.
 * The header is still required because the contract requires it, and because
 * it is what ties a retry to its first attempt in the logs.
 */
export function parseIdempotencyKey(value: unknown): string {
  return requiredString(value, "Idempotency-Key", 8, 128);
}

export function parseAppleTransactionSubmission(body: unknown): string[] {
  const request = requestRecord(body, "body");
  exactRequestKeys(request, ["transactions"], "body");

  const items = request.transactions;
  if (!Array.isArray(items)) {
    validationError("transactions", "must be an array");
  }
  if (items.length === 0) {
    validationError("transactions", "must contain at least one transaction");
  }
  if (items.length > MAX_TRANSACTIONS) {
    validationError(
      "transactions",
      `must contain at most ${MAX_TRANSACTIONS} transactions`,
    );
  }

  return items.map((item, index) => {
    const field = `transactions[${index}]`;
    const entry = requestRecord(item, field);
    exactRequestKeys(entry, ["signedTransaction"], field);
    return requiredString(
      entry.signedTransaction,
      `${field}.signedTransaction`,
      1,
      MAX_SIGNED_TRANSACTION_LENGTH,
    );
  });
}

/**
 * Apple's notification, as it arrives: one signed string and nothing else.
 *
 * The envelope is checked the same way a client's submission is — a body
 * with anything else in it is not Apple's, and accepting extra fields here
 * would mean accepting instructions from whoever sent them.
 */
export function parseAppleNotificationEnvelope(body: unknown): string {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["signedPayload"], "body");
  const signedPayload = root.signedPayload;
  if (typeof signedPayload !== "string" || signedPayload.length === 0) {
    validationError("signedPayload", "must be a non-empty string");
  }
  return signedPayload;
}
