import { useEffect, useState } from "react";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";

type ContentStatus = components["schemas"]["AdminContentStatus"];

/**
 * What the clients are being served right now.
 *
 * Every read-only screen says which release it is showing, because "these
 * are the published countries" is only true of one version at a time.
 */
export function useContentStatus(): ContentStatus | null {
  const client = useAdminApiClient();
  const [status, setStatus] = useState<ContentStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/status")
      .then(({ data }) => {
        if (!cancelled && data !== undefined) {
          setStatus(data);
        }
      })
      .catch(() => {
        // The screen still lists what it lists; it just cannot name the
        // release it came from.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return status;
}
