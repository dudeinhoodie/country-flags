import Box from "@mui/material/Box";
import FlagRoundedIcon from "@mui/icons-material/FlagRounded";

/** The console's app mark: a cobalt tile with the flag. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: `${String(Math.round(size * 0.28))}px`,
        display: "grid",
        placeItems: "center",
        color: "#FFFFFF",
        backgroundImage: "linear-gradient(135deg, #3A6CFF 0%, #1E44A6 100%)",
        boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.25)",
      }}
    >
      <FlagRoundedIcon sx={{ fontSize: Math.round(size * 0.62) }} />
    </Box>
  );
}
