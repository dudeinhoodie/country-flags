import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import type {
  AssetLocalizations,
  AssetPatch,
  DraftAsset,
} from "./useDraftAssets";

/**
 * What a symbol carries besides its bytes: where the drawing came from, on
 * what terms it may be shown, when it was the symbol, and what it is called.
 *
 * The words belong to the drawing rather than to the country. A country has
 * one name; its coat of arms has a name of its own and a story of its own,
 * and replacing the coat replaces both while the flag beside it keeps its
 * own (ADR-020). The same form serves an upload and a later correction,
 * because they are the same facts either way.
 */

export interface LocalizationRow {
  locale: string;
  displayName: string;
  description: string;
}

export interface SymbolFieldsState {
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  replacementReason: string;
  validFrom: string;
  validTo: string;
  localizations: LocalizationRow[];
}

/** en and ru are the pair a release may not go out without. */
export const EMPTY_SYMBOL_FIELDS: SymbolFieldsState = {
  sourceUrl: "",
  licenseName: "",
  licenseUrl: "",
  attribution: "",
  replacementReason: "",
  validFrom: "",
  validTo: "",
  localizations: [
    { locale: "en", displayName: "", description: "" },
    { locale: "ru", displayName: "", description: "" },
  ],
};

export function symbolFieldsOf(asset: DraftAsset): SymbolFieldsState {
  const rows = Object.entries(asset.localizations ?? {}).map(
    ([locale, localized]) => ({
      locale,
      displayName: localized.displayName ?? "",
      description: localized.description ?? "",
    }),
  );
  return {
    sourceUrl: asset.sourceUrl ?? "",
    licenseName: asset.licenseName ?? "",
    licenseUrl: asset.licenseUrl ?? "",
    attribution: asset.attribution ?? "",
    replacementReason: asset.replacementReason ?? "",
    validFrom: asset.validFrom ?? "",
    validTo: asset.validTo ?? "",
    localizations: rows.length > 0 ? rows : EMPTY_SYMBOL_FIELDS.localizations,
  };
}

export function localizationsOf(rows: LocalizationRow[]): AssetLocalizations {
  const localizations: AssetLocalizations = {};
  for (const row of rows) {
    const locale = row.locale.trim();
    const displayName = row.displayName.trim();
    const description = row.description.trim();
    // A locale that says nothing is not a locale; the server refuses one,
    // and an untouched seed row is the usual way to produce it.
    if (locale.length === 0) {
      continue;
    }
    if (displayName.length === 0 && description.length === 0) {
      continue;
    }
    localizations[locale] = {
      ...(displayName.length > 0 ? { displayName } : {}),
      ...(description.length > 0 ? { description } : {}),
    };
  }
  return localizations;
}

function sameLocalizations(
  left: AssetLocalizations,
  right: AssetLocalizations,
): boolean {
  const canonical = (value: AssetLocalizations): string =>
    JSON.stringify(
      Object.keys(value)
        .sort()
        .map((locale) => [
          locale,
          value[locale]?.displayName ?? null,
          value[locale]?.description ?? null,
        ]),
    );
  return canonical(left) === canonical(right);
}

/**
 * Only what the editor actually changed. A patch that repeats the stored
 * values would still move the draft's revision, and every other tab reading
 * that draft would go stale over nothing.
 */
