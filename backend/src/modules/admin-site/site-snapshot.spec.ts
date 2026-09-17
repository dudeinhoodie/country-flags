import {
  buildSnapshotIndex,
  serializeSnapshot,
  snapshotDocumentKey,
} from "./site-snapshot";

describe("site snapshot", () => {
  it("names a document file by slug and locale", () => {
    expect(snapshotDocumentKey("privacy", "en")).toBe(
      "documents/privacy.en.json",
    );
    expect(snapshotDocumentKey("terms-of-use", "pt-BR")).toBe(
      "documents/terms-of-use.pt-BR.json",
    );
  });

  it("refuses a key that could leave the documents prefix", () => {
    expect(() => snapshotDocumentKey("../index", "en")).toThrow(
      /cannot name a snapshot file/,
    );
    expect(() => snapshotDocumentKey("privacy", "en/../x")).toThrow(
      /cannot name a snapshot file/,
    );
  });

  it("writes the index in a stable order", () => {
    const index = buildSnapshotIndex(
      [
        {
          slug: "terms",
          locale: "ru",
          title: "Условия",
          version: 2,
          publishedAt: "2026-09-15T10:00:00.000Z",
        },
        {
          slug: "privacy",
          locale: "ru",
          title: "Политика",
          version: 1,
          publishedAt: "2026-09-15T10:00:00.000Z",
        },
        {
          slug: "privacy",
          locale: "en",
          title: "Privacy",
          version: 3,
          publishedAt: "2026-09-15T10:00:00.000Z",
        },
      ],
      new Date("2026-09-15T12:00:00.000Z"),
    );
    expect(index.generatedAt).toBe("2026-09-15T12:00:00.000Z");
    expect(
      index.documents.map((entry) => `${entry.slug}.${entry.locale}`),
    ).toEqual(["privacy.en", "privacy.ru", "terms.ru"]);
  });

  it("serializes to readable JSON with a trailing newline", () => {
    const bytes = serializeSnapshot({ generatedAt: "x", documents: [] });
    expect(bytes.toString("utf8")).toBe(
      '{\n  "generatedAt": "x",\n  "documents": []\n}\n',
    );
  });
});
