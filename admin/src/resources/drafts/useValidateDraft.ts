import { useCallback, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { messageOf } from "../../api/draft-conflict";

/**
 * Runs the server's rules against the draft on demand (§9).
 *
 * Local validation runs as the editor types; the server's runs when it is
 * asked, and before Review. It is a button in every editor rather than a
 * screen of its own, because the answer belongs beside the thing that failed.
 */
export function useValidateDraft(
  draftId: string,
  onValidated: () => void,
): {
  validate: () => void;
  validating: boolean;
  error: string | null;
  dismiss: () => void;
} {
  const client = useAdminApiClient();
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(() => {
    setValidating(true);
    setError(null);
    client
      .POST("/v1/admin/content/drafts/{draftId}/validate", {
        params: { path: { draftId } },
      })
      .then(({ data, error: apiError }) => {
        setValidating(false);
        if (data === undefined) {
          setError(messageOf(apiError, "Validation could not be run"));
          return;
        }
        onValidated();
      })
      .catch(() => {
        setValidating(false);
        setError("Validation could not be run");
      });
  }, [client, draftId, onValidated]);

  return {
    validate,
    validating,
    error,
    dismiss: useCallback(() => {
      setError(null);
    }, []),
  };
}
