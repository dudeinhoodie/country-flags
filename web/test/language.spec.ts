import { describe, expect, it } from "vitest";
import {
  chooseLocale,
  documentsFor,
  isDocumentSlug,
} from "../src/documents/documents";
import type { DocumentIndex } from "../src/documents/documents";
import {
  normalizeLanguage,
  uiLanguageOf,
  withLanguage,
} from "../src/i18n/language";
import { formatDate, stringsFor } from "../src/i18n/strings";

const index: DocumentIndex = {
  generatedAt: "2026-09-15T10:00:00Z",
  documents: [
    {
      slug: "privacy",
      locale: "en",
      title: "Privacy Policy",
      version: 2,
      publishedAt: "2026-09-15T10:00:00Z",
    },
    {
      slug: "privacy",
      locale: "ru",
      title: "Политика конфиденциальности",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
    {
      slug: "terms",
      locale: "en",
      title: "Terms of Use",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
    {
      slug: "attribution",
      locale: "de",
      title: "Quellen",
      version: 1,
      publishedAt: "2026-09-15T10:00:00Z",
    },
  ],
};

describe("normalizeLanguage", () => {
  it("keeps the base language of whatever the app passed", () => {
    expect(normalizeLanguage("ru")).toBe("ru");
    expect(normalizeLanguage("ru-RU")).toBe("ru");
    expect(normalizeLanguage("ru_RU")).toBe("ru");
    expect(normalizeLanguage("RU")).toBe("ru");
    expect(normalizeLanguage(" en-GB ")).toBe("en");
  });

  it("falls back to English for nothing or nonsense", () => {
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("")).toBe("en");
    expect(normalizeLanguage("1234")).toBe("en");
    expect(normalizeLanguage("<script>")).toBe("en");
  });

  it("uses the English dictionary for a language the page does not speak", () => {
    expect(uiLanguageOf("ru")).toBe("ru");
    expect(uiLanguageOf("de")).toBe("en");
    expect(stringsFor("de").documents).toBe("Documents");
    expect(stringsFor("ru").documents).toBe("Документы");
  });
});

describe("withLanguage", () => {
  it("forwards the parameter exactly as it arrived", () => {
    expect(withLanguage("/privacy", "ru-RU")).toBe("/privacy?lang=ru-RU");
    expect(withLanguage("/", null)).toBe("/");
    expect(withLanguage("/", "")).toBe("/");
  });
});

describe("chooseLocale", () => {
  it("serves the reader's edition when it is published", () => {
    expect(chooseLocale(index, "privacy", "ru")).toBe("ru");
  });

  it("falls back to English when the reader's edition is not", () => {
    expect(chooseLocale(index, "terms", "ru")).toBe("en");
  });

  it("falls back to whatever is published when English is not either", () => {
    expect(chooseLocale(index, "attribution", "ru")).toBe("de");
  });

  it("answers null for a slug nobody published", () => {
    expect(chooseLocale(index, "cookies", "en")).toBeNull();
  });
});

describe("documentsFor", () => {
  it("lists one edition per slug, in the reader's language where it exists", () => {
    expect(
      documentsFor(index, "ru").map((entry) => [entry.slug, entry.locale]),
    ).toEqual([
      ["privacy", "ru"],
      ["terms", "en"],
      ["attribution", "de"],
    ]);
  });
});

describe("isDocumentSlug", () => {
  it("accepts the shapes the console can publish and nothing else", () => {
    expect(isDocumentSlug("privacy")).toBe(true);
    expect(isDocumentSlug("account-deletion")).toBe(true);
    expect(isDocumentSlug("Privacy")).toBe(false);
    expect(isDocumentSlug("../index")).toBe(false);
    expect(isDocumentSlug("")).toBe(false);
  });
});

describe("formatDate", () => {
  it("writes the date the way the reader's language does", () => {
    expect(formatDate("2026-09-15T10:00:00Z", "en")).toBe("September 15, 2026");
    expect(formatDate("2026-09-15T10:00:00Z", "ru")).toBe(
      "15 сентября 2026 г.",
    );
  });

  it("leaves a date it cannot read alone", () => {
    expect(formatDate("soon", "en")).toBe("soon");
  });
});
