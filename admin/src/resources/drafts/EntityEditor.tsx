import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
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
import { useDraftWithDecks } from "./useDraftDecks";
import { useDraftEntity, useEntityWriter } from "./useDraftEntities";

const ENTITY_TYPES = [
  "country",
  "territory",
  "area",
  "region",
  "subregion",
] as const;
const ENTITY_STATUSES = ["active", "historical", "retired", "hidden"] as const;
const IDENTIFIER_KEYS = [
  "isoAlpha2",
  "isoAlpha3",
  "m49",
  "wikidataId",
  "editorialKey",
  "customCode",
] as const;
const NAME_FIELDS = ["short", "official"] as const;

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

interface RawOverrideRow {
  path: string;
  value: string;
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
  const { update } = useEntityWriter(draftId ?? "");

  const [type, setType] = useState<(typeof ENTITY_TYPES)[number]>("country");
  const [status, setStatus] =
    useState<(typeof ENTITY_STATUSES)[number]>("active");
  const [inCatalog, setInCatalog] = useState(true);
  const [recognitionStatus, setRecognitionStatus] = useState("");
  const [recognitionAsOf, setRecognitionAsOf] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [identifiers, setIdentifiers] = useState<Record<string, string>>({});
  const [nameOverrides, setNameOverrides] = useState<Record<string, string>>(
    {},
  );
  const [rawOverrides, setRawOverrides] = useState<RawOverrideRow[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The loaded entity seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (detail !== null && seededKey !== detail.entity.key) {
    const entity = detail.entity;
    setSeededKey(entity.key);
    setType(entity.type);
    setStatus(entity.status);
    setInCatalog(entity.includeInCountryCatalog);
    setRecognitionStatus(entity.recognitionStatus);
    setRecognitionAsOf(entity.recognitionAsOf ?? "");
    setValidFrom(entity.validFrom ?? "");
    setValidTo(entity.validTo ?? "");
    setIdentifiers({ ...(entity.identifiers ?? {}) });
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
    return <Typography color="text.secondary">Loading the entity…</Typography>;
  }

  const locales = [
    ...new Set([
      "en",
      "ru",
      ...Object.keys(detail.publishedNames),
      ...Object.keys(nameOverrides).map((path) => path.split(".")[1] ?? ""),
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

  function save(): void {
    if (draft === null || detail === null) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    const cleanIdentifiers: Record<string, string> = {};
    for (const [key, value] of Object.entries(identifiers)) {
      if (value.trim() !== "") {
        cleanIdentifiers[key] = value.trim();
      }
    }
    void update(draft.revision, detail.entity.key, {
      type,
      status,
      includeInCountryCatalog: inCatalog,
      recognitionStatus,
      recognitionAsOf: recognitionAsOf.trim() === "" ? null : recognitionAsOf,
      validFrom: validFrom.trim() === "" ? null : validFrom,
      validTo: validTo.trim() === "" ? null : validTo,
      identifiers: cleanIdentifiers,
      overrides: assembleOverrides(),
    }).then(
      () => {
        setSaving(false);
        void navigate(`/drafts/${draft.id}/entities`);
      },
      (cause: unknown) => {
        setSaving(false);
        setSaveError(
          cause instanceof Error
            ? cause.message
            : "The entity could not be saved",
        );
      },
    );
  }

  return (
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
              onChange={(event) =>
                setType(event.target.value as (typeof ENTITY_TYPES)[number])
              }
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
            <FormControlLabel
              control={
                <Switch
                  checked={inCatalog}
                  onChange={(event) => setInCatalog(event.target.checked)}
                  disabled={!editable}
                />
              }
              label="In country catalog"
            />
          </Stack>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Recognition status"
              value={recognitionStatus}
              onChange={(event) => setRecognitionStatus(event.target.value)}
              size="small"
              disabled={!editable}
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
            {IDENTIFIER_KEYS.map((key) => (
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
                sx={{ width: 170 }}
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
            Any merged field can be pinned by its dotted path. A quoted value is
            parsed as JSON; anything else is stored as text.
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

          <Divider />
          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              disabled={!editable || saving}
              onClick={save}
            >
              Save
            </Button>
            <Button
              variant="outlined"
              disabled={saving}
              onClick={() => void navigate(`/drafts/${draft.id}/entities`)}
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
