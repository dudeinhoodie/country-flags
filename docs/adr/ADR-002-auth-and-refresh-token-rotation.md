# ADR-002: Provider identities and refresh-token rotation

Status: Accepted  
Date: 2026-07-29

## Context

Country Flags authenticates users through Apple and Google, but owns the
application session. Provider email, display name and Apple private relay
addresses are mutable attributes and cannot safely identify an account. Access
tokens must be short lived while logout and detected token theft must take
effect server-side.

Provider integration tests also need to be deterministic and must not depend on
Apple or Google network availability.

## Decision

- Verify Apple and Google identity JWTs behind one provider-neutral interface.
  Production adapters use each provider's remote JWK set with bounded cache and
  refresh behaviour, and validate algorithm, signature, issuer, allowlisted
  audience, expiration and subject. Apple additionally validates the SHA-256
  nonce derived from the client `rawNonce`.
- Identify an external identity only by `(provider, providerSubject)`. Email,
  display name and private relay status are metadata and are never account merge
  keys.
- Issue a 15-minute Country Flags JWT containing `sub`, `sessionId`, `iat`,
  `exp`, `jti`, `aud` and `iss`. Every protected request also checks that the
  referenced server-side refresh session and user are still active.
- Issue an opaque 384-bit refresh token. Persist only its SHA-256 hash. Rotate it
  on every refresh and link every replacement through `rotatedFromId` and
  `tokenFamilyId`.
- Treat reuse of a rotated refresh token as evidence of replay. Atomically revoke
  every active session in that token family and return
  `REFRESH_TOKEN_REUSED`.
- Revoke the current session on logout and all active user sessions on
  logout-all. Access tokens become unusable immediately because the auth guard
  checks server-side session state.
- Persist fixed-window auth counters in PostgreSQL. Counter keys and stored IP
  values are keyed hashes, so raw client addresses are not stored.
- Record security audit events without provider subjects, email, credentials or
  tokens.
- In development and test only, use a committed code path that exposes a local
  symmetric JWK and test signer. Production startup rejects this mode and
  requires explicit signing secrets, issuer, audience and Apple/Google client
  allowlists.
- A link request's provider token is the fresh provider proof. No email-based or
  manual merge of two existing accounts is performed. Removing the final
  identity is rejected.

## Consequences

- Refresh replay detection can invalidate a legitimate client if the same old
  token is submitted concurrently; the client must sign in again. This is the
  intended fail-closed behaviour.
- Access-token validation performs a small indexed database lookup so logout and
  family revocation are immediate instead of waiting for JWT expiry.
- Symmetric application JWT signing is appropriate for the current modular
  monolith. Moving verification to independent services would require an ADR and
  asymmetric signing-key rotation.
- Provider test tokens are never accepted in production and CI never needs real
  provider credentials or network calls.

## Alternatives considered

- Merge accounts by verified email: rejected because providers can expose
  aliases, relays and reassigned addresses.
- Store refresh tokens directly: rejected because a database leak would create
  immediately usable credentials.
- Stateless refresh JWTs: rejected because rotation, replay-family revocation
  and logout become harder to enforce reliably.
- Accept test login endpoints in production code: rejected because configuration
  mistakes could create an authentication bypass.
