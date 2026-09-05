import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { EnvironmentBadge } from "../../components/EnvironmentBadge";
import type { CommerceStatus } from "./useCommerce";

/**
 * The heading every commerce screen wears.
 *
 * Two badges, not one: the console's environment says which deployment you
 * are looking at, and the store badge says which App Store answers it.
 * Mapping a Sandbox product while looking at production is the mistake this
 * whole section exists to prevent (docs/17 §12.2), and a screen that did not
 * say which store it meant would be the way to make it.
 */
export function CommerceHeader({
  title,
  status,
}: {
  title: string;
  status: CommerceStatus | null;
}) {
  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{ alignItems: "center", flexWrap: "wrap" }}
    >
      <Typography variant="subtitle2">{title}</Typography>
      <EnvironmentBadge />
      {status !== null && (
        <Chip
          size="small"
          variant="outlined"
          color={status.storeEnvironment === "PRODUCTION" ? "error" : undefined}
          label={`store ${status.storeEnvironment}`}
        />
      )}
    </Stack>
  );
}

/**
 * The sentence that has to survive every redesign of this section.
 *
 * It is repeated on the screens that touch a store listing because an
 * operator looking for a price field should find the reason there is none
 * rather than conclude the field has not been built yet.
 */
export function NoPriceHere() {
  return (
    <Typography variant="caption" color="text.secondary">
      No price is set here. What a deck costs is store metadata: App Store
      Connect owns it, this console records the mapping and runs a read-only
      check.
    </Typography>
  );
}
