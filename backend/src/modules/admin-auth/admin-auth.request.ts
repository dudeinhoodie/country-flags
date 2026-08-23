import {
  exactRequestKeys,
  requestRecord,
  requiredString,
} from "../../common/http/request-validation";

export interface AdminGoogleLoginRequest {
  idToken: string;
}

export function parseAdminGoogleLoginRequest(
  body: unknown,
): AdminGoogleLoginRequest {
  const root = requestRecord(body, "body");
  exactRequestKeys(root, ["idToken"], "body");
  return {
    idToken: requiredString(root.idToken, "idToken", 16, 4_096),
  };
}
