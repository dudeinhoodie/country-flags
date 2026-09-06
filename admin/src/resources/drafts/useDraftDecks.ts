import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { draftWriteError, messageOf } from "../../api/draft-conflict";
import type { components } from "../../api/generated/admin-api";

export type DraftDeck = components["schemas"]["AdminDraftDeck"];
export type DraftDeckDetail = components["schemas"]["AdminDraftDeckDetail"];
export type DeckMembers = components["schemas"]["AdminDeckMembers"];
export type DeckAccess = components["schemas"]["AdminDeckAccess"];
export type ResolvedCard = components["schemas"]["AdminDeckResolvedCard"];
export type DraftDetail = components["schemas"]["AdminDraftDetail"];
export type DraftEntityListItem =
  components["schemas"]["AdminDraftEntityListItem"];

/** The deck fields beyond name and membership: templates, access, previews. */
export interface DeckCardFields {
  defaultTemplateCode?: string;
  defaultTemplateSchemaVersion?: number;
  access?: DeckAccess;
  previewCardIds?: string[];
}

export interface DeckWriteBody extends DeckCardFields {
  kind?: "curated" | "taxonomy";
  names?: Record<string, { name: string; description: string }>;
  members?: DeckMembers;
}

/**
 * The draft and its decks are read together: every deck mutation needs the
 * draft's revision for If-Match, so a stale revision is a reload away
 * rather than a lost edit.
 */
