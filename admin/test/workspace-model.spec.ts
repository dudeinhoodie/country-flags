import { describe, expect, it } from "vitest";
import {
  findingHref,
  lifecycle,
  needsAttention,
  recentActivity,
  stageOfStatus,
  validationSummary,
  workQueue,
} from "../src/app/workspace-model";
import { relativeTime } from "../src/components/relative-time";
import type { components } from "../src/api/generated/admin-api";

type DraftDeck = components["schemas"]["AdminDraftDeck"];
type DraftEntity = components["schemas"]["AdminDraftEntityListItem"];

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

const entities: DraftEntity[] = [
  {
    key: "country.germany",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "UN_MEMBER",
    identifiers: {},
    hasFlag: true,
    hasCoatOfArms: false,
    overrideCount: 0,
    publishedName: "Германия",
    locales: {
      required: ["ru", "en"],
      present: ["ru", "en"],
      missing: [],
      complete: true,
    },
    usedInDeckCount: 1,
    delivery: "PUBLIC",
    blockingCount: 0,
    warningCount: 0,
  },
  {
    key: "country.france",
    type: "country",
    status: "active",
    includeInCountryCatalog: true,
    recognitionStatus: "UN_MEMBER",
    identifiers: {},
    hasFlag: false,
    hasCoatOfArms: true,
    overrideCount: 0,
    publishedName: "Франция",
    locales: {
      required: ["ru", "en"],
      present: ["ru"],
      missing: ["en"],
      complete: false,
    },
    usedInDeckCount: 0,
    delivery: "PUBLIC",
    blockingCount: 0,
    warningCount: 0,
  },
];

function deck(overrides: Partial<DraftDeck>): DraftDeck {
  return {
    key: "deck.sample",
    kind: "curated",
    names: { ru: { name: "Образец", description: "" } },
    membersMode: "explicit",
    members: [],
    memberCount: 0,
    defaultTemplateCode: "FLAG_TO_COUNTRY",
    defaultTemplateSchemaVersion: 1,
    ...overrides,
  };
}

describe("lifecycle", () => {
  it("puts a fresh draft at the editing step", () => {
    const steps = lifecycle({ id: DRAFT_ID, status: "DRAFT" });
    expect(steps.map((step) => step.id)).toEqual([
      "edit",
      "validate",
      "review",
      "publish",
    ]);
    expect(steps[0]?.current).toBe(true);
    expect(steps[0]?.done).toBe(false);
  });

  it("moves a validated draft on to review", () => {
    const steps = lifecycle({ id: DRAFT_ID, status: "READY" });
    expect(steps.find((step) => step.current)?.id).toBe("review");
    expect(steps.filter((step) => step.done).map((step) => step.id)).toEqual([
      "edit",
      "validate",
    ]);
  });

  it("counts a merged draft as finished", () => {
    const steps = lifecycle({ id: DRAFT_ID, status: "MERGED" });
    expect(steps.every((step) => step.done)).toBe(true);
    expect(steps.some((step) => step.current)).toBe(false);
  });

  it("keeps a failed validation at the validate step", () => {
    expect(stageOfStatus("FAILED")).toBe("validate");
  });
});

