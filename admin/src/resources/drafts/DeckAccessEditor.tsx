import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import { EnvironmentBadge } from "../../components/EnvironmentBadge";
import { entitlementKeyProblem } from "./deck-cards";
import type { CommerceContour } from "./useDraftDecks";

export interface DeckAccessValue {
  model: "FREE" | "ENTITLEMENT";
  requiredEntitlementKey: string;
}

/** How the active release serves this deck, which is what buyers have. */
export type PublishedAccess = "unpublished" | "free" | "paid";

/**
 * One validation line: what was checked, and whether it held. "Cannot check"
 * is its own answer — a cross an operator cannot act on would be worse than
 * saying the commerce contour is not reachable from here.
 */
function Verdict({
  state,
  children,
}: {
  state: "ok" | "bad" | "unknown";
  children: ReactNode;
}) {
  const mark = state === "ok" ? "✓" : state === "bad" ? "✗" : "…";
  const color =
    state === "ok"
      ? "success.main"
      : state === "bad"
        ? "error.main"
        : "text.secondary";
  return (
    <Typography variant="body2" sx={{ color }}>
      {mark} {children}
    </Typography>
  );
}

/**
 * Who may open the deck (docs/17 §12.1).
 *
 * There is no price field here and there never will be: the store owns what
 * a thing costs, and a console that promised a number would eventually
 * promise a wrong one. Every control that touches commerce carries the
 * environment badge, because mapping a Sandbox product while looking at
 * production is the mistake this block exists to prevent.
 */
export function DeckAccessEditor({
  value,
  published,
  contour,
  disabled,
  onChange,
}: {
  value: DeckAccessValue;
  published: PublishedAccess;
  contour: CommerceContour;
  disabled: boolean;
  onChange: (next: DeckAccessValue) => void;
}) {
  const paid = value.model === "ENTITLEMENT";
  const key = value.requiredEntitlementKey.trim();
  const keyProblem = paid
    ? entitlementKeyProblem(value.requiredEntitlementKey)
    : null;
  const offers = contour.offersByEntitlement.get(key) ?? [];
  const activeOffers = offers.filter((offer) => offer.status === "ACTIVE");
  const validatedOffers = activeOffers.filter((offer) => offer.validatedHere);

  function verdict(held: boolean): "ok" | "bad" | "unknown" {
    if (!contour.loaded || !contour.available) {
      return "unknown";
    }
    return held ? "ok" : "bad";
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2">Access</Typography>
        <EnvironmentBadge />
        {contour.storeEnvironment !== null && (
          <Chip
            size="small"
            variant="outlined"
            label={`store ${contour.storeEnvironment}`}
          />
        )}
      </Stack>

      <RadioGroup
        data-field="/access/model"
        value={value.model}
        onChange={(event) =>
          onChange({
            ...value,
            model: event.target.value as DeckAccessValue["model"],
          })
        }
      >
        <FormControlLabel
          value="FREE"
          control={<Radio size="small" />}
          disabled={disabled}
          label="Free"
        />
        <FormControlLabel
          value="ENTITLEMENT"
          control={<Radio size="small" />}
          disabled={disabled || published === "free"}
          label="Paid — an entitlement is required"
        />
      </RadioGroup>

      {published === "free" && (
        <Alert severity="info">
          This deck is published free, so it cannot be made paid: everyone who
          has it would lose it. Publish a new deck instead, or run an approved
          entitlement migration.
        </Alert>
      )}

      {paid && (
        <>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              label="Entitlement key"
              data-field="/access/requiredEntitlementKey"
              value={value.requiredEntitlementKey}
              size="small"
              disabled={disabled || published === "paid"}
              error={keyProblem !== null}
              onChange={(event) =>
                onChange({
                  ...value,
                  requiredEntitlementKey: event.target.value,
                })
              }
              helperText={
                published === "paid"
                  ? "This deck is published against this key. Changing it is an entitlement migration, not an edit."
                  : (keyProblem ??
                    "The stable right a purchase grants. It is not a store product id.")
              }
              sx={{ minWidth: 340 }}
            />
            <EnvironmentBadge />
          </Stack>

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Offers:
            </Typography>
            {offers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {contour.available ? "none yet" : "not readable here"}
              </Typography>
            ) : (
              offers.map((offer) => (
                <Chip
                  key={offer.code}
                  size="small"
                  label={`${offer.code}${offer.validatedHere ? " ✓" : ""}`}
                  color={offer.status === "ACTIVE" ? "default" : "warning"}
                  variant="outlined"
                />
              ))
            )}
            <EnvironmentBadge />
          </Stack>

          <Divider />

          <Stack spacing={0.25}>
            <Verdict state={verdict(contour.entitlementKeys.has(key))}>
              the entitlement exists
            </Verdict>
            <Verdict state={verdict(activeOffers.length > 0)}>
              an active offer grants it
            </Verdict>
            <Verdict state={verdict(validatedOffers.length > 0)}>
              its product is verified in this environment
            </Verdict>
          </Stack>

          {contour.loaded && !contour.available && (
            <Alert severity="info">
              This deployment does not serve the commerce contour yet, so the
              three checks above cannot run here. The publish gate runs them
              against the release before anything ships.
            </Alert>
          )}

          <Typography variant="caption" color="text.secondary">
            No price is set here. What the deck costs is store metadata, read
            back from App Store Connect and never authored in the console.
          </Typography>
        </>
      )}
    </Stack>
  );
}
