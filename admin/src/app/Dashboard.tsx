import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useEffect, useState } from "react";
import { Title } from "react-admin";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";

type ContentStatus = components["schemas"]["AdminContentStatus"];

type StatusState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; status: ContentStatus };

export function Dashboard() {
  const config = useRuntimeConfig();
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
    <Card sx={{ mt: 2 }}>
      <Title title="Country Flags Admin" />
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h5" component="h2">
            Catalog administration
          </Typography>
          {state.phase === "loading" && (
            <Typography color="text.secondary">
              Loading the active release…
            </Typography>
          )}
          {state.phase === "error" && (
            <Alert severity="error">{state.message}</Alert>
          )}
          {state.phase === "ready" &&
            (state.status.activeVersion === null ? (
              <Alert severity="warning">
                No content release has been published yet.
              </Alert>
            ) : (
              <>
                <Typography variant="body1">
                  Active content version: <b>{state.status.activeVersion}</b>
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Published:{" "}
                  {state.status.publishedAt === null
                    ? "unknown"
                    : new Date(state.status.publishedAt).toLocaleString()}
                </Typography>
                <Typography variant="body2">
                  Entities: {state.status.entityCount} · Decks:{" "}
                  {state.status.deckCount}
                </Typography>
              </>
            ))}
          <Typography variant="body2" color="text.secondary">
            Environment: {config.environment} · API: {config.apiBasePath} ·
            Build: {config.appVersion}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
