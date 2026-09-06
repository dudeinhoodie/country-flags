import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { Title, usePermissions } from "react-admin";
import { LoadingState } from "../../components/LoadingState";
import { PageHeader } from "../../components/PageHeader";
import { relativeTime } from "../../components/relative-time";
import { StatusChip } from "../../components/StatusChip";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { ConfirmReleaseDialog } from "./ConfirmReleaseDialog";
import {
  isInFlight,
  useContentReleases,
  useReleaseRuns,
  useReleaseWriter,
} from "./useReleases";
import type { ReleaseRun } from "./useReleases";

function canPublish(permissions: unknown): boolean {
  return permissions === "PUBLISHER" || permissions === "ADMIN";
}

/** What the operator is about to be asked to confirm, or nothing. */
type PendingAction =
  | { kind: "publish"; contentVersion: string; minimumClientVersion: string }
  | { kind: "rollback"; toVersion: string }
  | null;

/**
 * Publishing and rolling back from the product (ADR-017).
 *
 * The screen never publishes: it asks for a run and watches the record. The
 * work is a job with its own service account, its own database rights and
 * the signing key this console never sees — which is what makes it safe for
 * a button here to start a release at all.
 *
 * Rollback is why this screen exists. Until now returning to a previous
 * release meant a CLI and a database URL, at exactly the moment when nobody
 * wants to be looking for either.
 */
