import { describe, expect, it, vi } from "vitest";
import {
  DocumentsUnavailableError,
  fetchDocument,
  fetchIndex,
} from "../src/documents/documents";

type FetchInput = Request | string | URL;

function stubFetch(
  answer: (url: string) => Promise<Response>,
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: FetchInput) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return answer(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const missing = (): Response =>
  new Response("<Error><Code>NoSuchKey</Code></Error>", {
    status: 404,
    headers: { "Content-Type": "application/xml" },
  });

describe("fetchIndex", () => {
  it("reads the snapshot the console published", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        Response.json({
          generatedAt: "2026-09-15T10:00:00Z",
          documents: [
            {
              slug: "privacy",
              locale: "en",
              title: "Privacy Policy",
              version: 1,
              publishedAt: "2026-09-15T10:00:00Z",
            },
          ],
        }),
      ),
    );
    const index = await fetchIndex();
    expect(index.documents.map((entry) => entry.slug)).toEqual(["privacy"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/documents/index.json",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });

  it("treats a missing snapshot as nothing published rather than a failure", async () => {
    stubFetch(() => Promise.resolve(missing()));
    await expect(fetchIndex()).resolves.toEqual({
      generatedAt: null,
      documents: [],
    });
  });

  it("refuses a snapshot it cannot read", async () => {
    stubFetch(() => Promise.resolve(Response.json({ documents: "no" })));
    await expect(fetchIndex()).rejects.toBeInstanceOf(
      DocumentsUnavailableError,
    );
  });

  it("reports a dead connection as a failure, not as an empty site", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchIndex()).rejects.toThrow("Failed to fetch");
  });
});

describe("fetchDocument", () => {
  it("asks for the edition by slug and locale", async () => {
    const fetchMock = stubFetch(() =>
      Promise.resolve(
        Response.json({
          slug: "privacy",
          locale: "ru",
          title: "Политика",
          version: 3,
          publishedAt: "2026-09-15T10:00:00Z",
          html: "<p>Текст</p>",
        }),
      ),
    );
    const loaded = await fetchDocument("privacy", "ru");
    expect(loaded?.html).toBe("<p>Текст</p>");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/documents/privacy.ru.json");
  });

  it("answers null for an edition that is not there", async () => {
    stubFetch(() => Promise.resolve(missing()));
    await expect(fetchDocument("privacy", "de")).resolves.toBeNull();
  });

  it("fails on any other answer", async () => {
    stubFetch(() => Promise.resolve(new Response("", { status: 503 })));
    await expect(fetchDocument("privacy", "en")).rejects.toThrow(
      "answered 503",
    );
  });
});
