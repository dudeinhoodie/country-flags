import { createContext, useCallback, useContext, useEffect } from "react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";

type DraftSummary = components["schemas"]["AdminDraftSummary"];

/**
 * Which draft the console is working in.
 *
 * Nothing is edited outside a draft (§3.4), so the draft is shell state
 * rather than page state: the top bar shows it, the navigation points every
 * editing screen at it, and a screen never has to ask which one it meant.
 */
export interface CurrentDraft {
  /** Every draft, newest change first. */
  drafts: readonly DraftSummary[];
  /** The one being worked in, or null when the deployment has none. */
  draft: DraftSummary | null;
  loading: boolean;
  /** Why the list could not be read, if it could not. */
  error: string | null;
  /** Whether a draft is being created right now. */
  creating: boolean;
  select: (draftId: string) => void;
  reload: () => void;
  /** Starts a draft from the current release and selects it. */
  create: () => Promise<DraftSummary>;
}

const STORAGE_KEY = "country-flags.admin.currentDraft";

const CurrentDraftContext = createContext<CurrentDraft | null>(null);

function readStoredDraftId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // A browser that refuses storage still gets the newest draft.
    return null;
  }
}

function storeDraftId(draftId: string | null): void {
  try {
    if (draftId === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, draftId);
    }
  } catch {
    // Remembering the choice is a convenience, not a requirement.
  }
}

function messageOf(payload: unknown, fallback: string): string {
  const envelope = payload as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

export function CurrentDraftProvider({ children }: { children: ReactNode }) {
  const client = useAdminApiClient();
  const [drafts, setDrafts] = useState<readonly DraftSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(
    readStoredDraftId,
  );
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts", { params: { query: { limit: 50 } } })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        setLoading(false);
        if (data === undefined) {
          setError(messageOf(apiError, "The drafts could not be read"));
          return;
        }
        setError(null);
        setDrafts(data.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoading(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "The drafts failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  // A remembered draft that has since been merged or deleted must not leave
  // the shell pointing at a 404; the newest one takes over.
  const draft = useMemo(() => {
    if (drafts.length === 0) {
      return null;
    }
    return (
      drafts.find((candidate) => candidate.id === selectedId) ??
      drafts[0] ??
      null
    );
  }, [drafts, selectedId]);

  const select = useCallback((draftId: string) => {
    setSelectedId(draftId);
    storeDraftId(draftId);
  }, []);

  // Re-reading is a token bump the effect watches; the spinner is turned on
  // here rather than inside the effect, where a synchronous setState would
  // cost a cascading render.
  const reload = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  const create = useCallback(async () => {
    setCreating(true);
    try {
      const { data, error: apiError } = await client.POST(
        "/v1/admin/content/drafts",
        {},
      );
      if (data === undefined) {
        throw new Error(messageOf(apiError, "The draft could not be created"));
      }
      setDrafts((current) => [data, ...current]);
      select(data.id);
      return data;
    } finally {
      setCreating(false);
    }
  }, [client, select]);

  const value = useMemo<CurrentDraft>(
    () => ({
      drafts,
      draft,
      loading,
      error,
      creating,
      select,
      reload,
      create,
    }),
    [drafts, draft, loading, error, creating, select, reload, create],
  );

  return (
    <CurrentDraftContext.Provider value={value}>
      {children}
    </CurrentDraftContext.Provider>
  );
}

export function useCurrentDraft(): CurrentDraft {
  const value = useContext(CurrentDraftContext);
  if (value === null) {
    throw new Error("useCurrentDraft is only available inside the admin shell");
  }
  return value;
}

const noRefresh = (): void => undefined;

/**
 * Re-reads the draft list after a write.
 *
 * An editor saving a country has to tell the shell, whose top bar says when
 * the draft was last written. It asks for this rather than for the whole
 * context so that mounting the editor on its own — as its tests do — is not
 * a shell dependency.
 */
export function useRefreshDrafts(): () => void {
  return useContext(CurrentDraftContext)?.reload ?? noRefresh;
}
