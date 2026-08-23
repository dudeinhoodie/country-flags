import Chip from "@mui/material/Chip";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";
import type { AdminEnvironment } from "../config/runtime-config";

const BADGE_COLOR: Record<AdminEnvironment, "default" | "info" | "error"> = {
  local: "default",
  dev: "info",
  prod: "error",
};

/**
 * Always-visible environment marker (docs/adr/ADR-014). An operator must
 * never wonder whether a screen shows dev or prod data.
 */
export function EnvironmentBadge() {
  const { environment, appVersion } = useRuntimeConfig();
  return (
    <Chip
      label={environment.toUpperCase()}
      color={BADGE_COLOR[environment]}
      variant={environment === "local" ? "outlined" : "filled"}
      size="small"
      title={`Build ${appVersion}`}
      sx={{ fontWeight: 700, letterSpacing: "0.08em" }}
    />
  );
}