export function useDraftWithDecks(draftId: string) {
  const client = useAdminApiClient();
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [decks, setDecks] = useState<DraftDeck[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/content/drafts/{draftId}", {
        params: { path: { draftId } },
      }),
      client.GET("/v1/admin/content/drafts/{draftId}/decks", {
        params: { path: { draftId } },
      }),
    ])
      .then(([draftResult, decksResult]) => {
        if (cancelled) {
          return;
        }
        if (draftResult.data === undefined || decksResult.data === undefined) {
          setError(
            messageOf(
              draftResult.error ?? decksResult.error,
              "The draft could not be loaded",
            ),
          );
          return;
        }
        setError(null);
        setDraft(draftResult.data);
        setDecks(decksResult.data.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "The draft failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, reloadToken]);

  // Re-reading is a token bump rather than a second fetch path: one place
  // owns the request, and the caller cannot start an unmanaged one.
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { draft, decks, error, reload };
}

export function useDeckWriter(draftId: string) {
  const client = useAdminApiClient();

  const create = useCallback(
    async (
      revision: number,
      body: DeckCardFields & {
        key: string;
        kind: "curated" | "taxonomy";
        names: Record<string, { name: string; description: string }>;
        members: DeckMembers;
      },
    ) => {
      const { data, error } = await client.POST(
        "/v1/admin/content/drafts/{draftId}/decks",
        {
          params: {
            path: { draftId },
            header: { "If-Match": String(revision) },
          },
          body,
        },
      );
      if (data === undefined) {
        throw draftWriteError(error, "The deck could not be created");
      }
      return data;
    },
    [client, draftId],
  );

  const update = useCallback(
    async (revision: number, deckKey: string, body: DeckWriteBody) => {
      const { data, error } = await client.PATCH(
        "/v1/admin/content/drafts/{draftId}/decks/{deckKey}",
        {
          params: {
            path: { draftId, deckKey },
            header: { "If-Match": String(revision) },
          },
          body,
        },
      );
      if (data === undefined) {
        throw draftWriteError(error, "The deck could not be saved");
      }
      return data;
    },
    [client, draftId],
  );

  const remove = useCallback(
    async (revision: number, deckKey: string) => {
      const { data, error } = await client.DELETE(
        "/v1/admin/content/drafts/{draftId}/decks/{deckKey}",
        {
          params: {
            path: { draftId, deckKey },
            header: { "If-Match": String(revision) },
          },
        },
      );
      if (data === undefined) {
        throw draftWriteError(error, "The deck could not be removed");
      }
      return data;
    },
    [client, draftId],
  );

  return { create, update, remove };
}

export function useDraftDeck(draftId: string, deckKey: string | undefined) {
  const client = useAdminApiClient();
  const [deck, setDeck] = useState<DraftDeckDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (deckKey === undefined) {
      return;
    }
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/decks/{deckKey}", {
        params: { path: { draftId, deckKey } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The deck could not be loaded"));
        } else {
          setDeck(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "The deck failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, deckKey, reloadToken]);

  // Conflict recovery re-reads the deck at the revision that won, so the form
  // can be reseeded from it rather than saved over it (§9).
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { deck, error, reload };
}

export type CardCandidate = components["schemas"]["AdminCardCandidate"];

export interface CandidateQuery {
  search: string;
  entityType: string;
  parentKey: string;
  assetType: string;
  templateCode: string;
  readiness: "any" | "ready" | "blocked";
}

export const EMPTY_CANDIDATE_QUERY: CandidateQuery = {
  search: "",
  entityType: "",
  parentKey: "",
  assetType: "",
  templateCode: "",
  readiness: "any",
};

/**
 * The cards this deck could hold, searched on the server (#356).
 *
 * A candidate is a pair — an entity and a template that can teach it —
 * because Germany's flag and Germany's coat of arms are two cards with two
 * schedules. Which pairs exist, which are ready and why a row cannot be
 * added are projection rules, and they belong where the projection is
 * defined; a browser deciding them from a list of entities would be a second
 * implementation of the same rules, drifting quietly (§12).
 */
export function useCardCandidates(
  draftId: string,
  deckKey: string | undefined,
  query: CandidateQuery,
  limit = 60,
): { candidates: CardCandidate[] | null; total: number; error: string | null } {
  const client = useAdminApiClient();
  const [candidates, setCandidates] = useState<CardCandidate[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { search, entityType, parentKey, assetType, templateCode, readiness } =
    query;

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      client
        .GET("/v1/admin/content/drafts/{draftId}/card-candidates", {
          params: {
            path: { draftId },
            query: {
              ...(search.trim() === "" ? {} : { search: search.trim() }),
              ...(entityType === ""
                ? {}
                : {
                    entityType: entityType as CardCandidate["entityType"],
                  }),
              ...(parentKey === "" ? {} : { parentKey }),
              ...(assetType === ""
                ? {}
                : {
                    assetType: assetType as
                      | "FLAG"
                      | "COAT_OF_ARMS"
                      | "MAP"
                      | "OTHER",
                  }),
              ...(templateCode === "" ? {} : { templateCode }),
              ...(deckKey === undefined ? {} : { deckKey }),
              readiness,
              limit,
            },
          },
        })
        .then(({ data, error: apiError }) => {
          if (cancelled) {
            return;
          }
          if (data === undefined) {
            setError(messageOf(apiError, "The card library could not be read"));
            return;
          }
          setError(null);
          setCandidates(data.items);
          setTotal(data.total);
        })
        .catch(() => {
          if (!cancelled) {
            setError("The card library could not be read");
          }
        });
      // Typing in the search box must not be one request per keystroke.
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    client,
    draftId,
    deckKey,
    search,
    entityType,
    parentKey,
    assetType,
    templateCode,
    readiness,
    limit,
  ]);

  return { candidates, total, error };
}

/**
 * Everything the draft carries, read once: the deck's own members are named
 * by key, and the list is what turns a key into a name without a request per
 * row. The searchable library comes from `useCardCandidates`.
 */
export function useDraftEntityPool(draftId: string) {
  const client = useAdminApiClient();
  const [entities, setEntities] = useState<DraftEntityListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/entities", {
        params: { path: { draftId } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The entities could not be loaded"));
        } else {
          setEntities(data.items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The entities failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId]);

  return { entities, error };
}

/**
 * The deck codes the active release serves.
 *
 * What is published is what buyers already have, and that decides which
 * commerce fields the editor may still change: an entitlement key is
 * read-only once a deck has shipped against it.
 */
export function usePublishedDeckCodes() {
  const client = useAdminApiClient();
  const [codes, setCodes] = useState<ReadonlySet<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/decks", { params: { query: { limit: 200 } } })
      .then(({ data }) => {
        if (cancelled || data === undefined) {
          return;
        }
        setCodes(
          new Set(
            data.items
              .filter((deck) => deck.status === "PUBLISHED")
              .map((deck) => deck.code),
          ),
        );
      })
      .catch(() => {
        // Not knowing leaves the field editable; the server still refuses
        // an entitlement change on a published deck.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return codes;
}

export interface CommerceContour {
  /** Whether this deployment answers about commerce at all. */
  available: boolean;
  loaded: boolean;
  storeEnvironment: string | null;
  entitlementKeys: ReadonlySet<string>;
  /** Entitlement key → the offers that grant it. */
  offersByEntitlement: ReadonlyMap<string, CommerceOfferSummary[]>;
}

export interface CommerceOfferSummary {
  code: string;
  status: string;
  /** Products verified in the environment this console is looking at. */
  validatedHere: boolean;
}

/**
 * What the storefront looks like from here.
 *
 * The commerce endpoints land with the storefront itself, so the editor
 * treats an answer of "no such endpoint" as "cannot check yet" rather than
 * as "nothing exists": a red cross an operator cannot act on is worse than
 * saying the contour is not wired up.
 */
export function useCommerceContour(): CommerceContour {
  const client = useAdminApiClient();
  const [contour, setContour] = useState<CommerceContour>({
    available: false,
    loaded: false,
    storeEnvironment: null,
    entitlementKeys: new Set<string>(),
    offersByEntitlement: new Map<string, CommerceOfferSummary[]>(),
  });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/commerce/status", {}),
      client.GET("/v1/admin/commerce/entitlements", {}),
      client.GET("/v1/admin/commerce/offers", {}),
    ])
      .then(([status, entitlements, offers]) => {
        if (cancelled) {
          return;
        }
        const environment = status.data?.storeEnvironment ?? null;
        const offersByEntitlement = new Map<string, CommerceOfferSummary[]>();
        for (const offer of offers.data?.items ?? []) {
          const summary: CommerceOfferSummary = {
            code: offer.code,
            status: offer.status,
            validatedHere: offer.products.some(
              (product) =>
                product.storeEnvironment === environment &&
                product.status === "VALIDATED",
            ),
          };
          for (const grant of offer.grants) {
            offersByEntitlement.set(grant, [
              ...(offersByEntitlement.get(grant) ?? []),
              summary,
            ]);
          }
        }
        setContour({
          available:
            status.data !== undefined || entitlements.data !== undefined,
          loaded: true,
          storeEnvironment: environment,
          entitlementKeys: new Set(
            (entitlements.data?.items ?? []).map((item) => item.key),
          ),
          offersByEntitlement,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setContour((current) => ({ ...current, loaded: true }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return contour;
}
