import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useRefreshDrafts } from "../../app/CurrentDraftContext";
import { useReportSaveStatus } from "../../app/SaveStatusContext";
import { LoadingState } from "../../components/LoadingState";
import { StickyActionBar } from "../../components/StickyActionBar";
import { useDraftWithDecks } from "./useDraftDecks";
import {
  useDraftEntities,
  useDraftEntity,
  useEntityWriter,
} from "./useDraftEntities";
import type {
  DraftEntityDetail,
  DraftEntityListItem,
  EntityFacts,
} from "./useDraftEntities";

const ENTITY_TYPES = [
  "country",
  "territory",
  "area",
  "subdivision",
  "region",
  "subregion",
] as const;

type EntityType = NonNullable<DraftEntityDetail["entity"]["type"]>;

/** What a subdivision may hang from: a state's part belongs to the state. */
const PARENT_TYPES: readonly string[] = ["country", "territory"];

/**
 * A subdivision is not recognized or unrecognized — the question does not
 * apply — and the publisher pins the answer, so the field shows it rather
 * than inviting an edit the backend would overwrite (ADR-020).
 */
const SUBDIVISION_RECOGNITION_STATUS = "not_applicable";

const ENTITY_STATUSES = ["active", "historical", "retired", "hidden"] as const;

/**
 * Every identifier and what it is allowed to look like, mirroring the
 * editorial schema. The patterns are the point of having separate fields at
 * all: `US-CA` typed into an ISO country code would put a state everywhere
 * a reader expects a country.
 */
const IDENTIFIERS: {
  key: string;
  pattern?: RegExp;
  maxLength?: number;
  expected: string;
}[] = [
  {
    key: "isoAlpha2",
    pattern: /^[A-Za-z]{2}$/,
    expected: "two letters, as in FR",
  },
  {
    key: "isoAlpha3",
    pattern: /^[A-Za-z]{3}$/,
    expected: "three letters, as in FRA",
  },
  { key: "m49", pattern: /^[0-9]{3}$/, expected: "three digits, as in 250" },
  {
    key: "isoSubdivision",
    pattern: /^[A-Za-z]{2}-[A-Za-z0-9]{1,3}$/,
    expected: "ISO 3166-2, as in US-CA",
  },
  { key: "localCode", maxLength: 40, expected: "at most 40 characters" },
  { key: "fipsCode", maxLength: 10, expected: "at most 10 characters" },
  { key: "wikidataId", expected: "a Wikidata id" },
  { key: "editorialKey", expected: "an editorial key" },
  { key: "customCode", expected: "a custom code" },
];

const NAME_FIELDS = ["short", "official"] as const;
const LOCALIZED_FACTS = [
  { key: "capital", label: "Capital" },
  { key: "largestCity", label: "Largest city" },
  { key: "motto", label: "Motto" },
] as const;
const MEASURED_FACTS = [
  { key: "population", label: "Population", unit: "people" },
  { key: "area", label: "Area", unit: "km2" },
] as const;

/** A measured value while it is being typed: every field is still text. */
interface MeasuredDraft {
  value: string;
  unit: string;
  observedAt: string;
}

const EMPTY_MEASURED: MeasuredDraft = { value: "", unit: "", observedAt: "" };

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

function namePath(locale: string, field: string): string {
  return `names.${locale}.${field}`;
}

/** A JSON scalar typed into a text field: quoted → parsed, bare → string. */
function parseOverrideValue(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function overrideText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function identifierError(key: string, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }
  const rule = IDENTIFIERS.find((entry) => entry.key === key);
  if (rule === undefined) {
    return null;
  }
  if (rule.pattern !== undefined && !rule.pattern.test(trimmed)) {
    return `Expected ${rule.expected}`;
  }
  if (rule.maxLength !== undefined && trimmed.length > rule.maxLength) {
    return `Expected ${rule.expected}`;
  }
  return null;
}

interface RawOverrideRow {
  path: string;
  value: string;
}

/** Locale → the languages listed for it, as the form holds them. */
type LanguageRows = Record<string, string>;