export function ReleasesPage() {
  const { permissions } = usePermissions<string>();
  const { state, error: stateError, reload } = useReleaseRuns();
  const {
    releases,
    error: releasesError,
    reload: reloadReleases,
  } = useContentReleases();
  const { publish, rollback, cancel } = useReleaseWriter();

  const [contentVersion, setContentVersion] = useState("");
  const [minimumClientVersion, setMinimumClientVersion] = useState("");
  const [activeMinimum, setActiveMinimum] = useState<string | null>(null);
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const client = useAdminApiClient();
  const publisher = canPublish(permissions);
  const current = state?.current ?? null;
  const running = isInFlight(current);

  // What the live release demands of a client, offered as this release's
  // value. Carrying it forward is the safe default: the bar moves only when
  // somebody deliberately types a higher number (#250).
  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/status")
      .then(({ data }) => {
        if (cancelled || data === undefined) {
          return;
        }
        setActiveMinimum(data.minimumClientVersion);
        if (data.minimumClientVersion !== null) {
          const live = data.minimumClientVersion;
          setMinimumClientVersion((typed) => (typed === "" ? live : typed));
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

  // A finished run changes what is live and what may be rolled back to.
  const finishedAt = current === null ? null : current.finishedAt;
  useEffect(() => {
    if (finishedAt !== null) {
      reloadReleases();
    }
  }, [finishedAt, reloadReleases]);

  const run = useCallback(
    async (action: Exclude<PendingAction, null>): Promise<void> => {
      setBusy(true);
      setActionError(null);
      try {
        if (action.kind === "publish") {
          await publish(action.contentVersion, action.minimumClientVersion);
          setContentVersion("");
        } else {
          await rollback(action.toVersion);
          setRollbackTarget("");
        }
        reload();
        reloadReleases();
      } catch (cause: unknown) {
        setActionError(
          cause instanceof Error ? cause.message : "The run was not started",
        );
      } finally {
        setBusy(false);
        setPending(null);
      }
    },
    [publish, rollback, reload, reloadReleases],
  );

  const giveUp = useCallback(
    (runId: string): void => {
      setBusy(true);
      setActionError(null);
      cancel(runId)
        .then(() => {
          reload();
        })
        .catch((cause: unknown) => {
          setActionError(
            cause instanceof Error
              ? cause.message
              : "The run could not be cancelled",
          );
        })
        .finally(() => {
          setBusy(false);
        });
    },
    [cancel, reload],
  );

  if (state === null) {
    return (
      <>
        <Title title="Releases" />
        {stateError === null ? (
          <LoadingState label="Reading the release state…" />
        ) : (
          <Alert severity="error">{stateError}</Alert>
        )}
      </>
    );
  }

  const rollbackTargets = (releases ?? []).filter(
    (release) => !release.isActive,
  );

  return (
    <Box sx={{ pb: 4 }}>
      <Title title="Releases" />
      <PageHeader
        title="Releases"
        description="What every client is reading right now, the run that changes it, and the way back."
        surface="published"
        surfaceNote={state.activeVersion ?? "nothing published"}
      />

      {stateError !== null && <Alert severity="warning">{stateError}</Alert>}
      {releasesError !== null && (
        <Alert severity="warning">{releasesError}</Alert>
      )}
      {actionError !== null && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => {
            setActionError(null);
          }}
        >
          {actionError}
        </Alert>
      )}

      {!state.executorConfigured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          This deployment has no publisher job, so a run queued here waits for
          one. Publish through the CI workflow instead, or cancel a queued run
          to free the slot.
        </Alert>
      )}

      <Stack spacing={3}>
        <RunCard
          run={current}
          last={state.last}
          busy={busy}
          canCancel={publisher}
          onCancel={giveUp}
        />

        {publisher && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" component="h2">
                  Publish a release
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  The release is built from the catalog this deployment is
                  running, signed by the publisher job and applied in one
                  transaction. The active version is{" "}
                  <b>{state.activeVersion ?? "none"}</b>; a release must carry a
                  new one.
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <TextField
                    label="New content version"
                    size="small"
                    value={contentVersion}
                    onChange={(event) => {
                      setContentVersion(event.target.value);
                    }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Minimum client version"
                    size="small"
                    value={minimumClientVersion}
                    onChange={(event) => {
                      setMinimumClientVersion(event.target.value);
                    }}
                    helperText={
                      activeMinimum === null
                        ? "No release has set one yet. Use the version installed apps actually carry."
                        : `Carried over from the live release (${activeMinimum}). Apps below this get an update screen.`
                    }
                    sx={{ flex: 1 }}
                  />
                </Stack>
                <Box>
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      running ||
                      contentVersion.trim().length === 0 ||
                      minimumClientVersion.trim().length === 0
                    }
                    onClick={() => {
                      setPending({
                        kind: "publish",
                        contentVersion: contentVersion.trim(),
                        minimumClientVersion: minimumClientVersion.trim(),
                      });
                    }}
                  >
                    Publish
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        {publisher && (
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography variant="h6" component="h2">
                  Roll back
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  A rollback rebuilds nothing: the release it returns to is
                  already published and signed, so only the pointer moves. It is
                  the fast way out of a bad release.
                </Typography>
                {rollbackTargets.length === 0 ? (
                  <Alert severity="info">
                    There is no earlier release to return to. A rollback needs a
                    version this deployment has already published.
                  </Alert>
                ) : (
                  <>
                    <TextField
                      select
                      size="small"
                      label="Return to"
                      value={rollbackTarget}
                      onChange={(event) => {
                        setRollbackTarget(event.target.value);
                      }}
                      sx={{ maxWidth: 420 }}
                    >
                      {rollbackTargets.map((release) => (
                        <MenuItem key={release.version} value={release.version}>
                          {release.version} · published{" "}
                          {relativeTime(release.publishedAt)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Box>
                      <Button
                        variant="outlined"
                        color="warning"
                        disabled={busy || running || rollbackTarget === ""}
                        onClick={() => {
                          setPending({
                            kind: "rollback",
                            toVersion: rollbackTarget,
                          });
                        }}
                      >
                        Roll back
                      </Button>
                    </Box>
                  </>
                )}
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" gutterBottom>
              Published releases
            </Typography>
            {releases === null ? (
              <LoadingState label="Loading the releases…" />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Version</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Published</TableCell>
                    <TableCell>Retired</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {releases.map((release) => (
                    <TableRow key={release.version}>
                      <TableCell>
                        {release.version}
                        {release.isActive && (
                          <Chip
                            size="small"
                            color="success"
                            label="live"
                            sx={{ ml: 1 }}
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip value={release.status} />
                      </TableCell>
                      <TableCell>{relativeTime(release.publishedAt)}</TableCell>
                      <TableCell>{relativeTime(release.retiredAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </Stack>

      <ConfirmReleaseDialog
        open={pending !== null}
        busy={busy}
        title={
          pending?.kind === "rollback" ? "Roll back the release" : "Publish"
        }
        description={
          pending === null
            ? ""
            : pending.kind === "publish"
              ? `Publish ${pending.contentVersion}, replacing ${state.activeVersion ?? "nothing"}. Clients below ${pending.minimumClientVersion} will be shown an update screen instead of a catalogue.`
              : `Return every client to ${pending.toVersion}, replacing ${state.activeVersion ?? "nothing"}.`
        }
        confirmLabel={pending?.kind === "rollback" ? "Roll back" : "Publish"}
        phrase={
          pending === null
            ? ""
            : pending.kind === "publish"
              ? pending.contentVersion
              : pending.toVersion
        }
        onCancel={() => {
          setPending(null);
        }}
        onConfirm={() => {
          if (pending !== null) {
            void run(pending);
          }
        }}
      />
    </Box>
  );
}

/**
 * The run in flight, or the last one there was.
 *
 * A release outlives the tab that asked for it, so this is written for
 * somebody arriving mid-run as much as for somebody who just pressed the
 * button: the stage says what it is doing, and the failure says what went
 * wrong without needing the logs.
 */
function RunCard({
  run,
  last,
  busy,
  canCancel,
  onCancel,
}: {
  run: ReleaseRun | null;
  last: ReleaseRun | null;
  busy: boolean;
  canCancel: boolean;
  onCancel: (runId: string) => void;
}) {
  const shown = run ?? last;
  if (shown === null) {
    return (
      <Alert severity="info">
        No release has been run from the console yet.
      </Alert>
    );
  }
  const inFlight = isInFlight(shown);
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5}>
          <Stack
            direction="row"
            spacing={1.5}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="h6" component="h2">
              {inFlight ? "Run in flight" : "Last run"}
            </Typography>
            <Chip size="small" label={shown.kind} variant="outlined" />
            <StatusChip value={shown.status} />
            {shown.stage !== null && shown.stage !== undefined && (
              <Chip size="small" label={shown.stage} variant="outlined" />
            )}
          </Stack>
          {inFlight && <LinearProgress />}
          <Typography variant="body2" color="text.secondary">
            {shown.kind === "PUBLISH" ? "Publishing " : "Returning to "}
            <b>{shown.contentVersion}</b>
            {shown.previousVersion === null ||
            shown.previousVersion === undefined
              ? ""
              : `, replacing ${shown.previousVersion}`}{" "}
            · started {relativeTime(shown.startedAt ?? shown.createdAt)}
          </Typography>
          {shown.failure !== null && shown.failure !== undefined && (
            <Alert severity="error">
              {shown.failure.message}
              <Typography variant="caption" component="div">
                {shown.failure.code}
              </Typography>
            </Alert>
          )}
          {shown.executionName !== null &&
            shown.executionName !== undefined &&
            shown.executionName !== "" && (
              <Typography variant="caption" color="text.secondary">
                Execution {shown.executionName}
              </Typography>
            )}
          {canCancel && shown.status === "QUEUED" && (
            <Box>
              <Button
                size="small"
                color="warning"
                disabled={busy}
                onClick={() => {
                  onCancel(shown.id);
                }}
              >
                Give up on this run
              </Button>
            </Box>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
