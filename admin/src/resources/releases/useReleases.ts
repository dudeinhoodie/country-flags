import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

export type ReleaseRun = components["schemas"]["AdminReleaseRun"];
export type ReleaseRunState = components["schemas"]["AdminReleaseRunState"];
export type ContentRelease = components["schemas"]["AdminContentRelease"];

/** How often a run in flight is asked where it got to. */
const POLL_INTERVAL_MS = 4000;

function messageOf(error: unknown, fallback: string): string {
  const envelope = error as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

/** Whether the run is one the screen should keep watching. */
export function isInFlight(run: ReleaseRun | null): boolean {
  return run !== null && (run.status === "QUEUED" || run.status === "RUNNING");
}

/**
 * What is live, what is in flight, and what happened last.
 *
 * A run outlives the browser tab — the work is a job with its own credentials
 * (ADR-017 §2) — so this polls rather than holding a connection open: closing
 * the console does not stop a release, and reopening it finds the same run
 * wherever it got to.
 *
 * The poll runs only while something is in flight. A finished release should
 * not have the console asking after it every four seconds forever.
 */
export function useReleaseRuns(): {
  state: ReleaseRunState | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [state, setState] = useState<ReleaseRunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const watching = isInFlight(state?.current ?? null);

  useEffect(() => {
    let cancelled = false;
    const read = (): void => {
      client
        .GET("/v1/admin/content/releases/runs")
        .then(({ data, error: apiError }) => {
          if (cancelled) {
            return;
          }
          if (data === undefined) {
            setError(
              messageOf(apiError, "The release state could not be read"),
            );
          } else {
            setError(null);
            setState(data);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError("The release state could not be read");
          }
        });
    };
    read();
    // The timer exists only while something is in flight, and a poll that
    // finds the run still running does not rebuild it: `watching` changes
    // when a run starts or ends, which is exactly when the answer to
    // "should we keep asking" changes.
    const timer = watching ? setInterval(read, POLL_INTERVAL_MS) : null;
    return () => {
      cancelled = true;
      if (timer !== null) {
        clearInterval(timer);
      }
    };
  }, [client, reloadToken, watching]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { state, error, reload };
}

/**
 * The releases this deployment applied — which is exactly the set a rollback
 * may return to. Offering the list rather than a text field is what keeps the
 * screen from inviting a typo the API answers with 422.
 */
export function useContentReleases(): {
  releases: ContentRelease[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [releases, setReleases] = useState<ContentRelease[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/releases")
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The releases could not be loaded"));
        } else {
          setError(null);
          setReleases(data.releases);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The releases could not be loaded");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { releases, error, reload };
}

/**
 * The three writes this screen can make.
 *
 * Each answers with a run rather than a result: the console asks for a
 * release, it does not perform one.
 */
export function useReleaseWriter(): {
  publish: (
    contentVersion: string,
    minimumClientVersion: string,
  ) => Promise<ReleaseRun>;
  rollback: (toVersion: string) => Promise<ReleaseRun>;
  cancel: (runId: string) => Promise<ReleaseRun>;
} {
  const client = useAdminApiClient();

  const publish = useCallback(
    async (contentVersion: string, minimumClientVersion: string) => {
      const { data, error } = await client.POST(
        "/v1/admin/content/releases/publish",
        { body: { contentVersion, minimumClientVersion } },
      );
      if (data === undefined) {
        throw new Error(
          messageOf(error, "The publish run could not be queued"),
        );
      }
      return data;
    },
    [client],
  );

  const rollback = useCallback(
    async (toVersion: string) => {
      const { data, error } = await client.POST(
        "/v1/admin/content/releases/rollback",
        { body: { toVersion } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The rollback could not be queued"));
      }
      return data;
    },
    [client],
  );

  const cancel = useCallback(
    async (runId: string) => {
      const { data, error } = await client.POST(
        "/v1/admin/content/releases/runs/{runId}/cancel",
        { params: { path: { runId } } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The run could not be cancelled"));
      }
      return data;
    },
    [client],
  );

  return { publish, rollback, cancel };
}