describe("workQueue", () => {
  it("scores an explicit deck by the drawings its templates need", () => {
    const queue = workQueue(
      DRAFT_ID,
      [
        deck({
          key: "deck.coats",
          members: [
            {
              entityKey: "country.germany",
              templateCode: "COAT_OF_ARMS_TO_COUNTRY",
              templateSchemaVersion: 1,
            },
            {
              entityKey: "country.france",
              templateCode: "COAT_OF_ARMS_TO_COUNTRY",
              templateSchemaVersion: 1,
            },
          ],
          memberCount: 2,
        }),
      ],
      entities,
    );
    expect(queue[0]?.completeness).toBe(50);
    expect(queue[0]?.missingCoats).toBe(1);
    // Germany's flag is present; a coat-of-arms card does not ask for it.
    expect(queue[0]?.missingFlags).toBe(0);
    expect(queue[0]?.readiness).toBe("warning");
    expect(queue[0]?.href).toBe(`/drafts/${DRAFT_ID}/decks/deck.coats`);
  });

  it("counts a member the draft has no entity for", () => {
    const queue = workQueue(
      DRAFT_ID,
      [deck({ members: ["country.atlantis"], memberCount: 1 })],
      entities,
    );
    expect(queue[0]?.unknownMembers).toBe(1);
    expect(queue[0]?.readiness).toBe("blocked");
  });

  it("resolves an all-current deck from the approved catalog", () => {
    const queue = workQueue(
      DRAFT_ID,
      [deck({ membersMode: "all-current", members: "all-current" })],
      entities,
    );
    expect(queue[0]?.cardCount).toBe(2);
    expect(queue[0]?.missingFlags).toBe(1);
  });

  it("leaves a taxonomy deck unresolved rather than guessing", () => {
    const queue = workQueue(
      DRAFT_ID,
      [
        deck({
          membersMode: "taxonomy",
          members: { taxonomy: "region.europe" },
          memberCount: 44,
        }),
      ],
      entities,
    );
    expect(queue[0]?.completeness).toBeNull();
    expect(queue[0]?.readiness).toBe("unresolved");
  });

  it("puts the most broken deck first", () => {
    const queue = workQueue(
      DRAFT_ID,
      [
        deck({ key: "deck.ok", members: ["country.germany"], memberCount: 1 }),
        deck({
          key: "deck.broken",
          members: ["country.france"],
          memberCount: 1,
        }),
      ],
      entities,
    );
    expect(queue.map((item) => item.deckKey)).toEqual([
      "deck.broken",
      "deck.ok",
    ]);
  });

  it("does not report an unknown readiness as missing", () => {
    const unknown = [
      {
        key: "country.germany",
        type: "country",
        status: "active",
        includeInCountryCatalog: true,
        recognitionStatus: "UN_MEMBER",
        identifiers: {},
        overrideCount: 0,
        publishedName: "Германия",
      },
    ] as unknown as DraftEntity[];
    const queue = workQueue(
      DRAFT_ID,
      [deck({ members: ["country.germany"], memberCount: 1 })],
      unknown,
    );
    expect(queue[0]?.missingFlags).toBe(0);
    expect(queue[0]?.completeness).toBe(100);
  });
});

describe("needsAttention", () => {
  it("counts blocked decks and catalog countries with no flag", () => {
    const queue = workQueue(
      DRAFT_ID,
      [deck({ members: ["country.france"], memberCount: 1 })],
      entities,
    );
    expect(needsAttention(queue, entities)).toEqual({
      total: 2,
      decks: 1,
      entities: 1,
    });
  });
});

describe("validationSummary", () => {
  it("groups findings and counts the objects none of them names", () => {
    const summary = validationSummary(
      {
        validatedAt: "2026-09-04T09:31:00Z",
        blocking: 1,
        warnings: 1,
        findings: [
          {
            level: "blocking",
            code: "A",
            subject: "deck.sample",
            message: "broken",
            target: {
              objectType: "deck",
              objectKey: "deck.sample",
              tab: "content",
              field: "/members",
            },
          },
          {
            level: "warning",
            code: "B",
            subject: "country.germany",
            message: "thin",
            target: {
              objectType: "entity",
              objectKey: "country.germany",
              tab: "overview",
              field: null,
            },
          },
        ],
      },
      [deck({})],
      entities,
    );
    expect(summary.errors).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.objects).toBe(3);
    expect(summary.passed).toBe(1);
    expect(summary.issues).toBe(2);
  });

  it("says nothing has been checked when nothing has", () => {
    const summary = validationSummary(null, [deck({})], entities);
    expect(summary.validatedAt).toBeNull();
    expect(summary.issues).toBe(0);
  });
});

