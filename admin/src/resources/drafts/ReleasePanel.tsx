import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

type ValidationReport = components["schemas"]["AdminValidationReport"];
type DraftDiff = components["schemas"]["AdminDraftDiff"];

const CHANGE_LABEL: Record<string, string> = {
  added: "added",
  removed: "removed",
  changed: "changed",
};

function messageOf(payload: unknown, fallback: string): string {
  const envelope = payload as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

/**
 * The two questions an editor asks before proposing: is it valid, and what
 * would it change. A blocking finding is what stops a proposal, so it is
 * stated rather than counted.
 */
export function ReleasePanel({
  draftId,
  storedReport,
  editable,
  onValidated,
}: {
  draftId: string;
  storedReport: ValidationReport | null;
  editable: boolean;
  onValidated?: () => void;
}) {
  const client = useAdminApiClient();
  const [report, setReport] = useState<ValidationReport | null>(storedReport);
  const [diff, setDiff] = useState<DraftDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/diff", {
        params: { path: { draftId } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The diff could not be loaded"));
        } else {
          setDiff(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The diff could not be loaded");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId]);

  const validate = useCallback(() => {
    setBusy(true);
    setError(null);
    client
      .POST("/v1/admin/content/drafts/{draftId}/validate", {
        params: { path: { draftId } },
      })
      .then(({ data, error: apiError }) => {
        setBusy(false);
        if (data === undefined) {
          setError(messageOf(apiError, "Validation could not be run"));
          return;
        }
        setReport(data.report);
        onValidated?.();
      })
      .catch(() => {
        setBusy(false);
        setError("Validation could not be run");
      });
  }, [client, draftId, onValidated]);

  const blocking = report?.findings.filter(
    (finding) => finding.level === "blocking",
  );
  const warnings = report?.findings.filter(
    (finding) => finding.level === "warning",
  );

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        Release readiness
      </Typography>
      {error !== null && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
        {editable && (
          <Button variant="contained" disabled={busy} onClick={validate}>
            Validate
          </Button>
        )}
        {report !== null && (
          <>
            <Chip
              size="small"
              color={report.blocking === 0 ? "success" : "error"}
              label={
                report.blocking === 0
                  ? "Nothing blocking"
                  : `${String(report.blocking)} blocking`
              }
            />
            <Chip
              size="small"
              variant="outlined"
              label={`${String(report.warnings)} warnings`}
            />
            <Typography variant="caption" color="text.secondary">
              checked {new Date(report.validatedAt).toLocaleString()}
            </Typography>
          </>
        )}
        {report === null && (
          <Typography variant="body2" color="text.secondary">
            This draft has not been validated since it last changed.
          </Typography>
        )}
      </Stack>

      {blocking !== undefined && blocking.length > 0 && (
        <Alert severity="error">
          <Typography variant="subtitle2">
            These stop a proposal until they are fixed
          </Typography>
          <List dense disablePadding>
            {blocking.map((finding, index) => (
              <ListItem key={`${finding.code}-${String(index)}`} disableGutters>
                <ListItemText
                  primary={finding.message}
                  secondary={`${finding.subject} · ${finding.code}`}
                />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      {warnings !== undefined && warnings.length > 0 && (
        <Alert severity="warning">
          <List dense disablePadding>
            {warnings.map((finding, index) => (
              <ListItem key={`${finding.code}-${String(index)}`} disableGutters>
                <ListItemText
                  primary={finding.message}
                  secondary={`${finding.subject} · ${finding.code}`}
                />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Changes against {diff?.baseContentVersion ?? "the active release"}
        </Typography>
        {diff === null && (
          <Typography variant="body2" color="text.secondary">
            Loading the diff…
          </Typography>
        )}
        {diff?.isEmpty === true && (
          <Alert severity="info">
            Nothing to release: this draft matches the active version.
          </Alert>
        )}
        {diff !== null && !diff.isEmpty && (
          <List dense>
            {diff.decks.map((entry) => (
              <ListItem
                key={entry.deckKey ?? entry.publishedCode}
                disableGutters
              >
                <ListItemText
                  primary={`Deck ${entry.deckKey ?? entry.publishedCode ?? ""} ${CHANGE_LABEL[entry.change] ?? entry.change}`}
                  secondary={entry.details.join(" · ")}
                />
              </ListItem>
            ))}
            {diff.assets.map((entry) => (
              <ListItem
                key={`${entry.entityContentKey}-${entry.assetType}`}
                disableGutters
              >
                <ListItemText
                  primary={`${entry.assetType} replaced for ${entry.entityContentKey}`}
                  secondary={entry.reason ?? undefined}
                />
              </ListItem>
            ))}
          </List>
        )}
      </Box>
    </Stack>
  );
}