function languagesToRows(
  languages: Record<string, string>[] | undefined,
): LanguageRows {
  const rows: LanguageRows = {};
  for (const entry of languages ?? []) {
    for (const [locale, value] of Object.entries(entry)) {
      rows[locale] =
        rows[locale] === undefined ? value : `${rows[locale]}, ${value}`;
    }
  }
  return rows;
}

/**
 * The inverse: one comma-separated list per locale becomes an ordered list
 * of languages, each carrying the locales that named it in that position.
 */
function rowsToLanguages(rows: LanguageRows): Record<string, string>[] {
  const split: Record<string, string[]> = {};
  let longest = 0;
  for (const [locale, raw] of Object.entries(rows)) {
    const values = raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value !== "");
    if (values.length > 0) {
      split[locale] = values;
      longest = Math.max(longest, values.length);
    }
  }
  const languages: Record<string, string>[] = [];
  for (let index = 0; index < longest; index += 1) {
    const entry: Record<string, string> = {};
    for (const [locale, values] of Object.entries(split)) {
      const value = values[index];
      if (value !== undefined) {
        entry[locale] = value;
      }
    }
    if (Object.keys(entry).length > 0) {
      languages.push(entry);
    }
  }
  return languages;
}

function measuredToDraft(
  measured: { value: number; unit?: string; observedAt?: string } | undefined,
): MeasuredDraft {
  if (measured === undefined) {
    return EMPTY_MEASURED;
  }
  return {
    value: String(measured.value),
    unit: measured.unit ?? "",
    observedAt: measured.observedAt ?? "",
  };
}