describe("findingHref", () => {
  it("opens the deck a deck finding names", () => {
    expect(findingHref(DRAFT_ID, { subject: "deck.europe" })).toBe(
      `/drafts/${DRAFT_ID}/decks/deck.europe`,
    );
  });

  it("opens the entity an entity finding names", () => {
    expect(findingHref(DRAFT_ID, { subject: "country.germany" })).toBe(
      `/drafts/${DRAFT_ID}/entities/country.germany`,
    );
  });

  it("refuses to guess at a subject it does not recognise", () => {
    expect(findingHref(DRAFT_ID, { subject: "the whole catalog" })).toBeNull();
  });

  // The server addresses a finding to an object, a tab and a field, and a
  // link that dropped the last two would leave the reader hunting for it.
  it("opens the tab and the field the server addressed", () => {
    expect(
      findingHref(DRAFT_ID, {
        subject: "subdivision.us.california",
        route: `/drafts/${DRAFT_ID}/entities/subdivision.us.california`,
        target: {
          objectType: "entity",
          objectKey: "subdivision.us.california",
          tab: "overview",
          field: "/parentKey",
        },
      }),
    ).toBe(
      `/drafts/${DRAFT_ID}/entities/subdivision.us.california/overview?field=%2FparentKey`,
    );
  });

  it("keeps a member pointer intact through the query", () => {
    expect(
      findingHref(DRAFT_ID, {
        subject: "deck.europe",
        route: `/drafts/${DRAFT_ID}/decks/deck.europe`,
        target: {
          objectType: "deck",
          objectKey: "deck.europe",
          tab: "content",
          field: "/members/3",
        },
      }),
    ).toBe(
      `/drafts/${DRAFT_ID}/decks/deck.europe/content?field=%2Fmembers%2F3`,
    );
  });

  it("stops at the object when the finding names no field", () => {
    expect(
      findingHref(DRAFT_ID, {
        subject: "deck.europe",
        route: `/drafts/${DRAFT_ID}/decks/deck.europe`,
        target: {
          objectType: "deck",
          objectKey: "deck.europe",
          tab: "access",
          field: null,
        },
      }),
    ).toBe(`/drafts/${DRAFT_ID}/decks/deck.europe/access`);
  });
});

describe("recentActivity", () => {
  const draft = {
    id: DRAFT_ID,
    baseContentVersion: "2026.09.01",
    baseCatalogCommit: "abc1234",
    schemaVersion: 1,
    revision: 3,
    status: "DRAFT",
    proposalUrl: null,
    createdByAdminUserId: "user-1",
    updatedByAdminUserId: "user-1",
    createdAt: "2026-09-04T09:00:00Z",
    updatedAt: "2026-09-04T09:30:00Z",
  } as unknown as components["schemas"]["AdminDraftSummary"];

  it("says who did it, newest first, with somewhere to go", () => {
    const items = recentActivity({
      draft,
      report: {
        validatedAt: "2026-09-04T10:00:00Z",
        blocking: 0,
        warnings: 0,
        findings: [],
      },
      assets: [],
      releases: null,
      viewerId: "user-1",
    });
    expect(items[0]?.kind).toBe("validation");
    expect(items[1]?.title).toBe("You edited the draft");
    expect(items[1]?.href).toBe(`/drafts/${DRAFT_ID}/overview`);
  });

  it("does not claim a colleague's edit as yours", () => {
    const items = recentActivity({
      draft,
      report: null,
      assets: [],
      releases: null,
      viewerId: "someone-else",
    });
    expect(items[0]?.title).toBe("Another editor edited the draft");
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-09-04T12:00:00Z");

  it("reads as an editor would say it", () => {
    expect(relativeTime("2026-09-04T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-09-04T11:58:00Z", now)).toBe("2 minutes ago");
    expect(relativeTime("2026-09-04T11:00:00Z", now)).toBe("1 hour ago");
    expect(relativeTime("2026-09-02T12:00:00Z", now)).toBe("2 days ago");
  });

  it("falls back to a date once the day starts to matter", () => {
    expect(relativeTime("2026-08-01T12:00:00Z", now)).toBe(
      new Date(Date.parse("2026-08-01T12:00:00Z")).toLocaleDateString(),
    );
  });

  it("says nothing rather than something wrong", () => {
    expect(relativeTime(null, now)).toBe("—");
    expect(relativeTime("not a date", now)).toBe("—");
  });
});
