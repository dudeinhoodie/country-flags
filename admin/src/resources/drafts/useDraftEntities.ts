import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

export type DraftEntityListItem =
  components["schemas"]["AdminDraftEntityListItem"];
export type DraftEntityDetail = components["schemas"]["AdminDraftEntityDetail"];
export type EntityUpdateBody =
  components["schemas"]["AdminDraftEntityUpdateRequest"];

function messageOf(error: unknown, fallback: string): string {
  const envelope = error as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

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
  }, [client, draftId, entityKey]);

  return { detail, error };
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
        throw new Error(messageOf(error, "The entity could not be saved"));
      }
      return data;
    },
    [client, draftId],
  );

  return { update };
}
