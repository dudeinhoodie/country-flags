import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";
import type { ReactNode } from "react";

/**
 * The three answers a screen gives when it has nothing to show.
 *
 * Waiting lives in `LoadingState`; this file holds the other two, so that
 * "there is nothing here yet" and "this did not load" never read the same
 * and never get invented afresh per screen (§14 Phase A).
 */

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string | undefined;
  icon?: ReactNode;
  /** The one thing to do about it. */
  action?: ReactNode;
}) {
  return (
    <Stack
      spacing={1.5}
      sx={{ alignItems: "center", py: 8, px: 3, textAlign: "center" }}
    >
      <Box sx={{ color: "text.disabled", display: "flex" }} aria-hidden>
        {icon ?? <InboxOutlinedIcon sx={{ fontSize: 40 }} />}
      </Box>
      <Typography variant="h6" component="p">
        {title}
      </Typography>
      {description !== undefined && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ maxWidth: 460 }}
        >
          {description}
        </Typography>
      )}
      {action !== undefined && <Box sx={{ pt: 1 }}>{action}</Box>}
    </Stack>
  );
}

export function ErrorState({
  title = "This screen could not be loaded",
  message,
  onRetry,
}: {
  title?: string | undefined;
  message: string;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <Alert
      severity="error"
      sx={{ my: 2 }}
      action={
        onRetry === undefined ? undefined : (
          <Button color="inherit" size="small" onClick={onRetry}>
            Try again
          </Button>
        )
      }
    >
      <AlertTitle>{title}</AlertTitle>
      {message}
    </Alert>
  );
}