export function EntityEditor() {
  const { draftId, entityKey } = useParams();
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const editable = canEdit(permissions);

  const { draft, error: draftError } = useDraftWithDecks(draftId ?? "");
  const { detail, error: entityError } = useDraftEntity(
    draftId ?? "",
    entityKey,
  );
  const { entities } = useDraftEntities(draftId ?? "");
  const { update } = useEntityWriter(draftId ?? "");

  const [type, setType] = useState<EntityType>("country");
  const [status, setStatus] =
    useState<(typeof ENTITY_STATUSES)[number]>("active");
  const [inCatalog, setInCatalog] = useState(true);
  const [parentKey, setParentKey] = useState("");
  const [recognitionStatus, setRecognitionStatus] = useState("");
  const [recognitionAsOf, setRecognitionAsOf] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [identifiers, setIdentifiers] = useState<Record<string, string>>({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    {},
  );
  const [rawOverrides, setRawOverrides] = useState<RawOverrideRow[]>([]);
  const [localizedFacts, setLocalizedFacts] = useState<
    Record<string, Record<string, string>>
  >({});
  const [measuredFacts, setMeasuredFacts] = useState<
    Record<string, MeasuredDraft>
  >({});
  const [statehoodDate, setStatehoodDate] = useState("");
  const [languageRows, setLanguageRows] = useState<LanguageRows>({});
  const reportSave = useReportSaveStatus();
  const refreshDrafts = useRefreshDrafts();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [parentWarning, setParentWarning] = useState(false);

  // The loaded entity seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (detail !== null && seededKey !== detail.entity.key) {
    const entity = detail.entity;
    setSeededKey(entity.key);
    setType(entity.type);
    setStatus(entity.status);
    setInCatalog(entity.includeInCountryCatalog);
    setParentKey(entity.parentKey ?? "");
    setRecognitionStatus(entity.recognitionStatus);
    setRecognitionAsOf(entity.recognitionAsOf ?? "");
    setValidFrom(entity.validFrom ?? "");
    setValidTo(entity.validTo ?? "");
    setIdentifiers({ ...(entity.identifiers ?? {}) });
    const facts = entity.facts ?? {};
    setLocalizedFacts({
      capital: { ...(facts.capital ?? {}) },
      largestCity: { ...(facts.largestCity ?? {}) },
      motto: { ...(facts.motto ?? {}) },
    });
    setMeasuredFacts({
      population: measuredToDraft(facts.population),
      area: measuredToDraft(facts.area),
    });
    setStatehoodDate(facts.statehoodDate ?? "");
    setLanguageRows(languagesToRows(facts.languages));
    const names: Record<string, string> = {};
    const raw: RawOverrideRow[] = [];
    for (const [path, value] of Object.entries(entity.overrides ?? {})) {
      const match = /^names\.([a-z-]+)\.(short|official)$/i.exec(path);
      if (match !== null && typeof value === "string") {
        names[path] = value;
      } else {
        raw.push({ path, value: overrideText(value) });
      }
    }
    setNameOverrides(names);
    setRawOverrides(raw);
  }

  if (draftError !== null || entityError !== null) {
    return <Alert severity="error">{draftError ?? entityError}</Alert>;
  }
  if (draft === null || detail === null) {
    return <LoadingState label="Loading the entity…" />;
  }

  const isSubdivision = type === "subdivision";
  // What the active release serves for this entity. An entity the release
  // already carries is one whose parent other things are built on.
  const published = Object.keys(detail.publishedNames).length > 0;
  const parentChanged = parentKey !== (detail.entity.parentKey ?? "");
  const needsParentWarning =
    published && detail.entity.type === "subdivision" && parentChanged;

  const parentOptions: DraftEntityListItem[] = (entities ?? []).filter(
    (candidate) =>
      PARENT_TYPES.includes(candidate.type) &&
      candidate.key !== detail.entity.key,
  );
  const selectedParent =
    parentOptions.find((candidate) => candidate.key === parentKey) ?? null;

  const identifierErrors = Object.entries(identifiers)
    .map(([key, value]) => identifierError(key, value))
    .filter((message): message is string => message !== null);
  const parentMissing = isSubdivision && parentKey.trim() === "";
  const blocked = identifierErrors.length > 0 || parentMissing;

  const locales = [
    ...new Set([
      "en",
      "ru",
      ...Object.keys(detail.publishedNames),
      ...Object.keys(nameOverrides).map((path) => path.split(".")[1] ?? ""),
      ...LOCALIZED_FACTS.flatMap(({ key }) =>
        Object.keys(localizedFacts[key] ?? {}),
      ),
      ...Object.keys(languageRows),
    ]),
  ].filter((locale) => locale !== "");

  function assembleOverrides(): Record<string, unknown> {
    const overrides: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(nameOverrides)) {
      if (value.trim() !== "") {
        overrides[path] = value;
      }
    }
    for (const row of rawOverrides) {
      if (row.path.trim() !== "" && row.value.trim() !== "") {
        overrides[row.path.trim()] = parseOverrideValue(row.value);
      }
    }
    return overrides;
  }

  function assembleFacts(): EntityFacts {
    const facts: EntityFacts = {};
    for (const { key } of LOCALIZED_FACTS) {
      const values: Record<string, string> = {};
      for (const [locale, value] of Object.entries(localizedFacts[key] ?? {})) {
        if (value.trim() !== "") {
          values[locale] = value.trim();
        }
      }
      if (Object.keys(values).length > 0) {
        facts[key] = values;
      }
    }
    for (const { key } of MEASURED_FACTS) {
      const measured = measuredFacts[key] ?? EMPTY_MEASURED;
      if (measured.value.trim() === "") {
        continue;
      }
      const value = Number(measured.value);
      if (!Number.isFinite(value)) {
        continue;
      }
      facts[key] = {
        value,
        ...(measured.unit.trim() === "" ? {} : { unit: measured.unit.trim() }),
        ...(measured.observedAt.trim() === ""
          ? {}
          : { observedAt: measured.observedAt.trim() }),
      };
    }
    if (statehoodDate.trim() !== "") {
      facts.statehoodDate = statehoodDate.trim();
    }
    const languages = rowsToLanguages(languageRows);
    if (languages.length > 0) {
      facts.languages = languages;
    }
    return facts;
  }

  function save(): void {
    if (draft === null || detail === null || blocked) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    reportSave("saving");
    const cleanIdentifiers: Record<string, string> = {};
    for (const [key, value] of Object.entries(identifiers)) {
      if (value.trim() !== "") {
        cleanIdentifiers[key] = value.trim();
      }
    }
    const subdivision = type === "subdivision";
    void update(draft.revision, detail.entity.key, {
      type,
      status,
      includeInCountryCatalog: subdivision ? false : inCatalog,
      parentKey: subdivision ? parentKey.trim() : null,
      recognitionStatus: subdivision
        ? SUBDIVISION_RECOGNITION_STATUS
        : recognitionStatus,
      recognitionAsOf: recognitionAsOf.trim() === "" ? null : recognitionAsOf,
      validFrom: validFrom.trim() === "" ? null : validFrom,
      validTo: validTo.trim() === "" ? null : validTo,
      identifiers: cleanIdentifiers,
      facts: assembleFacts(),
      overrides: assembleOverrides(),
    }).then(
      () => {
        setSaving(false);
        reportSave("saved");
        // The shell shows when the draft was last written; a save it did
        // not hear about would leave that reading stale.
        refreshDrafts();
        void navigate(routes.draftEntities(draft.id));
      },
      (cause: unknown) => {
        setSaving(false);
        const message =
          cause instanceof Error
            ? cause.message
            : "The entity could not be saved";
        setSaveError(message);
        reportSave("error", message);
      },
    );
  }

  function requestSave(): void {
    if (needsParentWarning) {
      setParentWarning(true);
      return;
    }
    save();
  }

  return (
    <>
      <Card sx={{ mt: 2 }}>
        <Title title={`Entity ${detail.entity.key}`} />
        <CardContent>
          <Stack spacing={3}>
            {!editable && (
              <Alert severity="info">
                You are viewing this entity. Editing needs the EDITOR role.
              </Alert>
            )}
            {saveError !== null && <Alert severity="error">{saveError}</Alert>}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Key"
                value={detail.entity.key}
                size="small"
                disabled
                helperText="Bound to upstream sources — it cannot change."
                sx={{ minWidth: 280 }}
              />
              <TextField
                select
                label="Type"
                value={type}
                onChange={(event) => setType(event.target.value as EntityType)}
                size="small"
                disabled={!editable}
                sx={{ minWidth: 160 }}
              >
                {ENTITY_TYPES.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Status"
                value={status}
                onChange={(event) =>
                  setStatus(
                    event.target.value as (typeof ENTITY_STATUSES)[number],
                  )
                }
                size="small"
                disabled={!editable}
                sx={{ minWidth: 160 }}
              >
                {ENTITY_STATUSES.map((option) => (
                  <MenuItem key={option} value={option}>
                    {option}
                  </MenuItem>
                ))}
              </TextField>
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={isSubdivision ? false : inCatalog}
                      onChange={(event) => setInCatalog(event.target.checked)}
                      disabled={!editable || isSubdivision}
                    />
                  }
                  label="In country catalog"
                />
                {isSubdivision && (
                  <FormHelperText>
                    A subdivision is taught only through a deck that names it,
                    so it never joins the country catalog.
                  </FormHelperText>
                )}
              </Box>
            </Stack>

            {isSubdivision && (
              <Stack spacing={1}>
                <Autocomplete
                  options={parentOptions}
                  value={selectedParent}
                  onChange={(_event, option) =>
                    setParentKey(option === null ? "" : option.key)
                  }
                  getOptionLabel={(option) =>
                    option.publishedName === null
                      ? option.key
                      : `${option.publishedName} — ${option.key}`
                  }
                  isOptionEqualToValue={(option, value) =>
                    option.key === value.key
                  }
                  disabled={!editable}
                  size="small"
                  sx={{ maxWidth: 520 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Parent"
                      required
                      error={parentMissing}
                      helperText={
                        parentMissing
                          ? "A subdivision needs the country or territory it belongs to."
                          : "The country or territory this unit belongs to; the publisher turns it into the administrative relation."
                      }
                    />
                  )}
                />
              </Stack>
            )}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Recognition status"
                value={
                  isSubdivision
                    ? SUBDIVISION_RECOGNITION_STATUS
                    : recognitionStatus
                }
                onChange={(event) => setRecognitionStatus(event.target.value)}
                size="small"
                disabled={!editable || isSubdivision}
                helperText={
                  isSubdivision
                    ? "Recognition is a question about states, not about their parts."
                    : " "
                }
                sx={{ minWidth: 220 }}
              />
              <TextField
                label="Recognition as of"
                value={recognitionAsOf}
                onChange={(event) => setRecognitionAsOf(event.target.value)}
                size="small"
                disabled={!editable}
                placeholder="YYYY-MM-DD"
              />
              <TextField
                label="Valid from"
                value={validFrom}
                onChange={(event) => setValidFrom(event.target.value)}
                size="small"
                disabled={!editable}
                placeholder="YYYY-MM-DD"
              />
              <TextField
                label="Valid to"
                value={validTo}
                onChange={(event) => setValidTo(event.target.value)}
                size="small"
                disabled={!editable}
                placeholder="YYYY-MM-DD"
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Identifiers</Typography>
            <Stack
              direction="row"
              spacing={2}
              useFlexGap
              sx={{ flexWrap: "wrap" }}
            >
              {IDENTIFIERS.map(({ key, expected }) => {
                const message = identifierError(key, identifiers[key] ?? "");
                return (
                  <TextField
                    key={key}
                    label={key}
                    value={identifiers[key] ?? ""}
                    onChange={(event) =>
                      setIdentifiers((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                    size="small"
                    disabled={!editable}
                    error={message !== null}
                    helperText={message ?? expected}
                    sx={{ width: 190 }}
                  />
                );
              })}
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Facts</Typography>
            <Typography variant="body2" color="text.secondary">
              What a curator answers by hand. A field left empty is not
              published; clearing one removes the answer.
            </Typography>
            {LOCALIZED_FACTS.map(({ key, label }) => (
              <Stack
                key={key}
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
              >
                {locales.map((locale) => (
                  <TextField
                    key={`${key}.${locale}`}
                    label={`${label} (${locale})`}
                    value={localizedFacts[key]?.[locale] ?? ""}
                    onChange={(event) =>
                      setLocalizedFacts((current) => ({
                        ...current,
                        [key]: {
                          ...(current[key] ?? {}),
                          [locale]: event.target.value,
                        },
                      }))
                    }
                    size="small"
                    disabled={!editable}
                    sx={{ minWidth: 240 }}
                  />
                ))}
              </Stack>
            ))}
            {MEASURED_FACTS.map(({ key, label, unit }) => {
              const measured = measuredFacts[key] ?? EMPTY_MEASURED;
              return (
                <Stack
                  key={key}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                >
                  <TextField
                    label={label}
                    value={measured.value}
                    onChange={(event) =>
                      setMeasuredFacts((current) => ({
                        ...current,
                        [key]: { ...measured, value: event.target.value },
                      }))
                    }
                    size="small"
                    disabled={!editable}
                    inputMode="numeric"
                    sx={{ minWidth: 200 }}
                  />
                  <TextField
                    label={`${label} unit`}
                    value={measured.unit}
                    onChange={(event) =>
                      setMeasuredFacts((current) => ({
                        ...current,
                        [key]: { ...measured, unit: event.target.value },
                      }))
                    }
                    size="small"
                    disabled={!editable}
                    placeholder={unit}
                  />
                  <TextField
                    label={`${label} observed at`}
                    value={measured.observedAt}
                    onChange={(event) =>
                      setMeasuredFacts((current) => ({
                        ...current,
                        [key]: { ...measured, observedAt: event.target.value },
                      }))
                    }
                    size="small"
                    disabled={!editable}
                    placeholder="YYYY-MM-DD"
                  />
                </Stack>
              );
            })}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Statehood date"
                value={statehoodDate}
                onChange={(event) => setStatehoodDate(event.target.value)}
                size="small"
                disabled={!editable}
                placeholder="YYYY-MM-DD"
                helperText="When the unit joined the entity above it."
                sx={{ minWidth: 240 }}
              />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              {locales.map((locale) => (
                <TextField
                  key={`languages.${locale}`}
                  label={`Languages (${locale})`}
                  value={languageRows[locale] ?? ""}
                  onChange={(event) =>
                    setLanguageRows((current) => ({
                      ...current,
                      [locale]: event.target.value,
                    }))
                  }
                  size="small"
                  disabled={!editable}
                  helperText="Comma-separated, in the same order in every locale."
                  sx={{ minWidth: 280 }}
                />
              ))}
            </Stack>

            <Divider />
            <Typography variant="subtitle2">Names</Typography>
            <Typography variant="body2" color="text.secondary">
              Names come from upstream sources; a value typed here becomes an
              editorial override that outranks them. Clear a field to give the
              name back to the sources.
            </Typography>
            {locales.map((locale) => (
              <Stack
                key={locale}
                direction={{ xs: "column", sm: "row" }}
                spacing={2}
              >
                {NAME_FIELDS.map((field) => {
                  const path = namePath(locale, field);
                  return (
                    <TextField
                      key={path}
                      label={`${field} (${locale})`}
                      value={nameOverrides[path] ?? ""}
                      onChange={(event) =>
                        setNameOverrides((current) => ({
                          ...current,
                          [path]: event.target.value,
                        }))
                      }
                      size="small"
                      disabled={!editable}
                      placeholder={
                        field === "short"
                          ? (detail.publishedNames[locale] ?? "")
                          : ""
                      }
                      helperText={
                        field === "short" &&
                        detail.publishedNames[locale] !== undefined
                          ? `Published: ${detail.publishedNames[locale]}`
                          : " "
                      }
                      sx={{ minWidth: 260 }}
                    />
                  );
                })}
              </Stack>
            ))}

            <Divider />
            <Typography variant="subtitle2">Other overrides</Typography>
            <Typography variant="body2" color="text.secondary">
              Any merged field can be pinned by its dotted path. A quoted value
              is parsed as JSON; anything else is stored as text. The facts
              above own their own paths and are not repeated here.
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Path</TableCell>
                  <TableCell>Value</TableCell>
                  <TableCell width={56} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rawOverrides.map((row, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <TextField
                        value={row.path}
                        onChange={(event) =>
                          setRawOverrides((current) =>
                            current.map((entry, at) =>
                              at === index
                                ? { ...entry, path: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        size="small"
                        fullWidth
                        disabled={!editable}
                        placeholder="recognition.note.en"
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        value={row.value}
                        onChange={(event) =>
                          setRawOverrides((current) =>
                            current.map((entry, at) =>
                              at === index
                                ? { ...entry, value: event.target.value }
                                : entry,
                            ),
                          )
                        }
                        size="small"
                        fullWidth
                        disabled={!editable}
                      />
                    </TableCell>
                    <TableCell>
                      {editable && (
                        <IconButton
                          size="small"
                          onClick={() =>
                            setRawOverrides((current) =>
                              current.filter((_, at) => at !== index),
                            )
                          }
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {editable && (
              <Box>
                <Button
                  size="small"
                  onClick={() =>
                    setRawOverrides((current) => [
                      ...current,
                      { path: "", value: "" },
                    ])
                  }
                >
                  Add override
                </Button>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      <StickyActionBar
        status={
          blocked
            ? "Fix the highlighted fields before saving."
            : editable
              ? undefined
              : "You are viewing this entity; editing needs the EDITOR role."
        }
        secondary={
          <Button
            variant="outlined"
            disabled={saving}
            onClick={() => void navigate(routes.draftEntities(draft.id))}
          >
            Cancel
          </Button>
        }
        primary={
          <Button
            variant="contained"
            disabled={!editable || saving || blocked}
            onClick={requestSave}
          >
            {saving ? "Saving\u2026" : "Save entity"}
          </Button>
        }
      />

      <Dialog open={parentWarning} onClose={() => setParentWarning(false)}>
        <DialogTitle>Move a published subdivision?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {detail.entity.key} is already published under{" "}
            {detail.entity.parentKey ?? "no parent"}. Changing its parent
            rewrites the administrative relation the release carries, so decks,
            filters and progress that read it will follow the new country at the
            next publish.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setParentWarning(false)}>
            Keep the parent
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setParentWarning(false);
              save();
            }}
          >
            Move it to {parentKey}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
