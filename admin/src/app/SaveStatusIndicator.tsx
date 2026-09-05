import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import type { ReactNode } from "react";
import { relativeTime } from "../components/relative-time";
import { useCurrentDraft } from "./CurrentDraftContext";
import { useSaveStatus } from "./SaveStatusContext";

/**
 * Whether what is on screen is written down (§4.2).
 *
 * With no editor reporting, it falls back to the draft's own last change,
 * which is the honest answer for a screen that has nothing unsaved: the
 * draft was last written at that moment, by someone.
 */
export function SaveStatusIndicator() {
  const status = useSaveStatus();
  const { draft } = useCurrentDraft();

  if (status.state === "idle") {
    if (draft === null) {
      return null;
    }
    return <Line>{`Draft saved ${relativeTime(draft.updatedAt)}`}</Line>;
  }
  if (status.state === "saving") {
    return (
      <Line icon={<CircularProgress size={14} color="inherit" />}>Saving…</Line>
    );
  }
  if (status.state === "saved") {
    return (
      <Line icon={<CheckCircleOutlineIcon sx={{ fontSize: 16 }} />}>
        {`Saved ${relativeTime(status.at)}`}
      </Line>
    );
  }
  if (status.state === "unsaved") {
    return (
      <Line
        icon={
          <Box
            aria-hidden
            sx={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              backgroundColor: "warning.light",
            }}
          />
        }
      >
        Unsaved changes
      </Line>
    );
  }
  return (
    <Line icon={<ErrorOutlineIcon sx={{ fontSize: 16 }} />}>
      {status.message ?? "Not saved"}
    </Line>
  );
}

function Line({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <Stack
      direction="row"
      spacing={0.75}
      role="status"
      sx={{
        alignItems: "center",
        display: { xs: "none", lg: "flex" },
        opacity: 0.85,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      <Typography variant="caption">{children}</Typography>
    </Stack>
  );
}
