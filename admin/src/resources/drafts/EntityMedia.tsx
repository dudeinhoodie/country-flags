import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import LinearProgress from "@mui/material/LinearProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";
import type { components } from "../../api/generated/admin-api";
import { EmptyState } from "../../components/StateViews";
import { AssetPreview } from "./AssetPreview";
import {
  EMPTY_SYMBOL_FIELDS,
  localizationsOf,
  SymbolFieldsEditor,
} from "./SymbolFields";
import type { SymbolFieldsState } from "./SymbolFields";
import type { AssetUploadFields } from "./useDraftAssets";

type AssetSlot = components["schemas"]["AdminEntityAssetSlot"];
type ProcessingState = components["schemas"]["AdminAssetProcessingState"];

/**
 * The entity's own symbols (§7.1).
 *
 * Slots rather than a table: a flag and a coat of arms are two independent
 * drawings of one country, and the editor is arranged so that filling one
 * can never quietly replace the other. `Add coat of arms` lives in the empty
 * slot, and the slot says which card template filling it would unlock.
 *
 * The upload drawer opens from a slot, so `entityKey` and `assetType` come
 * from context and are never typed (§7.2, acceptance criterion 1). That is
 * also what makes a failed or still-processing upload recoverable: retrying
 * is one button, not a form filled in again from memory.
 */

interface SlotKind {
  type: string;
  label: string;
  /** Width over height of the box a card lays this symbol out in. */
  ratio: number;
  uploadable: boolean;
  note: string;
}

const SLOT_KINDS: readonly SlotKind[] = [
  {
    type: "FLAG",
    label: "Flag",
    ratio: 3 / 2,
    uploadable: true,
    note: "A flag fills its box; the hairline is what keeps a mostly-white one from dissolving into the surface.",
  },
  {
    type: "COAT_OF_ARMS",
    label: "Coat of arms",
    ratio: 4 / 5,
    uploadable: true,
    note: "Check the crown, the supporters and the ribbon against the dashed box on both grounds: what falls outside it is not on the card.",
  },
  { type: "MAP", label: "Map", ratio: 4 / 3, uploadable: true, note: "" },
  {
    type: "OTHER",
    label: "Other media",
    ratio: 1,
    uploadable: false,
    note: "The upload contract accepts FLAG, COAT_OF_ARMS and MAP. Anything already filed as OTHER is edited and retired on the media screen.",
  },
];

const DELIVERY_LABEL: Record<string, string> = {
  PUBLIC: "Public",
  PUBLIC_PREVIEW: "Public preview",
  PAID_ONLY: "Paid-only",
};

const PROCESSING_LABEL: Record<ProcessingState, string> = {
  PROCESSING: "Processing",
  READY: "Ready",
  FAILED: "Processing failed",
};

export interface UploadRequest {
  file: File;
  fields: AssetUploadFields;
}

