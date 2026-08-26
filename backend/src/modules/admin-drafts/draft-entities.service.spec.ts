import { DraftEntitiesService } from "./draft-entities.service";
import type { AdminDraftsService } from "./admin-drafts.service";
import type { PrismaService } from "../../infrastructure/database/prisma.service";
import type { AdminUser, ContentDraft } from "@prisma/client";

const actor = { id: "admin-1" } as AdminUser;

function entity(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    key: "country.france",
    type: "country",
    status: "active",
    config: { includeInCountryCatalog: true },
    recognitionStatus: "un_member",
    identifiers: { isoAlpha2: "FR" },
    ...overrides,
  };
}

/**
 * The service is exercised through the same `applyDocumentChange` contract
 * the real drafts service exposes: the fake hands the mutate callback the
 * current document and records what came back, which is exactly the seam
 * the optimistic-concurrency wrapper owns in production.
 */
function serviceWith(document: Record<string, unknown>): {
  service: DraftEntitiesService;
  written: () => Record<string, unknown> | null;
} {
  let next: Record<string, unknown> | null = null;
  const drafts = {
    get: () => Promise.resolve({ document } as ContentDraft),
    applyDocumentChange: (
      _actor: AdminUser,
      _draftId: string,
      _revision: number,
      mutate: (current: Record<string, unknown>) => Record<string, unknown>,
    ) => {
      next = mutate(document);
      return Promise.resolve({ document: next } as ContentDraft);
    },
  } as unknown as AdminDraftsService;
  const database = {
    geoEntity: {
      findUnique: () => Promise.resolve(null),
      findMany: () => Promise.resolve([]),
    },
  } as unknown as PrismaService;
  return {
    service: new DraftEntitiesService(database, drafts),
    written: () => next,
  };
}

describe("DraftEntitiesService", () => {
  it("replaces only the fields the editor sent", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { status: "hidden", overrides: { "names.ru.short": "Франция" } },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.status).toBe("hidden");
    expect(stored?.overrides).toEqual({ "names.ru.short": "Франция" });
    // Untouched fields survive the update.
    expect(stored?.identifiers).toEqual({ isoAlpha2: "FR" });
    expect(stored?.type).toBe("country");
  });

  it("stores the flat listing toggle inside the entity's config", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { includeInCountryCatalog: false },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.config).toEqual({ includeInCountryCatalog: false });
    // The flat API field never lands in the document itself.
    expect(stored !== undefined && "includeInCountryCatalog" in stored).toBe(
      false,
    );
  });

  it("drops an emptied overrides map instead of storing {}", async () => {
    const { service, written } = serviceWith({
      entities: [entity({ overrides: { "names.en.short": "Pinned" } })],
    });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { overrides: {} },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    // The schema forbids an empty overrides object; absence is the encoding.
    expect(stored !== undefined && "overrides" in stored).toBe(false);
  });

  it("clears a date field when the editor sends null", async () => {
    const { service, written } = serviceWith({
      entities: [entity({ validTo: "2020-01-01" })],
    });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { validTo: null },
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored !== undefined && "validTo" in stored).toBe(false);
  });

  it("never lets an update move the key", async () => {
    const { service, written } = serviceWith({ entities: [entity()] });
    await service.update(
      actor,
      "draft-1",
      1,
      "country.france",
      { status: "active", key: "country.renamed" } as never,
      "req-1",
    );
    const stored = (written()?.entities as Record<string, unknown>[])[0];
    expect(stored?.key).toBe("country.france");
  });

  it("refuses an entity the draft does not carry", async () => {
    const { service } = serviceWith({ entities: [entity()] });
    await expect(
      service.update(
        actor,
        "draft-1",
        1,
        "country.atlantis",
        { status: "hidden" },
        "req-1",
      ),
    ).rejects.toMatchObject({
      response: { error: { code: "RESOURCE_NOT_FOUND" } },
    });
  });
});
