import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

export type DraftDeck = components["schemas"]["AdminDraftDeck"];
export type DraftDeckDetail = components["schemas"]["AdminDraftDeckDetail"];
export type DeckMembers = components["schemas"]["AdminDeckMembers"];
export type DraftDetail = components["schemas"]["AdminDraftDetail"];

export interface DeckWriteBody {
  kind?: "curated" | "taxonomy";
  names?: Record<string, { name: string; description: string }>;
  members?: DeckMembers;
}

function messageOf(error: unknown, fallback: string): string {
  const envelope = error as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
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
      body: {
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
        throw new Error(messageOf(error, "The deck could not be created"));
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
        throw new Error(messageOf(error, "The deck could not be saved"));
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
        throw new Error(messageOf(error, "The deck could not be removed"));
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
  }, [client, draftId, deckKey]);

  return { deck, error };
}