export function patchOf(
  asset: DraftAsset,
  fields: SymbolFieldsState,
): AssetPatch | null {
  const patch: AssetPatch = {};
  const text = (value: string): string => value.trim();

  if (
    text(fields.sourceUrl).length > 0 &&
    text(fields.sourceUrl) !== asset.sourceUrl
  ) {
    patch.sourceUrl = text(fields.sourceUrl);
  }
  if (
    text(fields.licenseName).length > 0 &&
    text(fields.licenseName) !== asset.licenseName
  ) {
    patch.licenseName = text(fields.licenseName);
  }
  const licenseUrl = text(fields.licenseUrl);
  if ((licenseUrl.length === 0 ? null : licenseUrl) !== asset.licenseUrl) {
    patch.licenseUrl = licenseUrl.length === 0 ? null : licenseUrl;
  }
  const attribution = text(fields.attribution);
  if ((attribution.length === 0 ? null : attribution) !== asset.attribution) {
    patch.attribution = attribution.length === 0 ? null : attribution;
  }
  if (
    text(fields.replacementReason).length > 0 &&
    text(fields.replacementReason) !== asset.replacementReason
  ) {
    patch.replacementReason = text(fields.replacementReason);
  }
  const validFrom = text(fields.validFrom);
  if (
    (validFrom.length === 0 ? null : validFrom) !== (asset.validFrom ?? null)
  ) {
    patch.validFrom = validFrom.length === 0 ? null : validFrom;
  }
  const validTo = text(fields.validTo);
  if ((validTo.length === 0 ? null : validTo) !== (asset.validTo ?? null)) {
    patch.validTo = validTo.length === 0 ? null : validTo;
  }
  const localizations = localizationsOf(fields.localizations);
  if (!sameLocalizations(localizations, asset.localizations ?? {})) {
    patch.localizations = localizations;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

export function SymbolFieldsEditor({
  fields,
  onChange,
  disabled = false,
}: {
  fields: SymbolFieldsState;
  onChange: (fields: SymbolFieldsState) => void;
  disabled?: boolean;
}) {
  function set<Key extends keyof SymbolFieldsState>(
    key: Key,
    value: SymbolFieldsState[Key],
  ): void {
    onChange({ ...fields, [key]: value });
  }

  function setRow(index: number, row: LocalizationRow): void {
    set(
      "localizations",
      fields.localizations.map((current, at) => (at === index ? row : current)),
    );
  }

  return (
    <Stack spacing={2}>
      <TextField
        label="Source URL"
        size="small"
        disabled={disabled}
        value={fields.sourceUrl}
        onChange={(event) => set("sourceUrl", event.target.value)}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="License"
          size="small"
          disabled={disabled}
          value={fields.licenseName}
          onChange={(event) => set("licenseName", event.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          label="License URL"
          size="small"
          disabled={disabled}
          value={fields.licenseUrl}
          onChange={(event) => set("licenseUrl", event.target.value)}
          sx={{ flex: 1 }}
        />
        <TextField
          label="Attribution"
          size="small"
          disabled={disabled}
          value={fields.attribution}
          onChange={(event) => set("attribution", event.target.value)}
          sx={{ flex: 1 }}
        />
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Valid from"
          type="date"
          size="small"
          disabled={disabled}
          slotProps={{ inputLabel: { shrink: true } }}
          value={fields.validFrom}
          onChange={(event) => set("validFrom", event.target.value)}
          helperText="When this drawing became the symbol."
          sx={{ flex: 1 }}
        />
        <TextField
          label="Valid to"
          type="date"
          size="small"
          disabled={disabled}
          slotProps={{ inputLabel: { shrink: true } }}
          value={fields.validTo}
          onChange={(event) => set("validTo", event.target.value)}
          helperText="Setting this retires the symbol; the row stays."
          sx={{ flex: 1 }}
        />
      </Stack>
      <TextField
        label="Why replace the upstream drawing?"
        size="small"
        multiline
        minRows={2}
        disabled={disabled}
        value={fields.replacementReason}
        onChange={(event) => set("replacementReason", event.target.value)}
        helperText="Travels into the proposal and the audit trail."
      />

      <Box>
        <Typography variant="subtitle2">This symbol's own words</Typography>
        <Typography variant="body2" color="text.secondary">
          The name and story of the drawing, not of the country. A card shows
          them beside the answer.
        </Typography>
      </Box>
      {fields.localizations.map((row, index) => (
        <Stack
          key={index}
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: "flex-start" }}
        >
          <TextField
            label="Locale"
            size="small"
            disabled={disabled}
            value={row.locale}
            onChange={(event) =>
              setRow(index, { ...row, locale: event.target.value })
            }
            sx={{ width: 96 }}
          />
          <TextField
            label="Display name"
            size="small"
            disabled={disabled}
            value={row.displayName}
            onChange={(event) =>
              setRow(index, { ...row, displayName: event.target.value })
            }
            sx={{ flex: 1 }}
          />
          <TextField
            label="Description"
            size="small"
            multiline
            disabled={disabled}
            value={row.description}
            onChange={(event) =>
              setRow(index, { ...row, description: event.target.value })
            }
            sx={{ flex: 2 }}
          />
          <Button
            size="small"
            color="error"
            disabled={disabled}
            onClick={() =>
              set(
                "localizations",
                fields.localizations.filter((_, at) => at !== index),
              )
            }
          >
            Remove
          </Button>
        </Stack>
      ))}
      <Box>
        <Button
          size="small"
          disabled={disabled}
          onClick={() =>
            set("localizations", [
              ...fields.localizations,
              { locale: "", displayName: "", description: "" },
            ])
          }
        >
          Add a locale
        </Button>
      </Box>
    </Stack>
  );
}
