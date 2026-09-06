import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Link } from "react-router-dom";
import { routes } from "../../app/routes";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";
import { LoadingState } from "../../components/LoadingState";
import { AssetPreview } from "./AssetPreview";
import { patchOf, symbolFieldsOf, SymbolFieldsEditor } from "./SymbolFields";
import type { SymbolFieldsState } from "./SymbolFields";
import { useAssetWriter, useDraftWithAssets } from "./useDraftAssets";
import type { DraftAsset, DraftStamp } from "./useDraftAssets";

/**
 * Everything uploaded into the draft, as a queue and an audit (§7.3).
 *
 * Uploading happens on the entity that owns the symbol, where the country
 * and the symbol type come from context rather than from a text field
 * (§7.2). What is left here is the work that spans entities: drawings whose
 * provenance is incomplete, ones that have been retired, and rows to correct
 * — each with a way back to the entity it belongs to.
 *
 * One entity carries several symbols, so the screen is arranged by symbol
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
  note: string;
}

const SECTIONS: Section[] = [
  {
    type: "FLAG",
    label: "Flag",
    ratio: 3 / 2,
    note: "A flag fills its box; the hairline is what keeps a mostly-white one from dissolving into the surface.",
  },
  {
    type: "COAT_OF_ARMS",
    label: "Coat of arms",
    ratio: 4 / 5,
    note: "Check the crown, the supporters and the ribbon against the dashed box on both grounds: aspect-fit shows all of the drawing, and anything the drawing itself clips away is already gone.",
  },
  {
    type: "MAP",
    label: "Map",
    ratio: 4 / 3,
    note: "",
  },
  {
    type: "OTHER",
    label: "Other",
    ratio: 1,
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
  // What this screen's own writes moved the draft to. The re-read that
  // follows one lands a moment later, and a second change in that window
  // would otherwise be aimed at the revision it just replaced.
  const [written, setWritten] = useState(0);

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

  // Revisions only go up, so the newer of the two readings is the true one
  // whichever arrives first.
  const revision = Math.max(written, draft.revision);

  function run(work: Promise<DraftStamp | null>, fallback: string): void {
    setBusy(true);
    work.then(
      (stamp) => {
        setBusy(false);
        setActionError(null);
        if (stamp !== null) {
          setWritten(stamp.revision);
        }
        // The panel closes on success, which is also what discards the form
        // it held: a form still holding what it just sent invites sending it
        // twice.
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
          label={`revision ${String(revision)}`}
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
          assets={inScope.filter((asset) => asset.assetType === section.type)}
          editable={editable}
          busy={busy}
          editing={editing}
          onEdit={setEditing}
          onPatch={(asset, fields) => {
            const patch = patchOf(asset, fields);
            if (patch === null) {
              setEditing(null);
              return;
            }
            run(
              writer.patch(revision, asset.id, patch),
              "The symbol could not be changed",
            );
          }}
          onRetire={(asset) => {
            run(
              writer.patch(revision, asset.id, {
                validTo: asset.validTo == null ? todayIso() : null,
              }),
              "The symbol could not be retired",
            );
          }}
          onRemove={(asset) => {
            // Removal answers 204, so there is no new stamp to adopt; the
            // re-read below is what brings the revision forward.
            run(
              writer.remove(asset.id).then(() => null),
              "The symbol could not be removed",
            );
          }}
        />
      ))}
    </Stack>
  );
}

function AssetSection({
  section,
  draftId,
  assets,
  editable,
  busy,
  editing,
  onEdit,
  onPatch,
  onRetire,
  onRemove,
}: {
  section: Section;
  draftId: string;
  assets: DraftAsset[];
  editable: boolean;
  busy: boolean;
  editing: string | null;
  onEdit: (assetId: string | null) => void;
  onPatch: (asset: DraftAsset, fields: SymbolFieldsState) => void;
  onRetire: (asset: DraftAsset) => void;
  onRemove: (asset: DraftAsset) => void;
}) {
  return (
    <Paper
      variant="outlined"
      component="section"
      aria-label={`${section.label} queue`}
      sx={{ p: 2 }}
    >
      <Stack spacing={2}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="subtitle1" component="h3">
            {section.label}
          </Typography>
          <Chip size="small" label={assets.length} />
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
  // The publish gate blocks on all three, so the queue says so here rather
  // than leaving it to be discovered at Review (§7.3).
  const provenanceComplete =
    asset.licenseName != null &&
    asset.sourceUrl != null &&
    asset.replacementReason != null;

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
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: "center", flexWrap: "wrap" }}
          >
            <Typography variant="body2">
              <code>{asset.entityContentKey}</code>
            </Typography>
            <Chip size="small" variant="outlined" label={asset.variant} />
            {retired && <Chip size="small" color="warning" label="retired" />}
            {!provenanceComplete && (
              <Chip
                size="small"
                color="error"
                variant="outlined"
                label="provenance incomplete"
              />
            )}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {english?.displayName ?? "no display name yet"}
            {" · "}
            {asset.licenseName ?? "no licence"}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {asset.validFrom ?? "…"} → {asset.validTo ?? "in force"}
          </Typography>
          <Box>
            {/* Replacing the drawing happens where the entity is known, so
                the country is never typed into an upload form (§7.2). */}
            <Link
              to={`${routes.draftEntity(draftId, asset.entityContentKey)}/media`}
            >
              Open the entity’s media
            </Link>
          </Box>
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
