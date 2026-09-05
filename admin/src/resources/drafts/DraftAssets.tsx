import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";
import { LoadingState } from "../../components/LoadingState";
import { AssetPreview } from "./AssetPreview";
import {
  EMPTY_SYMBOL_FIELDS,
  localizationsOf,
  patchOf,
  symbolFieldsOf,
  SymbolFieldsEditor,
} from "./SymbolFields";
import type { SymbolFieldsState } from "./SymbolFields";
import { useAssetWriter, useDraftWithAssets } from "./useDraftAssets";
import type { DraftAsset } from "./useDraftAssets";

/**
 * One entity carries several symbols, so the editor is arranged by symbol
 * rather than by row: a flag, a coat of arms, a map and whatever comes next
 * each get a section of their own, and none of them can quietly overwrite
 * another (ADR-020).
 *
 * The card's box differs per type, and that is the whole point of showing
 * it. A flag fills a 3:2 rectangle; a coat of arms is a device on nothing,
 * fitted into a near-square box with its crown, its supporters and its
 * ribbon at the outer edge — which is why every drawing is previewed inside
 * its own box, on both grounds, before anyone publishes it.
 */

interface Section {
  type: string;
  label: string;
  /** Width over height of the box a card lays this symbol out in. */
  ratio: number;
  uploadable: boolean;
  note: string;
}

