import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import LinearProgress from "@mui/material/LinearProgress";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { visuallyHidden } from "@mui/utils";
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useGetIdentity, usePermissions } from "react-admin";
import { Link } from "react-router-dom";
import { useAdminApiClient } from "../api/ApiClientContext";
import { EmptyState, ErrorState } from "../components/StateViews";
import { MetaItem, PageHeader } from "../components/PageHeader";
import { absoluteTime, relativeTime } from "../components/relative-time";
import { useCurrentDraft } from "./CurrentDraftContext";
import { routes } from "./routes";
import { useWorkspaceData } from "./useWorkspaceData";
import type { WorkspaceData } from "./useWorkspaceData";
import {
  findingHref,
  lifecycle,
  needsAttention,
  recentActivity,
  validationSummary,
  workQueue,
} from "./workspace-model";
import type {
  AddressableFinding,
  LifecycleStep,
  WorkQueueItem,
} from "./workspace-model";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * The screen that answers "what do I do next" (§5).
 *
 * It is not an analytics dashboard: every block either names the next step
 * or opens the object that is blocking it. The lifecycle says where the
 * draft stands, the work queue is ordered by how broken each deck is, and
 * every validation finding is a link to the thing that failed.
 */
export function ContentWorkspace() {
  const {
    draft: current,
    create,
    creating,
    loading,
    error,
  } = useCurrentDraft();
  const { permissions } = usePermissions<string>();
  const { identity } = useGetIdentity();
  const data = useWorkspaceData(current?.id ?? null);
  const [railOpen, setRailOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const editable = canEdit(permissions);

  const startDraft = useCallback(() => {
    setCreateError(null);
    create().catch((cause: unknown) => {
      setCreateError(
        cause instanceof Error
          ? cause.message
          : "The draft could not be created",
      );
    });
  }, [create]);

  const model = useMemo(() => {
    if (current === null) {
      return null;
    }
    const queue = workQueue(current.id, data.decks, data.entities);
    return {
      steps: lifecycle(current),
      queue,
      attention: needsAttention(queue, data.entities),
      validation: validationSummary(data.report, data.decks, data.entities),
      activity: recentActivity({
        draft: data.draft ?? current,
        report: data.report,
        assets: data.assets,
        releases: data.releases,
        viewerId: identity?.id === undefined ? null : String(identity.id),
      }),
    };
  }, [current, data, identity]);

  const rail =
    current === null || model === null ? null : (
      <WorkspaceRail
        draftId={current.id}
        editable={editable}
        validation={model.validation}
        findings={data.report?.findings ?? []}
        activity={model.activity}
        onValidated={data.reload}
      />
    );

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Content workspace"
        description="Create, validate and publish country flag content."
        surface={current === null ? "neutral" : "draft"}
        surfaceNote={
          current === null ? undefined : `revision ${String(current.revision)}`
        }
        meta={
          <>
            <MetaItem label="Active release">
              {data.status?.activeVersion ?? "none yet"}
            </MetaItem>
            <MetaItem label="Countries">
              {data.status === null ? "—" : String(data.status.entityCount)}
            </MetaItem>
            <MetaItem label="Decks">
              {data.status === null ? "—" : String(data.status.deckCount)}
            </MetaItem>
          </>
        }
        actions={
          rail === null ? undefined : (
            <Button
              variant="outlined"
              size="small"
              onClick={() => setRailOpen(true)}
              sx={{ display: { xs: "inline-flex", lg: "none" } }}
            >
              Summary
            </Button>
          )
        }
      />

      {error !== null && <ErrorState message={error} />}
      {createError !== null && (
        <Alert severity="error" onClose={() => setCreateError(null)}>
          {createError}
        </Alert>
      )}
      {data.error !== null && current !== null && (
        <ErrorState
          title="The release status could not be read"
          message={data.error}
          onRetry={data.reload}
        />
      )}

      {loading && current === null && <WorkspaceSkeleton />}

      {!loading && current === null && (
        <Card>
          <EmptyState
            title="No draft is open"
            description={
              editable
                ? "Editing happens in a draft. Starting one copies the current release, so the live catalog stays untouched until you publish."
                : "Editing happens in a draft, and this deployment has none. An editor can start one from the current release."
            }
            icon={<InsertDriveFileOutlinedIcon sx={{ fontSize: 40 }} />}
            action={
              editable ? (
                <Button
                  variant="contained"
                  disabled={creating}
                  onClick={startDraft}
                >
                  Create draft from current release
                </Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {current !== null && model !== null && (
        <Box
          sx={{
            display: "grid",
            gap: 3,
            alignItems: "start",
            gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 320px" },
          }}
        >
          <Stack spacing={3} sx={{ minWidth: 0 }}>
            <LifecycleTrail steps={model.steps} />
            <Box
              sx={{
                display: "grid",
                gap: 2,
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(3, minmax(0, 1fr))",
                },
              }}
            >
              <StatusTile
                label="Active release"
                value={data.status?.activeVersion ?? "None yet"}
                icon={<EventAvailableOutlinedIcon />}
                tone="success"
                hint={
                  data.status?.publishedAt == null
                    ? "Nothing published yet"
                    : `Published ${relativeTime(data.status.publishedAt)}`
                }
              />
              <StatusTile
                label="Draft"
                value={`Revision ${String(current.revision)}`}
                icon={<InsertDriveFileOutlinedIcon />}
                tone="info"
                hint={`Updated ${relativeTime(current.updatedAt)} · ${current.status.toLowerCase()}`}
                href={routes.draftOverview(current.id)}
              />
              <StatusTile
                label="Needs attention"
                value={String(model.attention.total)}
                icon={<ReportProblemOutlinedIcon />}
                tone={model.attention.total === 0 ? "success" : "error"}
                hint={
                  model.attention.total === 0
                    ? "Nothing is missing a drawing"
                    : `${String(model.attention.decks)} decks · ${String(model.attention.entities)} countries`
                }
              />
            </Box>
            <WorkQueuePanel
              items={model.queue}
              editable={editable}
              draftId={current.id}
            />
          </Stack>
          <Box sx={{ display: { xs: "none", lg: "block" }, minWidth: 0 }}>
            {rail}
          </Box>
        </Box>
      )}

      <Drawer
        anchor="right"
        open={railOpen}
        onClose={() => setRailOpen(false)}
        slotProps={{ paper: { sx: { width: 340, p: 2 } } }}
      >
        <Stack direction="row" sx={{ justifyContent: "flex-end", mb: 1 }}>
          <Button size="small" onClick={() => setRailOpen(false)}>
            Close
          </Button>
        </Stack>
        {rail}
      </Drawer>
    </Box>
  );
}

function WorkspaceSkeleton() {
  return (
    <Stack spacing={2} role="status" aria-label="Loading the workspace">
      <Skeleton variant="rounded" height={92} />
      <Skeleton variant="rounded" height={124} />
      <Skeleton variant="rounded" height={220} />
    </Stack>
  );
}

// --- Lifecycle -------------------------------------------------------------

function LifecycleTrail({ steps }: { steps: readonly LifecycleStep[] }) {
  return (
    <Card component="nav" aria-label="Draft lifecycle" sx={{ px: 2.5, py: 2 }}>
      <Box
        component="ol"
        sx={{
          listStyle: "none",
          m: 0,
          p: 0,
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: {
            xs: "1fr",
            sm: "repeat(2, minmax(0, 1fr))",
            md: "repeat(4, minmax(0, 1fr))",
          },
        }}
      >
        {steps.map((step, index) => (
          <Box component="li" key={step.id} sx={{ minWidth: 0 }}>
            <Stack
              component={Link}
              to={step.href}
              direction="row"
              spacing={1.25}
              sx={{
                alignItems: "center",
                textDecoration: "none",
                color: "inherit",
                borderRadius: 2,
                p: 1,
                "&:hover": { backgroundColor: "action.hover" },
              }}
              aria-current={step.current ? "step" : undefined}
            >
              <Box
                aria-hidden
                sx={{
                  flexShrink: 0,
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: "0.8125rem",
                  border: 1,
                  borderColor:
                    step.done || step.current ? "primary.main" : "divider",
                  backgroundColor:
                    step.done || step.current ? "primary.main" : "transparent",
                  color:
                    step.done || step.current
                      ? "primary.contrastText"
                      : "text.secondary",
                }}
              >
                {step.done ? "✓" : index + 1}
              </Box>
              <Stack spacing={0} sx={{ minWidth: 0 }}>
                <Typography
                  variant="subtitle2"
                  sx={{
                    color: step.current ? "primary.main" : "text.primary",
                    fontWeight: step.current ? 700 : 600,
                  }}
                >
                  {step.label}
                  {step.current && (
                    // Colour alone must not carry it (§11): the step says so
                    // in words for anyone reading with a screen reader.
                    <Box component="span" sx={visuallyHidden}>
                      {" "}
                      — the draft is here now
                    </Box>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {step.description}
                </Typography>
              </Stack>
            </Stack>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

// --- Tiles -----------------------------------------------------------------

const TILE_TONE = {
  success: "success.main",
  info: "info.main",
  error: "error.main",
} as const;

function StatusTile({
  label,
  value,
  hint,
  icon,
  tone,
  href,
}: {
  label: string;
  value: string;
  hint: string;
  icon: ReactNode;
  tone: keyof typeof TILE_TONE;
  href?: string;
}) {
  const body = (
    <Stack direction="row" spacing={1.75} sx={{ alignItems: "flex-start" }}>
      <Box
        aria-hidden
        sx={{
          display: "grid",
          placeItems: "center",
          width: 40,
          height: 40,
          borderRadius: 2,
          flexShrink: 0,
          color: TILE_TONE[tone],
          backgroundColor: "action.hover",
        }}
      >
        {icon}
      </Box>
      <Stack spacing={0.25} sx={{ minWidth: 0 }}>
        <Typography variant="overline" color="text.secondary" component="h3">
          {label}
        </Typography>
        <Typography
          variant="h6"
          component="p"
          sx={{ overflowWrap: "anywhere", lineHeight: 1.25 }}
        >
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      </Stack>
    </Stack>
  );
  return (
    <Card sx={{ p: 2 }}>
      {href === undefined ? (
        body
      ) : (
        <Box
          component={Link}
          to={href}
          sx={{ display: "block", textDecoration: "none", color: "inherit" }}
        >
          {body}
        </Box>
      )}
    </Card>
  );
}

// --- Work queue ------------------------------------------------------------

function WorkQueuePanel({
  items,
  editable,
  draftId,
}: {
  items: readonly WorkQueueItem[];
  editable: boolean;
  draftId: string;
}) {
  return (
    <Card component="section" aria-labelledby="work-queue-heading">
      <Stack
        direction="row"
        spacing={1.5}
        sx={{ alignItems: "center", px: 2.5, py: 2 }}
      >
        <Typography variant="h6" component="h2" id="work-queue-heading">
          Work queue
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`${String(items.length)} ${items.length === 1 ? "deck" : "decks"}`}
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button component={Link} to={routes.draftDecks(draftId)} size="small">
          All decks
        </Button>
      </Stack>
      <Divider />
      {items.length === 0 ? (
        <EmptyState
          title="This draft has no decks yet"
          description="A deck is what an app actually shows. Build one and its cards appear here with what they are still missing."
          action={
            editable ? (
              <Button
                component={Link}
                to={routes.draftDeck(draftId, "new")}
                variant="contained"
              >
                New deck
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {items.map((item) => (
            <Box
              component="li"
              key={item.deckKey}
              sx={{
                px: 2.5,
                py: 2,
                borderTop: 1,
                borderColor: "divider",
                "&:first-of-type": { borderTop: 0 },
              }}
            >
              <Stack
                direction="row"
                spacing={2}
                useFlexGap
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Stack spacing={0.5} sx={{ minWidth: 200, flexGrow: 1 }}>
                  <Typography variant="subtitle1" component="h3">
                    {item.name}
                  </Typography>
                  <Stack
                    direction="row"
                    spacing={1}
                    useFlexGap
                    sx={{ flexWrap: "wrap", alignItems: "center" }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      {String(item.cardCount)}{" "}
                      {item.cardCount === 1 ? "card" : "cards"}
                    </Typography>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={item.membership}
                    />
                  </Stack>
                </Stack>
                <Box sx={{ width: 220, flexGrow: 1, minWidth: 180 }}>
                  <Completeness item={item} />
                </Box>
                <Button
                  component={Link}
                  to={item.href}
                  size="small"
                  variant="outlined"
                >
                  {editable ? "Continue editing" : "View deck"}
                </Button>
              </Stack>
            </Box>
          ))}
        </Box>
      )}
    </Card>
  );
}

function Completeness({ item }: { item: WorkQueueItem }) {
  if (item.completeness === null) {
    return (
      <Typography variant="caption" color="text.secondary">
        Members resolve at publish; readiness is checked there.
      </Typography>
    );
  }
  const problems: string[] = [];
  if (item.missingFlags > 0) {
    problems.push(`${String(item.missingFlags)} missing flags`);
  }
  if (item.missingCoats > 0) {
    problems.push(`${String(item.missingCoats)} missing coats of arms`);
  }
  if (item.unknownMembers > 0) {
    problems.push(`${String(item.unknownMembers)} unknown members`);
  }
  const tone =
    item.readiness === "ready"
      ? "success"
      : item.readiness === "warning"
        ? "warning"
        : "error";
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <LinearProgress
          variant="determinate"
          color={tone}
          value={item.completeness}
          aria-label={`${item.name} completeness`}
          sx={{ flexGrow: 1, height: 8, borderRadius: 4 }}
        />
        <Typography
          variant="caption"
          sx={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}
        >
          {String(item.completeness)}%
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
        {item.readiness === "ready" ? (
          <CheckCircleOutlineIcon fontSize="small" color="success" />
        ) : item.readiness === "warning" ? (
          <WarningAmberOutlinedIcon fontSize="small" color="warning" />
        ) : (
          <ErrorOutlineIcon fontSize="small" color="error" />
        )}
        <Typography variant="caption" color="text.secondary">
          {problems.length === 0
            ? "Every card has its drawing"
            : problems.join(" · ")}
        </Typography>
      </Stack>
    </Stack>
  );
}

// --- Right rail ------------------------------------------------------------

function WorkspaceRail({
  draftId,
  editable,
  validation,
  findings,
  activity,
  onValidated,
}: {
  draftId: string;
  editable: boolean;
  validation: ReturnType<typeof validationSummary>;
  findings: readonly (AddressableFinding & {
    level: string;
    code: string;
    message: string;
  })[];
  activity: ReturnType<typeof recentActivity>;
  onValidated: () => void;
}) {
  const client = useAdminApiClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validate = useCallback(() => {
    setBusy(true);
    setError(null);
    client
      .POST("/v1/admin/content/drafts/{draftId}/validate", {
        params: { path: { draftId } },
      })
      .then(({ data }) => {
        setBusy(false);
        if (data === undefined) {
          setError("Validation could not be run");
          return;
        }
        onValidated();
      })
      .catch(() => {
        setBusy(false);
        setError("Validation could not be run");
      });
  }, [client, draftId, onValidated]);

  return (
    <Stack spacing={2}>
      {editable && (
        <Button
          variant="contained"
          disabled={busy}
          onClick={validate}
          fullWidth
        >
          {busy ? "Validating…" : "Validate draft"}
        </Button>
      )}
      <Button
        component={Link}
        to={routes.draftRelease(draftId)}
        variant="outlined"
        fullWidth
      >
        Validation &amp; release
      </Button>
      {error !== null && <Alert severity="error">{error}</Alert>}

      <Card
        component="section"
        aria-labelledby="validation-heading"
        sx={{ p: 2 }}
      >
        <Typography variant="h6" component="h2" id="validation-heading">
          Validation summary
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {validation.validatedAt === null
            ? "Not validated since this draft last changed"
            : `Last run ${relativeTime(validation.validatedAt)}`}
        </Typography>
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          <CountRow
            icon={<CheckCircleOutlineIcon fontSize="small" color="success" />}
            label="Passed"
            value={validation.passed}
            hint={`of ${String(validation.objects)} objects with no finding`}
          />
          <CountRow
            icon={<WarningAmberOutlinedIcon fontSize="small" color="warning" />}
            label="Warnings"
            value={validation.warnings}
          />
          <CountRow
            icon={<ErrorOutlineIcon fontSize="small" color="error" />}
            label="Errors"
            value={validation.errors}
          />
        </Stack>
        {findings.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack
              component="ul"
              spacing={1}
              sx={{ listStyle: "none", m: 0, p: 0 }}
            >
              {findings.slice(0, 3).map((finding) => {
                const href = findingHref(draftId, finding);
                const body = (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "flex-start" }}
                  >
                    {finding.level === "blocking" ? (
                      <ErrorOutlineIcon fontSize="small" color="error" />
                    ) : (
                      <WarningAmberOutlinedIcon
                        fontSize="small"
                        color="warning"
                      />
                    )}
                    <Stack spacing={0} sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {finding.subject}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {finding.message}
                      </Typography>
                    </Stack>
                  </Stack>
                );
                return (
                  <Box
                    component="li"
                    key={`${finding.code}-${finding.subject}`}
                  >
                    {href === null ? (
                      body
                    ) : (
                      <Box
                        component={Link}
                        to={href}
                        sx={{
                          display: "block",
                          textDecoration: "none",
                          color: "inherit",
                          borderRadius: 1,
                          p: 0.5,
                          "&:hover": { backgroundColor: "action.hover" },
                        }}
                      >
                        {body}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </Card>

      <Card
        component="section"
        aria-labelledby="activity-heading"
        sx={{ p: 2 }}
      >
        <Typography variant="h6" component="h2" id="activity-heading">
          Recent activity
        </Typography>
        {activity.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Nothing has happened in this draft yet.
          </Typography>
        ) : (
          <Stack
            component="ul"
            spacing={1.5}
            sx={{ listStyle: "none", m: 0, p: 0, mt: 1.5 }}
          >
            {activity.map((item) => (
              <Box component="li" key={item.id}>
                <Stack
                  direction="row"
                  spacing={1.25}
                  sx={{ alignItems: "flex-start" }}
                >
                  <HistoryOutlinedIcon
                    fontSize="small"
                    sx={{ color: "text.disabled", mt: 0.25 }}
                  />
                  <Stack spacing={0} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {item.href === null ? (
                        item.title
                      ) : (
                        <Box
                          component={Link}
                          to={item.href}
                          sx={{ color: "inherit", textDecoration: "none" }}
                        >
                          {item.title}
                        </Box>
                      )}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.detail}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      title={absoluteTime(item.at)}
                    >
                      {relativeTime(item.at)}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Card>
    </Stack>
  );
}

function CountRow({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
      {icon}
      <Stack spacing={0} sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="body2">{label}</Typography>
        {hint !== undefined && (
          <Typography variant="caption" color="text.secondary">
            {hint}
          </Typography>
        )}
      </Stack>
      <Typography
        variant="body2"
        sx={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
      >
        {String(value)}
      </Typography>
    </Stack>
  );
}

export type { WorkspaceData };
