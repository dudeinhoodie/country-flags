import { HttpError } from "react-admin";

interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
  };
}

/**
 * Maps the backend's typed error envelope onto react-admin's HttpError so
 * notifications show the server's message, not a generic failure.
 */
export function toHttpError(status: number, body: unknown): HttpError {
  const envelope = body as ErrorEnvelope | undefined;
  const message =
    envelope?.error?.message ??
    envelope?.error?.code ??
    `Request failed with HTTP ${String(status)}`;
  return new HttpError(message, status, body);
}