const SECTIONS: Section[] = [
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
    note: "Check the crown, the supporters and the ribbon against the dashed box on both grounds: aspect-fit shows all of the drawing, and anything the drawing itself clips away is already gone.",
  },
  {
    type: "MAP",
    label: "Map",
    ratio: 4 / 3,
    uploadable: true,
    note: "",
  },
  {
    type: "OTHER",
    label: "Other",
    ratio: 1,
    uploadable: false,
    note: "The upload contract accepts FLAG, COAT_OF_ARMS and MAP. Anything already filed as OTHER is edited and retired here.",
  },
];

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function DraftAssets({
  draftId,
  editable,
}: {
  draftId: string;
  editable: boolean;
}) {
  const { draft, assets, error, reload } = useDraftWithAssets(draftId);
  const writer = useAssetWriter(draftId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [entityKey, setEntityKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (draft === null || assets === null) {
    return <LoadingState label="Loading the draft symbols…" />;
  }

  const scope = entityKey.trim();
  const inScope =
    scope.length === 0
      ? assets
      : assets.filter((asset) => asset.entityContentKey === scope);
  const knownEntities = [
    ...new Set(assets.map((asset) => asset.entityContentKey)),
  ].sort();

  function run(work: Promise<void>, fallback: string): void {
    setBusy(true);
    work.then(
      () => {
        setBusy(false);
        setActionError(null);
        setEditing(null);
        reload();
      },
      (cause: unknown) => {
        setBusy(false);
        setActionError(messageOf(cause, fallback));
      },
    );
  }

  return (
    <Stack spacing={3}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", flexWrap: "wrap" }}
      >
        <Typography variant="h6" component="h3">
          Symbols
        </Typography>
        <Chip
          size="small"
          variant="outlined"
          label={`revision ${String(draft.revision)}`}
        />
        <Box sx={{ flexGrow: 1 }} />
        <TextField
          label="Entity"
          size="small"
          value={entityKey}
          onChange={(event) => setEntityKey(event.target.value)}
          helperText="For example country.france. Empty shows every entity in the draft."
          slotProps={{ htmlInput: { list: "draft-entity-keys" } }}
          sx={{ minWidth: 280 }}
        />
        <datalist id="draft-entity-keys">
          {knownEntities.map((key) => (
            <option key={key} value={key} />
          ))}
        </datalist>
      </Stack>

      {actionError !== null && (
        <Alert severity="error" onClose={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {SECTIONS.map((section) => (
        <AssetSection
          key={section.type}
          section={section}
          draftId={draftId}
          revision={draft.revision}
          assets={inScope.filter((asset) => asset.assetType === section.type)}
          entityKey={scope}
          editable={editable}
          busy={busy}
          editing={editing}
          onEdit={setEditing}
          onUpload={(file, fields) => {
            run(
              writer.upload(file, {
                entityContentKey: scope,
                assetType: section.type,
                variant: fields.variant,
                sourceUrl: fields.symbol.sourceUrl,
                licenseName: fields.symbol.licenseName,
                licenseUrl: fields.symbol.licenseUrl,
                attribution: fields.symbol.attribution,
                replacementReason: fields.symbol.replacementReason,
                validFrom: fields.symbol.validFrom,
                validTo: fields.symbol.validTo,
                localizations: localizationsOf(fields.symbol.localizations),
              }),
              "The upload was refused",
            );
          }}
          onPatch={(asset, fields) => {
            const patch = patchOf(asset, fields);
            if (patch === null) {
              setEditing(null);
              return;
            }
            run(
              writer.patch(draft.revision, asset.id, patch),
              "The symbol could not be changed",
            );
          }}
          onRetire={(asset) => {
            run(
              writer.patch(draft.revision, asset.id, {
                validTo: asset.validTo == null ? todayIso() : null,
              }),
              "The symbol could not be retired",
            );
          }}
          onRemove={(asset) => {
            run(writer.remove(asset.id), "The symbol could not be removed");
          }}
        />
      ))}
    </Stack>
  );
}

interface UploadPayload {
  variant: string;
  symbol: SymbolFieldsState;
}

function AssetSection({
  section,
  draftId,
  assets,
  entityKey,
  editable,
  busy,
  editing,
  onEdit,
  onUpload,
  onPatch,
  onRetire,
  onRemove,
}: {
  section: Section;
  draftId: string;
  revision: number;
  assets: DraftAsset[];
  entityKey: string;
  editable: boolean;
  busy: boolean;
  editing: string | null;
  onEdit: (assetId: string | null) => void;
  onUpload: (file: File, payload: UploadPayload) => void;
  onPatch: (asset: DraftAsset, fields: SymbolFieldsState) => void;
  onRetire: (asset: DraftAsset) => void;
  onRemove: (asset: DraftAsset) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1">{section.label}</Typography>
          <Chip size="small" label={assets.length} />
          <Box sx={{ flexGrow: 1 }} />
          {editable && section.uploadable && (
            <Button size="small" onClick={() => setOpen(!open)}>
              {open ? "Close" : "Upload or replace"}
            </Button>
          )}
        </Stack>
        {section.note.length > 0 && (
          <Typography variant="body2" color="text.secondary">
            {section.note}
          </Typography>
        )}

        {assets.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing in this draft. The catalog keeps publishing whatever it
            publishes today.
          </Typography>
        ) : (
          assets.map((asset) => (
            <AssetRow
              key={asset.id}
              asset={asset}
              section={section}
              draftId={draftId}
              editable={editable}
              busy={busy}
              editing={editing === asset.id}
              onEdit={onEdit}
              onPatch={onPatch}
              onRetire={onRetire}
              onRemove={onRemove}
            />
          ))
        )}

        {open && editable && section.uploadable && (
          <>
            <Divider />
            <UploadForm
              section={section}
              entityKey={entityKey}
              busy={busy}
              onUpload={onUpload}
            />
          </>
        )}
      </Stack>
    </Paper>
  );
}

function AssetRow({
  asset,
  section,
  draftId,
  editable,
  busy,
  editing,
  onEdit,
  onPatch,
  onRetire,
  onRemove,
}: {
  asset: DraftAsset;
  section: Section;
  draftId: string;
  editable: boolean;
  busy: boolean;
  editing: boolean;
  onEdit: (assetId: string | null) => void;
  onPatch: (asset: DraftAsset, fields: SymbolFieldsState) => void;
  onRetire: (asset: DraftAsset) => void;
  onRemove: (asset: DraftAsset) => void;
}) {
  const config = useRuntimeConfig();
  const [fields, setFields] = useState<SymbolFieldsState>(() =>
    symbolFieldsOf(asset),
  );
  const retired = asset.validTo != null;
  const english = asset.localizations?.en;

  return (
    <Box>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2}
        sx={{ alignItems: { md: "center" } }}
      >
        <AssetPreview
          src={`${config.apiBasePath}/v1/admin/content/drafts/${draftId}/assets/${asset.id}/preview`}
          ratio={section.ratio}
          label={`${asset.entityContentKey} ${section.label}`}
        />
        <Stack spacing={0.5} sx={{ flex: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="body2">
              <code>{asset.entityContentKey}</code>
            </Typography>
            <Chip size="small" variant="outlined" label={asset.variant} />
            {retired && <Chip size="small" color="warning" label="retired" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {english?.displayName ?? "no display name yet"}
            {" · "}
            {asset.licenseName ?? "no licence"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {asset.validFrom ?? "…"} → {asset.validTo ?? "in force"}
          </Typography>
        </Stack>
        {editable && (
          <Stack direction="row" spacing={1}>
            <Button
              size="small"
              disabled={busy}
              onClick={() => {
                setFields(symbolFieldsOf(asset));
                onEdit(editing ? null : asset.id);
              }}
            >
              {editing ? "Cancel" : "Edit"}
            </Button>
            <Button
              size="small"
              color="warning"
              disabled={busy}
              onClick={() => onRetire(asset)}
            >
              {retired ? "Reinstate" : "Retire"}
            </Button>
            <Button
              size="small"
              color="error"
              disabled={busy}
              onClick={() => onRemove(asset)}
            >
              Remove
            </Button>
          </Stack>
        )}
      </Stack>

      {editing && (
        <Box sx={{ mt: 2, pl: { md: 2 } }}>
          <SymbolFieldsEditor
            fields={fields}
            onChange={setFields}
            disabled={busy}
          />
          <Box sx={{ mt: 2 }}>
            <Button
              variant="contained"
              size="small"
              disabled={busy}
              onClick={() => onPatch(asset, fields)}
            >
              Save
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

function UploadForm({
  section,
  entityKey,
  busy,
  onUpload,
}: {
  section: Section;
  entityKey: string;
  busy: boolean;
  onUpload: (file: File, payload: UploadPayload) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [variant, setVariant] = useState("default");
  const [fields, setFields] = useState<SymbolFieldsState>(EMPTY_SYMBOL_FIELDS);
  const ready = file !== null && entityKey.length > 0;

  return (
    <Stack spacing={2}>
      <Typography variant="subtitle2">
        Upload a {section.label.toLowerCase()}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Uploading over an entity, type and variant that already exist replaces
        the drawing in place; the row and the audit trail stay. To keep the old
        drawing as history, retire it and upload the successor under a variant
        of its own.
      </Typography>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <Button component="label" variant="outlined" size="small">
          {file === null ? "Choose an SVG or PNG" : file.name}
          <input
            type="file"
            hidden
            accept="image/svg+xml,image/png"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Button>
        <TextField
          label="Variant"
          size="small"
          value={variant}
          onChange={(event) => setVariant(event.target.value)}
          helperText="default, 1949, civil…"
        />
      </Stack>
      <SymbolFieldsEditor
        fields={fields}
        onChange={setFields}
        disabled={busy}
      />
      <Box>
        <Button
          variant="contained"
          disabled={busy || !ready}
          onClick={() => {
            if (file === null) {
              return;
            }
            onUpload(file, { variant, symbol: fields });
          }}
        >
          Upload
        </Button>
        {entityKey.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Name the entity above first: a symbol belongs to one.
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
