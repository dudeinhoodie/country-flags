import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Skeleton from "@mui/material/Skeleton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { Title } from "react-admin";
import type { ReactNode } from "react";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import { ENV_DOT } from "./theme";

type ContentStatus = components["schemas"]["AdminContentStatus"];

type StatusState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; status: ContentStatus };

const TILE_GRID = {
  display: "grid",
  gap: 2,
  gridTemplateColumns: {
    xs: "1fr",
    sm: "repeat(2, 1fr)",
    lg: "repeat(4, 1fr)",
  },
} as const;

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Card sx={{ p: 2.5, minHeight: 124 }}>
      <Stack spacing={0.75}>
        <Typography variant="overline" color="text.secondary" component="h3">
          {label}
        </Typography>
        {children}
      </Stack>
    </Card>
  );
}

function StatTile({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Tile label={label}>
      <Typography
        variant="h4"
        component="p"
        sx={{
          lineHeight: 1.15,
          fontVariantNumeric: "tabular-nums",
          color: accent ? "primary.main" : "text.primary",
          overflowWrap: "anywhere",
        }}
      >
        {value}
      </Typography>
      {hint !== undefined && (
        <Typography variant="body2" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Tile>
  );
}

function DeploymentTile() {
  const config = useRuntimeConfig();
  return (
    <Tile label="Deployment">
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Box
          aria-hidden
          sx={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: ENV_DOT[config.environment],
          }}
        />
        <Typography variant="h6" component="p">
          {config.environment}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary">
        {config.apiBasePath} · build {config.appVersion}
      </Typography>
    </Tile>
  );
}

function SkeletonTile() {
  return (
    <Card sx={{ p: 2.5, minHeight: 124 }}>
      <Stack spacing={1}>
        <Skeleton width={90} height={16} />
        <Skeleton width={130} height={36} />
        <Skeleton width={150} height={16} />
      </Stack>
    </Card>
  );
}

/**
 * A status board rather than a debug card: what is live, how big it is,
 * and where this console is pointed — each as its own readout.
 */
export function Dashboard() {
  const client = useAdminApiClient();
  const [state, setState] = useState<StatusState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    client.GET("/v1/admin/content/status").then(
      ({ data, response }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setState({
            phase: "error",
            message: `Content status failed with HTTP ${String(response.status)}`,
          });
        } else {
          setState({ phase: "ready", status: data });
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setState({
            phase: "error",
            message:
              cause instanceof Error ? cause.message : "Content status failed",
          });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <Box sx={{ mt: 3 }}>
      <Title title="Dashboard" />
      <Stack spacing={0.25} sx={{ mb: 3 }}>
        <Typography variant="overline" color="text.secondary" component="p">
          Content operations
        </Typography>
        <Typography variant="h4" component="h2">
          Catalog administration
        </Typography>
      </Stack>

      {state.phase === "loading" && (
        <Box sx={TILE_GRID}>
          <SkeletonTile />
          <SkeletonTile />
          <SkeletonTile />
          <SkeletonTile />
        </Box>
      )}

      {state.phase === "error" && (
        <Stack spacing={2}>
          <Alert severity="error">{state.message}</Alert>
          <Box sx={TILE_GRID}>
            <DeploymentTile />
          </Box>
        </Stack>
      )}

      {state.phase === "ready" &&
        (state.status.activeVersion === null ? (
          <Stack spacing={2}>
            <Alert severity="warning">
              No content release has been published yet.
            </Alert>
            <Box sx={TILE_GRID}>
              <DeploymentTile />
            </Box>
          </Stack>
        ) : (
          <Box sx={TILE_GRID}>
            <StatTile
              label="Active release"
              value={state.status.activeVersion}
              accent
              hint={
                state.status.publishedAt === null
                  ? "Publish date unknown"
                  : `Published ${new Date(state.status.publishedAt).toLocaleString()}`
              }
            />
            <StatTile
              label="Countries"
              value={String(state.status.entityCount)}
              hint="entities in the active catalog"
            />
            <StatTile
              label="Study decks"
              value={String(state.status.deckCount)}
              hint="published to clients"
            />
            <DeploymentTile />
          </Box>
        ))}
    </Box>
  );
}
