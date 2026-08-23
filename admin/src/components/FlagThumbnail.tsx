import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

interface FlagLike {
  representations: { url: string; mimeType: string }[];
}

/**
 * A missing flag renders a visible diagnostic instead of an empty cell:
 * on this screen an absent asset is a content problem, not a styling one.
 */
export function FlagThumbnail({
  flag,
  height = 24,
}: {
  flag: FlagLike | null | undefined;
  height?: number;
}) {
  const url = flag?.representations[0]?.url;
  if (url === undefined) {
    return (
      <Box
        sx={{
          height,
          px: 1,
          display: "inline-flex",
          alignItems: "center",
          border: "1px dashed",
          borderColor: "error.main",
        }}
      >
        <Typography variant="caption" color="error">
          no flag
        </Typography>
      </Box>
    );
  }
  return (
    <Box
      component="img"
      src={url}
      alt=""
      sx={{ height, border: "1px solid", borderColor: "divider" }}
    />
  );
}
