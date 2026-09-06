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
import { FindingList } from "../../components/FindingList";
import { LoadingState } from "../../components/LoadingState";
import { groupDiff } from "./release-diff";
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
 * Orders two dotted versions numerically, so 0.10.0 is above 0.9.0 rather
 * than below it as a string comparison would have it. Missing or
 * non-numeric parts count as zero: this decides whether to warn, and a
 * version nobody can parse is not worth refusing over.
 */
function compareVersions(left: string, right: string): number {
  const parts = (value: string): number[] =>
    value.split(".").map((part) => {
      const parsed = Number.parseInt(part, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    });
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
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
  // Empty until the live release says what it demands. It used to start at a
  // hard-coded "1.0.0", which had nothing to do with any client that exists:
  // publishing without touching the field raised the bar and locked every
  // installed app out of the content (#250).
  const [minimumClientVersion, setMinimumClientVersion] = useState("");
  const [activeMinimum, setActiveMinimum] = useState<string | null>(null);

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

  // What the live release demands of a client, offered as this release's
  // value. Carrying it forward is the safe default: the bar moves only when
  // an editor deliberately types a higher number.
  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/status")
      .then(({ data }) => {
        if (cancelled || data === undefined) {
          return;
        }
        const live = data.minimumClientVersion;
        setActiveMinimum(live);
        if (live !== null) {
          setMinimumClientVersion((current) =>
            current === "" ? live : current,
          );
        }
      })
      .catch(() => {
        // The field stays empty and the run is refused without one, which is
        // safer than inventing a version nobody published.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

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

  // Whether this release would demand more of a client than the live one
  // does. Allowed, and sometimes right — but it is the one field here that
  // can take a working app away from someone, so it says so.
  const raisesTheBar =
    activeMinimum !== null &&
    minimumClientVersion.trim() !== "" &&
    compareVersions(minimumClientVersion.trim(), activeMinimum) > 0;

  // Why the proposal is refused, in the order an editor would fix it.
  const blockedReason =
    report === null
      ? "Run Validate first: a proposal is opened against a draft whose rules have been checked."
      : report.blocking > 0
        ? `${String(report.blocking)} blocking ${report.blocking === 1 ? "issue" : "issues"} stop a proposal. Each one above opens the field it is about.`
        : null;

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

      {report !== null && (
        <FindingList
          draftId={draftId}
          findings={report.findings}
          emptyLabel="Nothing is blocking, and nothing was warned about."
        />
      )}

      <Box>
        <Typography variant="subtitle2" component="h4" gutterBottom>
          Changes against {diff?.baseContentVersion ?? "the active release"}
        </Typography>
        {diff === null && <LoadingState label="Reading the diff…" />}
        {diff?.isEmpty === true && (
          <Alert severity="info">
            Nothing to release: this draft matches the active version.
          </Alert>
        )}
        {diff !== null && !diff.isEmpty && (
          <Stack spacing={2}>
            {groupDiff(diff).map((group) => (
              <Box
                key={group.id}
                component="section"
                aria-labelledby={`diff-${group.id}`}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center" }}
                >
                  <Typography
                    variant="subtitle2"
                    component="h5"
                    id={`diff-${group.id}`}
                  >
                    {group.label}
                  </Typography>
                  <Chip size="small" label={group.lines.length} />
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {group.note}
                </Typography>
                <List dense disablePadding>
                  {group.lines.map((line, index) => (
                    <ListItem
                      key={`${group.id}-${String(index)}`}
                      disableGutters
                    >
                      <ListItemText
                        primary={line.detail}
                        secondary={
                          line.change === null
                            ? line.subject
                            : `${line.subject} · ${CHANGE_LABEL[line.change] ?? line.change}`
                        }
                      />
                    </ListItem>
                  ))}
                </List>
              </Box>
            ))}
          </Stack>
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
            {/* A greyed-out button provokes the question "why?", so the
                answer is beside it rather than left to be guessed. */}
            {blockedReason !== null && (
              <Alert severity="warning">{blockedReason}</Alert>
            )}
            {canPublish && (
              <Box>
                <Button
                  variant="contained"
                  disabled={busy || blockedReason !== null}
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
                error={raisesTheBar}
                helperText={
                  raisesTheBar
                    ? `Higher than the live release (${activeMinimum}): every app below this is locked out until it updates. Raise it only for content older apps cannot read.`
                    : activeMinimum === null
                      ? "No release has set one yet. Use the version installed apps actually carry."
                      : `Carried over from the live release (${activeMinimum}). Apps below this get an update screen.`
                }
                sx={{ flex: 1 }}
              />
            </Stack>
            <Box>
              <Button
                variant="outlined"
                // The minimum is required rather than defaulted in code:
                // whatever goes in decides which installed apps keep
                // working, so it is never a value nobody chose.
                disabled={
                  busy ||
                  contentVersion.trim().length === 0 ||
                  minimumClientVersion.trim().length === 0
                }
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