export function EntityMedia({
  draftId,
  entityKey,
  slots,
  editable,
  busy,
  uploadError,
  onUpload,
  onDismissError,
}: {
  draftId: string;
  entityKey: string;
  slots: readonly AssetSlot[];
  editable: boolean;
  busy: boolean;
  /** Why the last upload was refused, if it was. */
  uploadError: string | null;
  onUpload: (request: UploadRequest) => void;
  onDismissError: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const byType = new Map(slots.map((slot) => [slot.assetType, slot]));

  function openUpload(type: string, from: HTMLElement | null): void {
    opener.current = from;
    onDismissError();
    setOpen(type);
  }

  // A drawer hands focus back to the control that opened it (§11); otherwise
  // a keyboard reader is returned to the top of the document each time.
  function closeUpload(): void {
    setOpen(null);
    opener.current?.focus();
  }

  const kind = SLOT_KINDS.find((entry) => entry.type === open) ?? null;

  return (
    <Stack spacing={2}>
      {SLOT_KINDS.map((slotKind) => (
        <SlotCard
          key={slotKind.type}
          kind={slotKind}
          slot={byType.get(slotKind.type) ?? null}
          draftId={draftId}
          entityKey={entityKey}
          editable={editable}
          busy={busy}
          onUpload={(from) => {
            openUpload(slotKind.type, from);
          }}
        />
      ))}

      <Drawer
        anchor="right"
        open={kind !== null}
        onClose={closeUpload}
        slotProps={{
          paper: {
            sx: { width: { xs: "100%", sm: 520 }, p: 3 },
            role: "dialog",
            "aria-label": kind === null ? undefined : `Upload a ${kind.label}`,
          },
        }}
      >
        {kind !== null && (
          <UploadDrawer
            kind={kind}
            entityKey={entityKey}
            busy={busy}
            error={uploadError}
            onCancel={closeUpload}
            onUpload={onUpload}
          />
        )}
      </Drawer>
    </Stack>
  );
}

function SlotCard({
  kind,
  slot,
  draftId,
  entityKey,
  editable,
  busy,
  onUpload,
}: {
  kind: SlotKind;
  slot: AssetSlot | null;
  draftId: string;
  entityKey: string;
  editable: boolean;
  busy: boolean;
  onUpload: (from: HTMLElement | null) => void;
}) {
  const config = useRuntimeConfig();
  const filled = slot !== null && slot.state !== "empty";
  const processing = slot?.processing ?? null;

  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={`${kind.label} slot`}
      sx={{ p: 2 }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ alignItems: "center", flexWrap: "wrap" }}
        >
          <Typography variant="subtitle1" component="h3">
            {kind.label}
          </Typography>
          {slot !== null && filled && (
            <Chip
              size="small"
              variant="outlined"
              label={
                slot.state === "draft" ? "From this draft" : "From the release"
              }
            />
          )}
          {slot?.delivery != null && (
            <Chip
              size="small"
              variant="outlined"
              color={slot.delivery === "PAID_ONLY" ? "warning" : "default"}
              label={DELIVERY_LABEL[slot.delivery] ?? slot.delivery}
            />
          )}
          {processing !== null && (
            <Chip
              size="small"
              color={
                processing === "FAILED"
                  ? "error"
                  : processing === "PROCESSING"
                    ? "info"
                    : "success"
              }
              label={PROCESSING_LABEL[processing]}
            />
          )}
          {slot?.retired === true && (
            <Chip size="small" color="warning" label="Retired" />
          )}
          <Box sx={{ flexGrow: 1 }} />
          {editable && kind.uploadable && (
            <Button
              size="small"
              variant={filled ? "outlined" : "contained"}
              disabled={busy}
              onClick={(event) => {
                onUpload(event.currentTarget);
              }}
            >
              {filled
                ? `Replace ${kind.label.toLowerCase()}`
                : `Add ${kind.label.toLowerCase()}`}
            </Button>
          )}
        </Stack>

        {processing === "PROCESSING" && (
          <Box>
            <LinearProgress aria-label={`${kind.label} is being processed`} />
            <Typography variant="caption" color="text.secondary">
              The drawing is being inspected. It stays in the draft either way;
              nothing has to be uploaded again while this runs.
            </Typography>
          </Box>
        )}
        {processing === "FAILED" && (
          <Alert severity="error">
            The inspection refused this drawing. Replace it from this slot — the
            country and the symbol type are already filled in, so only the file
            and its provenance are needed again.
          </Alert>
        )}

        {slot === null || !filled ? (
          <EmptyState
            title={`No ${kind.label.toLowerCase()} yet`}
            description={
              kind.uploadable
                ? unlocksSentence(slot)
                : "Nothing is filed here for this entity."
            }
          />
        ) : (
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            sx={{ alignItems: { md: "flex-start" } }}
          >
            {slot.draftAssetId !== null && (
              <AssetPreview
                src={`${config.apiBasePath}/v1/admin/content/drafts/${draftId}/assets/${slot.draftAssetId}/preview`}
                ratio={kind.ratio}
                label={`${entityKey} ${kind.label}`}
              />
            )}
            <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
              <Fact
                label="Licence"
                field="/licenseName"
                value={slot.licenseName ?? null}
              />
              <Fact
                label="Source"
                field="/sourceUrl"
                value={slot.sourceUrl ?? null}
              />
              <Fact
                label="Replacement reason"
                field="/replacementReason"
                value={slot.replacementReason ?? null}
              />
              <Typography variant="caption" color="text.secondary">
                {slot.provenanceComplete
                  ? "Provenance complete."
                  : "Provenance incomplete — a release is blocked until licence, source and reason are all filled in."}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {`Locales: ${
                  slot.localizations.missing.length === 0
                    ? "complete"
                    : `missing ${slot.localizations.missing.join(", ")}`
                }`}
              </Typography>
              {slot.usedByDeckKeys.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {`Used by ${slot.usedByDeckKeys.join(", ")}`}
                </Typography>
              )}
            </Stack>
          </Stack>
        )}

        {kind.note.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {kind.note}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function unlocksSentence(slot: AssetSlot | null): string {
  const templates = slot?.unlocksTemplates ?? [];
  if (templates.length === 0) {
    return "No card template teaches this entity through this symbol, so filling the slot unlocks nothing yet.";
  }
  return `Filling this slot makes ${templates.join(", ")} buildable for this entity.`;
}

/** One provenance line, addressable so a finding can land on it (§9). */
function Fact({
  label,
  field,
  value,
}: {
  label: string;
  field: string;
  value: string | null;
}): ReactNode {
  return (
    <Typography variant="body2" data-field={field} tabIndex={-1}>
      <Box component="span" sx={{ fontWeight: 700 }}>
        {label}
      </Box>{" "}
      {value ?? (
        <Box component="span" sx={{ color: "warning.main" }}>
          not recorded
        </Box>
      )}
    </Typography>
  );
}

function UploadDrawer({
  kind,
  entityKey,
  busy,
  error,
  onCancel,
  onUpload,
}: {
  kind: SlotKind;
  entityKey: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onUpload: (request: UploadRequest) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [variant, setVariant] = useState("default");
  const [fields, setFields] = useState<SymbolFieldsState>(EMPTY_SYMBOL_FIELDS);

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h2">
        {`Upload a ${kind.label.toLowerCase()}`}
      </Typography>
      {/* The context is stated rather than asked for: a symbol belongs to the
          entity whose slot this is, and typing the key again is how the wrong
          country ends up with the right flag. */}
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip size="small" label={entityKey} />
        <Chip size="small" label={kind.type} />
      </Stack>
      {error !== null && (
        <Alert severity="error">
          {error}
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>
            Everything you typed is still here. Fix what the message names and
            send it again.
          </Typography>
        </Alert>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Button component="label" variant="outlined" size="small">
          {file === null ? "Choose an SVG or PNG" : file.name}
          <input
            type="file"
            hidden
            accept="image/svg+xml,image/png"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
            }}
          />
        </Button>
        <TextField
          label="Variant"
          size="small"
          value={variant}
          onChange={(event) => {
            setVariant(event.target.value);
          }}
          helperText="default, 1949, civil…"
        />
      </Stack>
      <Divider />
      <SymbolFieldsEditor
        fields={fields}
        onChange={setFields}
        disabled={busy}
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || file === null}
          onClick={() => {
            if (file === null) {
              return;
            }
            onUpload({
              file,
              fields: {
                entityContentKey: entityKey,
                assetType: kind.type,
                variant,
                sourceUrl: fields.sourceUrl,
                licenseName: fields.licenseName,
                licenseUrl: fields.licenseUrl,
                attribution: fields.attribution,
                replacementReason: fields.replacementReason,
                validFrom: fields.validFrom,
                validTo: fields.validTo,
                localizations: localizationsOf(fields.localizations),
              },
            });
          }}
        >
          {busy ? "Uploading…" : "Upload"}
        </Button>
      </Stack>
    </Stack>
  );
}
