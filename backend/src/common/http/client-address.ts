import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request } from "express";

const UNKNOWN_CLIENT = "unknown-client";

/**
 * Tells Express how many proxies stand in front of the process, so that
 * `request.ip` is the address the outermost trusted proxy accepted the
 * connection from. A hop count rather than `true`: only the entries those
 * proxies appended to X-Forwarded-For are believed, never the ones a caller
 * sent in the header itself.
 */
export function configureTrustedProxies(
  app: NestExpressApplication,
  hops: number,
): void {
  app.set("trust proxy", hops);
}

/**
 * The client address as Express resolves it under the configured hop count.
 * Rate limits and session metadata key on this.
 */
export function clientAddress(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? UNKNOWN_CLIENT;
}

/**
 * The client address `hops` proxies away, resolved exactly like Express does
 * for a numeric `trust proxy`: the socket peer first, then X-Forwarded-For
 * from its right end, stopping at the first untrusted entry. Routes reached
 * through an extra proxy of our own (the admin console's nginx) use this with
 * a larger count than the application-wide one.
 */
export function forwardedClientAddress(request: Request, hops: number): string {
  const forwarded = request.headers["x-forwarded-for"];
  const header = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const addresses = [
    request.socket.remoteAddress ?? UNKNOWN_CLIENT,
    ...(header ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .reverse(),
  ];
  return addresses[Math.min(hops, addresses.length - 1)] ?? UNKNOWN_CLIENT;
}
