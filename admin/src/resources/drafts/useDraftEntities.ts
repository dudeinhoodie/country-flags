import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { draftWriteError, messageOf } from "../../api/draft-conflict";
import type { components } from "../../api/generated/admin-api";

export type DraftEntityListItem =
  components["schemas"]["AdminDraftEntityListItem"];
export type DraftEntityDetail = components["schemas"]["AdminDraftEntityDetail"];
export type EntityUpdateBody =
  components["schemas"]["AdminDraftEntityUpdateRequest"];
export type EntityFacts = components["schemas"]["AdminEntityFacts"];

export function useDraftEntities(draftId: string) {
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

export function useDraftEntity(draftId: string, entityKey: string | undefined) {
  const client = useAdminApiClient();
  const [detail, setDetail] = useState<DraftEntityDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (entityKey === undefined) {
      return;
    }
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/entities/{entityKey}", {
        params: { path: { draftId, entityKey } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The entity could not be loaded"));
        } else {
          // A read that worked clears the last one that did not: Retry has to
          // be able to bring the screen back, and so does the re-read after a
          // conflict.
          setError(null);
          setDetail(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The entity failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, entityKey, reloadToken]);

  // Conflict recovery re-reads the entity at the revision that won, so the
  // form can be reseeded from it rather than saved over it (§9).
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { detail, error, reload };
}

export function useEntityWriter(draftId: string) {
  const client = useAdminApiClient();

  const update = useCallback(
    async (revision: number, entityKey: string, body: EntityUpdateBody) => {
      const { data, error } = await client.PATCH(
        "/v1/admin/content/drafts/{draftId}/entities/{entityKey}",
        {
          params: {
            path: { draftId, entityKey },
            header: { "If-Match": String(revision) },
          },
          body,
        },
      );
      if (data === undefined) {
        throw draftWriteError(error, "The entity could not be saved");
      }
      return data;
    },
    [client, draftId],
  );

  return { update };
}
