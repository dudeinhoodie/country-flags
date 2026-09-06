/**
 * A client build, reduced to the three numbers that order releases.
 *
 * This is not a semantic-version implementation and must not grow into one.
 * The only question it answers is "which release of the app is this", which
 * is what a compatibility gate needs: whether a build understands a contract
 * is decided by the release it belongs to, never by the letters after it.
 */
export interface ClientVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/**
 * `1`, `1.2` and `1.2.3`, with an optional pre-release or build suffix that
 * is read and discarded.
 *
 * Nine digits a component, so a pasted timestamp cannot become a version that
 * outranks every real one, and a bounded length so a header nobody sent on
 * purpose is refused before the regular expression sees it.
 */
const VERSION_PATTERN =
  /^(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:[-+][0-9A-Za-z.-]{0,32})?$/u;
const MAX_LENGTH = 64;

/**
 * The build a version string names, or null when it names nothing readable.
 *
 * A missing component reads as zero: `1.2` is `1.2.0`, which is how Apple's
 * own `CFBundleShortVersionString` is written when a release has no patch.
 *
 * A suffix is deliberately ignored rather than ordered. Semantic versioning
 * puts `1.4.0-beta.1` below `1.4.0`, and that rule is right for a dependency
 * resolver and wrong here: the TestFlight build of a release carries the
 * release's own marketing version, and a gate that read the suffix would shut
 * out exactly the builds sent to test the feature it guards.
 */
export function parseClientVersion(
  raw: string | undefined | null,
): ClientVersion | null {
  if (typeof raw !== "string") {
    return null;
  }
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_LENGTH) {
    return null;
  }
  const match = VERSION_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
  };
}

/** Negative, zero or positive, as `Array.prototype.sort` expects. */
export function compareClientVersions(
  left: ClientVersion,
  right: ClientVersion,
): number {
  return (
    left.major - right.major ||
    left.minor - right.minor ||
    left.patch - right.patch
  );
}

/** Whether this build is the named release or a later one. */
export function isAtLeast(
  candidate: ClientVersion,
  minimum: ClientVersion,
): boolean {
  return compareClientVersions(candidate, minimum) >= 0;
}

/** The canonical three-number form, for a log line or an error message. */
export function formatClientVersion(version: ClientVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}
