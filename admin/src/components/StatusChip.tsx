import Chip from "@mui/material/Chip";

type Tone = "default" | "success" | "warning" | "error" | "info" | "primary";

/**
 * One vocabulary for lifecycle words across every screen: the same status
 * reads the same whether it belongs to a country, a deck, a draft or an
 * operator. Unknown values stay legible in the neutral tone.
 */
const STATUS_TONE: Record<string, Tone> = {
  active: "success",
  ACTIVE: "success",
  PUBLISHED: "success",
  READY: "info",
  PROPOSED: "info",
  historical: "warning",
  retired: "default",
  hidden: "error",
  DISABLED: "default",
};

const ROLE_TONE: Record<string, Tone> = {
  ADMIN: "primary",
  PUBLISHER: "warning",
  EDITOR: "info",
  VIEWER: "default",
};

function ToneChip({ value, tone }: { value: string; tone: Tone }) {
  return (
    <Chip
      label={value}
      size="small"
      variant="outlined"
      color={tone === "default" ? undefined : tone}
    />
  );
}

export function StatusChip({ value }: { value: string }) {
  return <ToneChip value={value} tone={STATUS_TONE[value] ?? "default"} />;
}

export function RoleChip({ value }: { value: string }) {
  return <ToneChip value={value} tone={ROLE_TONE[value] ?? "default"} />;
}
