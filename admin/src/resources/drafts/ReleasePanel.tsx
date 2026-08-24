import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
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
type PublishRunStatus = components["schemas"]["AdminPublishRunStatus"];

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
  draftRevision,
  baseContentVersion,
  baseCatalogCommit,
  proposalUrl,
  storedReport,
  editable,
  canPublish,
  onValidated,
}: {
  draftId: string;
  draftRevision: number;
  baseContentVersion: string;
  baseCatalogCommit: string;
  proposalUrl: string | null;
  storedReport: ValidationReport | null;
  editable: boolean;
  canPublish: boolean;
  onValidated?: () => void;
}) {
  const client = useAdminApiClient();
  const [report, setReport] = useState<ValidationReport | null>(storedReport);
  const [diff, setDiff] = useState<DraftDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<string | null>(proposalUrl);
  const [publish, setPublish] = useState<PublishRunStatus | null>(null);
  const [contentVersion, setContentVersion] = useState("");
  const [minimumClientVersion, setMinimumClientVersion] = useState("1.0.0");

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

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/releases/publish-run")
      .then(({ data }) => {
        if (!cancelled && data !== undefined) {
          setPublish(data);
        }
      })
      .catch(() => {
        // The release state is informational; the panel still works.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const propose = useCallback(() => {
    setBusy(true);
    setError(null);
    client
      .POST("/v1/admin/content/drafts/{draftId}/proposal", {
        params: { path: { draftId } },
        body: { draftRevision, baseContentVersion, baseCatalogCommit },
      })
      .then(({ data, error: apiError }) => {
        setBusy(false);
        if (data === undefined) {
          setError(messageOf(apiError, "The proposal could not be opened"));
          return;
        }
        setProposal(data.proposalUrl);
        onValidated?.();
      })
      .catch(() => {
        setBusy(false);
        setError("The proposal could not be opened");
      });
  }, [
    client,
    draftId,
    draftRevision,
    baseContentVersion,
    baseCatalogCommit,
    onValidated,
  ]);

  const startPublish = useCallback(() => {
    setBusy(true);
    setError(null);
    client
      .POST("/v1/admin/content/releases/publish-run", {
        body: { contentVersion, minimumClientVersion },
      })
      .then(({ data, error: apiError }) => {
        setBusy(false);
        if (data === undefined) {
          setError(messageOf(apiError, "The publish run could not be started"));
          return;
        }
        setPublish(data);
      })
      .catch(() => {
        setBusy(false);
        setError("The publish run could not be started");
      });
  }, [client, contentVersion, minimumClientVersion]);

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
              <ListItem key={entry.deckKey} disableGutters>
                <ListItemText
                  primary={`Deck ${entry.deckKey} ${CHANGE_LABEL[entry.change] ?? entry.change}`}
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

      <Divider />

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Propose and publish
        </Typography>
        {proposal !== null ? (
          <Alert severity="success">
            Proposed:{" "}
            <Link href={proposal} target="_blank" rel="noreferrer">
              {proposal}
            </Link>
            . Merging it changes the catalog; publishing is still a separate
            step.
          </Alert>
        ) : (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              A proposal commits this draft to a branch and opens a draft pull
              request for review. It publishes nothing.
            </Typography>
            {canPublish && (
              <Box>
                <Button
                  variant="contained"
                  disabled={busy || report === null || report.blocking > 0}
                  onClick={propose}
                >
                  Open a proposal
                </Button>
              </Box>
            )}
          </Stack>
        )}

        {publish?.configured === false && (
          <Alert severity="info" sx={{ mt: 2 }}>
            This deployment has no GitHub credential, so proposals and publish
            runs are done by hand: download the export above and open the pull
            request yourself.
          </Alert>
        )}

        {canPublish && publish?.configured === true && (
          <Stack spacing={1} sx={{ mt: 2, maxWidth: 520 }}>
            <Typography variant="body2" color="text.secondary">
              After the pull request is merged, start the dev publish run. The
              active version is <b>{publish.activeVersion ?? "none"}</b>; a
              release must carry a new one.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="New content version"
                size="small"
                value={contentVersion}
                onChange={(event) => setContentVersion(event.target.value)}
                sx={{ flex: 1 }}
              />
              <TextField
                label="Minimum client version"
                size="small"
                value={minimumClientVersion}
                onChange={(event) =>
                  setMinimumClientVersion(event.target.value)
                }
                helperText="Clients below this get an update screen"
                sx={{ flex: 1 }}
              />
            </Stack>
            <Box>
              <Button
                variant="outlined"
                disabled={busy || contentVersion.trim().length === 0}
                onClick={startPublish}
              >
                Start the publish run
              </Button>
            </Box>
            {publish.lastRun !== null && (
              <Typography variant="caption" color="text.secondary">
                Last run: {publish.lastRun.status}
                {publish.lastRun.conclusion === null
                  ? ""
                  : ` (${publish.lastRun.conclusion})`}{" "}
                ·{" "}
                <Link
                  href={publish.lastRun.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  open in GitHub
                </Link>
              </Typography>
            )}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
