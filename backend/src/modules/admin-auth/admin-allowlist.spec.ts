import { isEmailAllowlisted, normalizeAdminEmail } from "./admin-allowlist";

describe("normalizeAdminEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeAdminEmail("  Admin@Example.COM ")).toBe(
      "admin@example.com",
    );
  });
});

describe("isEmailAllowlisted", () => {
  const allowlist = ["editor@example.com", "@country-flags.dev"];

  it("matches an exact entry case-insensitively", () => {
    expect(isEmailAllowlisted("Editor@Example.com", allowlist)).toBe(true);
  });

  it("matches a whole-domain entry", () => {
    expect(isEmailAllowlisted("anyone@country-flags.dev", allowlist)).toBe(
      true,
    );
  });

  it("does not match a subdomain against a domain entry", () => {
    expect(isEmailAllowlisted("user@sub.country-flags.dev", allowlist)).toBe(
      false,
    );
  });

  it("rejects other addresses", () => {
    expect(isEmailAllowlisted("viewer@example.com", allowlist)).toBe(false);
    expect(isEmailAllowlisted("editor@example.com.evil", allowlist)).toBe(
      false,
    );
  });

  it("rejects everything on an empty allowlist", () => {
    expect(isEmailAllowlisted("editor@example.com", [])).toBe(false);
  });

  it("rejects values that are not addresses", () => {
    expect(isEmailAllowlisted("", allowlist)).toBe(false);
    expect(isEmailAllowlisted("@country-flags.dev", allowlist)).toBe(false);
    expect(isEmailAllowlisted("editor@", allowlist)).toBe(false);
  });
});
