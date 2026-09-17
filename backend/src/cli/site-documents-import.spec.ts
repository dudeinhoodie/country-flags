import { readSeedFile } from "./site-documents-import";

describe("site documents seed files", () => {
  it("reads the slug and locale from the name and the title from the heading", () => {
    const seed = readSeedFile(
      "/seed/privacy.ru.md",
      "\n# Политика конфиденциальности\n\nПервый абзац.\n\n## Раздел\n\nТекст.\n\n",
    );
    expect(seed).toEqual({
      slug: "privacy",
      locale: "ru",
      title: "Политика конфиденциальности",
      body: "Первый абзац.\n\n## Раздел\n\nТекст.\n",
    });
  });

  it("refuses a file without a title line or a locale", () => {
    expect(() => readSeedFile("/seed/privacy.en.md", "Just text")).toThrow(
      /first line must be/,
    );
    expect(() => readSeedFile("/seed/privacy.md", "# T\n")).toThrow(
      /<slug>.<locale>.md/,
    );
  });
});
