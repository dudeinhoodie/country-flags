import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";

/**
 * The bar that stays with the editor to the bottom of a long form.
 *
 * One primary action per context is a principle rather than a preference
 * (§3.6): the bar takes exactly one `primary`, and everything competing for
 * attention has to be a secondary. The status slot on the left says why the
 * primary is disabled, which is the question a greyed-out button provokes.
 */
export function StickyActionBar({
  status,
  secondary,
  primary,
  label = "Page actions",
}: {
  status?: ReactNode;
  secondary?: ReactNode;
  primary?: ReactNode;
  label?: string;
}) {
  return (
    <Paper
      component="section"
      aria-label={label}
      sx={{
        position: "sticky",
        bottom: 0,
        zIndex: (theme) => theme.zIndex.appBar - 1,
        mt: 3,
        px: 2,
        py: 1.5,
        borderRadius: 0,
        borderTop: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        // The content above must be able to scroll out from under it.
        boxShadow: "0 -1px 2px rgba(22, 32, 46, 0.06)",
      }}
    >
      <Stack
        direction="row"
        spacing={2}
        useFlexGap
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Box sx={{ flexGrow: 1, minWidth: 160 }}>
          {typeof status === "string" ? (
            <Typography variant="body2" color="text.secondary">
              {status}
            </Typography>
          ) : (
            status
          )}
        </Box>
        {secondary}
        {primary}
      </Stack>
    </Paper>
  );
}
