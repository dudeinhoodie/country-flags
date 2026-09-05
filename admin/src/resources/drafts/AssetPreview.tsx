import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * The drawing as a card will show it: aspect-fit inside the card's box, on
 * both grounds the app uses.
 *
 * Both grounds, because a symbol drawn for one disappears on the other — a
 * white-outlined eagle on white, a dark ribbon on dark — and the editor is
 * the only place anyone looks at the drawing before it reaches a learner.
 * The dashed outline is the box itself: what falls inside it is what the
 * card will show, and for a coat of arms that is the whole question, since
 * the crown, the supporters and the ribbon are what sits nearest the edge.
 */
export function AssetPreview({
  src,
  ratio,
  label,
  height = 96,
}: {
  src: string;
  /** Width over height of the box the card lays this symbol out in. */
  ratio: number;
  label: string;
  height?: number;
}) {
  return (
    <Stack direction="row" spacing={1}>
      <SafeAreaBox
        src={src}
        ratio={ratio}
        height={height}
        ground="#ffffff"
        caption="on light"
        label={label}
      />
      <SafeAreaBox
        src={src}
        ratio={ratio}
        height={height}
        ground="#16202e"
        caption="on dark"
        label={label}
      />
    </Stack>
  );
}

function SafeAreaBox({
  src,
  ratio,
  height,
  ground,
  caption,
  label,
}: {
  src: string;
  ratio: number;
  height: number;
  ground: string;
  caption: string;
  label: string;
}) {
  return (
    <Stack spacing={0.5} sx={{ alignItems: "center" }}>
      <Box
        sx={{
          width: height * ratio,
          height,
          backgroundColor: ground,
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          p: 0.5,
        }}
      >
        <Box
          component="img"
          src={src}
          alt={`${label}, ${caption}`}
          sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary">
        {caption}
      </Typography>
    </Stack>
  );
}
