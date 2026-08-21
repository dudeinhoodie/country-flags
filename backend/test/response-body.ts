/**
 * Reads a response body as the shape the test expects.
 *
 * Supertest types `body` as `any`, which makes every read of it unsafe and
 * every assertion on it unnecessary — the two lint rules pull in opposite
 * directions, and the double `as unknown as T` that used to satisfy both is
 * exactly what a stricter typescript-eslint now flags. Narrowing to `unknown`
 * in one place leaves a single assertion at each call site: the meaningful
 * one, saying what this endpoint is expected to answer with.
 */
export function bodyOf<T>(response: { body: unknown }): T {
  return response.body as T;
}
