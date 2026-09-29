# ADR-002: Provider identities and refresh-token rotation

Status: Accepted  
Date: 2026-07-29  
Amended: 2026-09-28 — a replay of the just-rotated refresh token inside a
60-second grace window returns that rotation's pair instead of revoking the
family ([#442](https://github.com/dudeinhoodie/country-flags/issues/442))

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
  `REFRESH_TOKEN_REUSED`. The one exception is a lost response; see the
  amendment below.
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

- Refresh replay detection can invalidate a legitimate client that presents an
  old token after the grace window; the client must sign in again. This is the
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

## Amendment 2026-09-28: grace window for a lost refresh response

### Context

The iOS client keeps its refresh token when a refresh response never arrives
and presents it again later. The access token lives only in memory, so every
cold start refreshes. A lift, a dropped connection or an app suspended while
the request was in flight left the server with a completed rotation the client
never saw, and the next presentation of the old token revoked the family: the
person was signed out for riding a lift (#442).

### Decision

- A refresh token that was rotated at most 60 seconds ago
  (`REFRESH_REPLAY_GRACE_MS`), whose successor has not been used, revoked or
  expired, is answered with the same pair that rotation returned. It is
  audited as `AUTH_REFRESH_REPLAYED`. Nothing is written to the session rows
  and no new successor is created.
- Every other replay keeps the original behaviour: outside the window, or once
  the successor has been rotated or revoked, the whole family is revoked and
  the answer is `REFRESH_TOKEN_REUSED`.
- The successor refresh token is no longer drawn at random. It is
  `HMAC-SHA-384(K, successorId || "." || presentedToken)`, 384 bits like a
  random token, where `K` is derived from `AUTH_ACCESS_TOKEN_SECRET` with HKDF
  under its own label. Only its SHA-256 hash is stored, as before. A replay
  derives it again from the token presented and checks it against the stored
  hash, so the server returns the same token without storing it in any
  recoverable form.
- The access token of a rotation is dated at the rotation (the successor's
  `created_at`) and its `jti` is the successor session id. HS256 is
  deterministic, so the replay re-signs the identical access token, and the
  pair is the same byte for byte.
- Racing presentations of one token are serialised by the row claim and by the
  unique `rotated_from_id`: one request creates the successor, the others see
  it once the first commits and derive the same pair. A family never has two
  live heads.

### Consequences

- A lost response within a minute no longer signs the person out. A client
  that presents the old token later than that, for example on the next launch
  an hour after the app was killed mid-request, is still signed out; widening
  that case would widen the window a stolen token is honoured in.
- Anyone who steals the previous token and presents it inside the window
  receives the live successor instead of triggering revocation. The window is
  bounded, and the moment either holder rotates, the other's next presentation
  revokes the family.
- Reproducing a successor needs the previous token, which only the client
  holds, the successor's row id and the server secret. A database copy alone
  yields nothing usable. Whoever also holds the secret can already sign access
  tokens for any session, so the derivation opens nothing new.
- Rotating `AUTH_ACCESS_TOKEN_SECRET`, or a successor minted before this
  change, only makes the grace path unavailable for rotations of the last
  minute: such a replay is judged as reuse, as it was before.

### Alternatives considered

- Store the successor encrypted with a short TTL: rejected. It adds a
  recoverable copy of a live credential and a cleanup obligation for rows whose
  window has passed, where derivation needs neither.
- Re-issue a fresh successor within the family and invalidate the unseen one:
  rejected. Two racing requests from the same client would each receive a
  different token and the client would keep whichever answer arrived last,
  possibly the invalidated one, which is the sign-out this change removes.
- A longer window that covers the next cold start: rejected for now. It turns
  replay detection into replay acceptance for hours; a client-side retry of the
  refresh before the app is suspended is the better lever.
