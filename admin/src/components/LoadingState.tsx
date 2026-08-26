import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/** The one way a screen waits: centered, labeled, no layout jump. */
export function LoadingState({ label }: { label: string }) {
  return (
    <Stack spacing={2} sx={{ alignItems: "center", py: 8 }} role="status">
      <CircularProgress size={28} />
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
