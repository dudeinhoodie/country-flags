export function normalizeAdminEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * An allowlist entry is either a full email address or a whole domain
 * written as "@example.com". Matching is case-insensitive. The allowlist
 * only gates the FIRST sign-in (bootstrap); an existing AdminUser is
 * governed by its status and role from then on.
 */
export function isEmailAllowlisted(
  email: string,
  allowlist: readonly string[],
): boolean {
  const normalized = normalizeAdminEmail(email);
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return false;
  }
  const domainPart = normalized.slice(atIndex);
  return allowlist.some((entry) => {
    const candidate = normalizeAdminEmail(entry);
    if (candidate.startsWith("@")) {
      return domainPart === candidate;
    }
    return normalized === candidate;
  });
}
