import { ApiException } from "../../common/http/api.exception";
import {
  parseAssetLocalizations,
  parseDraftAssetPatch,
  parseDraftAssetUpload,
} from "./admin-drafts.request";

function codeOf(act: () => unknown): string {
  try {
    act();
  } catch (error) {
    if (error instanceof ApiException) {
      return (error.getResponse() as { error: { code: string } }).error.code;
    }
    throw error;
  }
  throw new Error("The call was expected to be refused");
}

describe("parseAssetLocalizations", () => {
  it("keeps a symbol's own name and story, per locale", () => {
    expect(
      parseAssetLocalizations(
        {
          en: { displayName: "Federal eagle", description: "Adopted 1950." },
          ru: { displayName: "Федеральный орёл" },
        },
        "localizations",
      ),
    ).toEqual({
      en: { displayName: "Federal eagle", description: "Adopted 1950." },
      ru: { displayName: "Федеральный орёл" },
    });
  });

  it("refuses a locale that says nothing and a tag that is not one", () => {
    expect(codeOf(() => parseAssetLocalizations({ en: {} }, "l"))).toBe(
      "VALIDATION_FAILED",
    );
    expect(
      codeOf(() =>
        parseAssetLocalizations({ "not a locale": { displayName: "x" } }, "l"),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      codeOf(() =>
        parseAssetLocalizations({ en: { title: "wrong key" } }, "l"),
      ),
    ).toBe("VALIDATION_FAILED");
  });
});

describe("parseDraftAssetUpload", () => {
  const required = {
    entityContentKey: "country.germany",
    assetType: "COAT_OF_ARMS",
    sourceUrl: "https://commons.example.test/coat.svg",
    licenseName: "CC0-1.0",
    replacementReason: "The upstream drawing lost its crown.",
  };

  it("carries validity and localizations through the multipart form", () => {
    const parsed = parseDraftAssetUpload({
      ...required,
      variant: "1950",
      validFrom: "1950-09-20",
      // Multipart fields are text, so the map arrives as JSON in one.
      localizations: JSON.stringify({ en: { displayName: "Federal eagle" } }),
    });
    expect(parsed.variant).toBe("1950");
    expect(parsed.validFrom).toBe("1950-09-20");
    expect(parsed.localizations).toEqual({
      en: { displayName: "Federal eagle" },
    });
  });

  it("accepts a map as a type of its own", () => {
    expect(
      parseDraftAssetUpload({ ...required, assetType: "MAP" }).assetType,
    ).toBe("MAP");
  });

  it("refuses a validity that is not a calendar day and localizations that are not JSON", () => {
    expect(
      codeOf(() =>
        parseDraftAssetUpload({ ...required, validFrom: "September 1950" }),
      ),
    ).toBe("VALIDATION_FAILED");
    expect(
      codeOf(() =>
        parseDraftAssetUpload({ ...required, localizations: "{oops" }),
      ),
    ).toBe("VALIDATION_FAILED");
  });
});

describe("parseDraftAssetPatch", () => {
  it("takes provenance, validity and words, one field at a time", () => {
    expect(parseDraftAssetPatch({ validTo: "2026-09-05" })).toEqual({
      validTo: "2026-09-05",
    });
    expect(parseDraftAssetPatch({ attribution: null })).toEqual({
      attribution: null,
    });
    expect(
      parseDraftAssetPatch({
        licenseName: "CC BY-SA 4.0",
        localizations: { ru: { description: "Принят в 1950 году." } },
      }),
    ).toEqual({
      licenseName: "CC BY-SA 4.0",
      localizations: { ru: { description: "Принят в 1950 году." } },
    });
  });

  it("refuses an empty change and anything that would replace the drawing", () => {
    expect(codeOf(() => parseDraftAssetPatch({}))).toBe("VALIDATION_FAILED");
    // New bytes go through the upload; a patch that could set a checksum
    // would be a second, quieter way to change what the reader sees.
    expect(codeOf(() => parseDraftAssetPatch({ sha256: "0".repeat(64) }))).toBe(
      "VALIDATION_FAILED",
    );
    expect(codeOf(() => parseDraftAssetPatch({ assetType: "FLAG" }))).toBe(
      "VALIDATION_FAILED",
    );
  });
});
