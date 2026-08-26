import Chip from "@mui/material/Chip";
import { ENV_CHIP } from "../app/theme";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";

/**
 * Always-visible environment marker (docs/adr/ADR-014). An operator must
 * never wonder whether a screen shows dev or prod data; the styles come
 * from the theme module so the treatment is a design-system decision.
 */
export function EnvironmentBadge() {
  const { environment, appVersion } = useRuntimeConfig();
  const style = ENV_CHIP[environment];
  return (
    <Chip
      label={environment.toUpperCase()}
      size="small"
      title={`Build ${appVersion}`}
      sx={{
        height: 22,
        fontWeight: 800,
        letterSpacing: "0.1em",
        backgroundColor: style.background,
        color: style.color,
        border: style.border ?? "none",
      }}
    />
  );
}
