import {
  exactRequestKeys,
  requestRecord,
  validationError,
} from "../../common/http/request-validation";

const DELETE_PROGRESS_KEYS = ["confirmation"] as const;
const CONFIRMATION = "DELETE_PROGRESS";

export interface DeleteProgressRequest {
  confirmation: typeof CONFIRMATION;
}

export function parseDeleteProgressRequest(
  value: unknown,
): DeleteProgressRequest {
  const body = requestRecord(value, "body");
  exactRequestKeys(body, DELETE_PROGRESS_KEYS, "body");
  if (body.confirmation !== CONFIRMATION) {
    validationError("body.confirmation", `must be ${CONFIRMATION}`);
  }

  return { confirmation: CONFIRMATION };
}
