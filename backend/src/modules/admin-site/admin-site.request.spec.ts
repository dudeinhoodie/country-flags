import {
  parseCreateRequest,
  parseLocale,
  parsePublishRequest,
  parseSlug,
  parseUpdateRequest,
  parseVersionNumber,
} from "./admin-site.request";

function envelopeOf(thrown: unknown): { code: string; details: unknown } {
  const response = (thrown as { getResponse?: () => unknown }).getResponse?.();
  const envelope = (response as { error?: { code: string; details: unknown } })
    ?.error;
  if (envelope === undefined) {
    throw thrown;
  }
  return envelope;
}

function refused(run: () => unknown): { code: string; details: unknown } {
  try {
    run();
  } catch (thrown) {
    return envelopeOf(thrown);
  }
  throw new Error("expected the request to be refused");
}

describe("admin site requests", () => {
  it("accepts a slug that can be a path on the site and nothing else", () => {
    expect(parseSlug("privacy")).toBe("privacy");
    expect(parseSlug("terms-of-use")).toBe("terms-of-use");
    for (const bad of ["Privacy", "-x", "a/b", "a b", "", "a".repeat(64)]) {
      expect(refused(() => parseSlug(bad)).code).toBe("VALIDATION_FAILED");
    }
  });

  it("canonicalises the locale the way the site addresses it", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("ru")).toBe("ru");
    expect(parseLocale("pt-br")).toBe("pt-BR");
    expect(refused(() => parseLocale("english")).code).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("starts a document with a title and an optional body", () => {
    expect(
      parseCreateRequest({ slug: "privacy", locale: "en", title: " Privacy " }),
    ).toEqual({ slug: "privacy", locale: "en", title: "Privacy", body: "" });
    expect(
      refused(() =>
        parseCreateRequest({ slug: "privacy", locale: "en", title: "  " }),
      ).code,
    ).toBe("VALIDATION_FAILED");
    expect(
      refused(() =>
        parseCreateRequest({
          slug: "privacy",
          locale: "en",
          title: "x",
          extra: 1,
        }),
      ).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("requires the revision and at least one change on an update", () => {
    expect(parseUpdateRequest({ revision: 3, body: "# Hi" })).toEqual({
      revision: 3,
      body: "# Hi",
    });
    expect(refused(() => parseUpdateRequest({ revision: 3 })).code).toBe(
      "VALIDATION_FAILED",
    );
    expect(refused(() => parseUpdateRequest({ body: "x" })).code).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      refused(() => parseUpdateRequest({ revision: "3", body: "x" })).code,
    ).toBe("VALIDATION_FAILED");
  });

  it("drops a blank note on publish", () => {
    expect(parsePublishRequest({ revision: 1, note: "  " })).toEqual({
      revision: 1,
    });
    expect(parsePublishRequest({ revision: 1, note: " why " })).toEqual({
      revision: 1,
      note: "why",
    });
  });

  it("reads a version number from the path", () => {
    expect(parseVersionNumber("12")).toBe(12);
    for (const bad of ["0", "-1", "1.5", "abc", ""]) {
      expect(refused(() => parseVersionNumber(bad)).code).toBe(
        "VALIDATION_FAILED",
      );
    }
  });
});
