import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";

type ContentStatus = components["schemas"]["AdminContentStatus"];
type DraftDetail = components["schemas"]["AdminDraftDetail"];
type DraftDeck = components["schemas"]["AdminDraftDeck"];
type DraftEntity = components["schemas"]["AdminDraftEntityListItem"];
type DraftAsset = components["schemas"]["AdminDraftAsset"];
type ReleaseRunState = components["schemas"]["AdminReleaseRunState"];
type ValidationReport = components["schemas"]["AdminValidationReport"];

export interface WorkspaceData {
  status: ContentStatus | null;
  draft: DraftDetail | null;
  report: ValidationReport | null;
  decks: readonly DraftDeck[];
  entities: readonly DraftEntity[];
  assets: readonly DraftAsset[];
  releases: ReleaseRunState | null;
  loading: boolean;
  /** Set only when the release the workspace is about could not be read. */
  error: string | null;
  reload: () => void;
}

/** Everything one draft contributes, kept together with the id it is for. */
interface DraftSlice {
  draftId: string;
  draft: DraftDetail | null;
  decks: readonly DraftDeck[];
  entities: readonly DraftEntity[];
  assets: readonly DraftAsset[];
}

const NO_DECKS: readonly DraftDeck[] = [];
const NO_ENTITIES: readonly DraftEntity[] = [];
const NO_ASSETS: readonly DraftAsset[] = [];

function messageOf(payload: unknown, fallback: string): string {
  const envelope = payload as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

/**
 * Everything the Content workspace shows, in one pass.
 *
 * Six whole-answer requests rather than a request per row: each endpoint
 * returns a complete list, so the screen composes without an N+1. The
 * aggregated read model that would make it one request is #356; until then
 * the draft panels degrade to empty rather than failing the page, and only
 * the release status can put the screen into an error state.
 *
 * The draft's four answers are held as one slice stamped with the draft it
 * came from, so switching drafts shows nothing stale without an effect
 * having to clear four pieces of state first.
 */
export function useWorkspaceData(draftId: string | null): WorkspaceData {
  const client = useAdminApiClient();
  const [status, setStatus] = useState<ContentStatus | null>(null);
  const [releases, setReleases] = useState<ReleaseRunState | null>(null);
  const [slice, setSlice] = useState<DraftSlice | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/content/status"),
      client.GET("/v1/admin/content/releases/runs"),
    ])
      .then(([statusResult, runsResult]) => {
        if (cancelled) {
          return;
        }
        if (statusResult.data === undefined) {
          setError(
            messageOf(
              statusResult.error,
              "The active release could not be read",
            ),
          );
        } else {
          setError(null);
          setStatus(statusResult.data);
        }
        setReleases(runsResult.data ?? null);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The active release could not be read",
          );
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  useEffect(() => {
    if (draftId === null) {
      return;
    }
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/content/drafts/{draftId}", {
        params: { path: { draftId } },
      }),
      client.GET("/v1/admin/content/drafts/{draftId}/decks", {
        params: { path: { draftId } },
      }),
      client.GET("/v1/admin/content/drafts/{draftId}/entities", {
        params: { path: { draftId } },
      }),
      client.GET("/v1/admin/content/drafts/{draftId}/assets", {
        params: { path: { draftId } },
      }),
    ])
      .then(([draftResult, decksResult, entitiesResult, assetsResult]) => {
        if (cancelled) {
          return;
        }
        setSlice({
          draftId,
          draft: draftResult.data ?? null,
          decks: decksResult.data?.items ?? NO_DECKS,
          entities: entitiesResult.data?.items ?? NO_ENTITIES,
          assets: assetsResult.data?.items ?? NO_ASSETS,
        });
      })
      .catch(() => {
        if (!cancelled) {
          // The draft panels go quiet; the release status above them is
          // still worth showing.
          setSlice({
            draftId,
            draft: null,
            decks: NO_DECKS,
            entities: NO_ENTITIES,
            assets: NO_ASSETS,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, reloadToken]);

  // A slice for a draft that is no longer selected is not this draft's data.
  const current = slice !== null && slice.draftId === draftId ? slice : null;
  const draft = current?.draft ?? null;
  const report = (draft?.validationReport ?? null) as ValidationReport | null;

  return {
    status,
    draft,
    report,
    decks: current?.decks ?? NO_DECKS,
    entities: current?.entities ?? NO_ENTITIES,
    assets: current?.assets ?? NO_ASSETS,
    releases,
    loading,
    error,
    reload,
  };
}
