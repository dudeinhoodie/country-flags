import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
import { Title, usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { useDraftEntities } from "./useDraftEntities";
import type { DraftEntityListItem } from "./useDraftEntities";

const ANY = "";
/** Sentinel for the "no parent at all" choice; never a real entity key. */
export const NO_PARENT = "@none";
const ENTITY_TYPES = [
  "country",
  "territory",
  "area",
  "subdivision",
  "region",
  "subregion",
];
const ENTITY_STATUSES = ["active", "historical", "retired", "hidden"];

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

function matches(entity: DraftEntityListItem, query: string): boolean {
  const haystack = [
    entity.key,
    entity.publishedName ?? "",
    entity.identifiers.isoAlpha2 ?? "",
    entity.identifiers.isoAlpha3 ?? "",
    entity.identifiers.isoSubdivision ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** The filters an editor sets, all of them narrowing the same list. */
interface Filters {
  query: string;
  type: string;
  parentKey: string;
  status: string;
  missingFlag: boolean;
  missingCoat: boolean;
}

export function keeps(entity: DraftEntityListItem, filters: Filters): boolean {
  if (filters.query !== "" && !matches(entity, filters.query)) {
    return false;
  }
  if (filters.type !== ANY && entity.type !== filters.type) {
    return false;
  }
  if (filters.status !== ANY && entity.status !== filters.status) {
    return false;
  }
  if (filters.parentKey === NO_PARENT) {
    if ((entity.parentKey ?? null) !== null) {
      return false;
    }
  } else if (
    filters.parentKey !== ANY &&
    entity.parentKey !== filters.parentKey
  ) {
    return false;
  }
  // The list carries what is already drawn, so "missing a coat" costs no
  // request of its own (PD-05).
  if (filters.missingFlag && entity.hasFlag !== false) {
    return false;
  }
  if (filters.missingCoat && entity.hasCoatOfArms !== false) {
    return false;
  }
  return true;
}

export function DraftEntities() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { entities, error } = useDraftEntities(draftId ?? "");
  const [query, setQuery] = useState("");
  const [type, setType] = useState(ANY);
  const [parentKey, setParentKey] = useState(ANY);
  const [status, setStatus] = useState(ANY);
  const [missingFlag, setMissingFlag] = useState(false);
  const [missingCoat, setMissingCoat] = useState(false);
  const editable = canEdit(permissions);

  const parents = useMemo(
    () =>
      [
        ...new Set(
          (entities ?? [])
            .map((entity) => entity.parentKey)
            .filter((key): key is string => typeof key === "string"),
        ),
      ].sort((left, right) => left.localeCompare(right)),
    [entities],
  );

  const filtered = useMemo(() => {
    if (entities === null) {
      return null;
    }
    const filters: Filters = {
      query: query.trim().toLowerCase(),
      type,
      parentKey,
      status,
      missingFlag,
      missingCoat,
    };
    return entities.filter((entity) => keeps(entity, filters));
  }, [entities, query, type, parentKey, status, missingFlag, missingCoat]);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (filtered === null) {
    return <LoadingState label="Loading the entities…" />;
  }

  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Draft countries" />
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              placeholder="Search by key, name or ISO code"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              sx={{ width: 320 }}
            />
            <Box sx={{ flexGrow: 1 }} />
            <Button
              component={Link}
              to={`/drafts/${draftId ?? ""}`}
              size="small"
            >
              Back to the draft
            </Button>
          </Stack>

          <Stack
            direction="row"
            spacing={2}
            useFlexGap
            sx={{ flexWrap: "wrap", alignItems: "center" }}
          >
            <TextField
              select
              size="small"
              label="Kind"
              value={type}
              onChange={(event) => setType(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value={ANY}>Any kind</MenuItem>
              {ENTITY_TYPES.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Parent"
              value={parentKey}
              onChange={(event) => setParentKey(event.target.value)}
              sx={{ minWidth: 240 }}
            >
              <MenuItem value={ANY}>Any parent</MenuItem>
              <MenuItem value={NO_PARENT}>No parent</MenuItem>
              {parents.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value={ANY}>Any status</MenuItem>
              {ENTITY_STATUSES.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={missingFlag}
                  onChange={(event) => setMissingFlag(event.target.checked)}
                />
              }
              label="Missing flag"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={missingCoat}
                  onChange={(event) => setMissingCoat(event.target.checked)}
                />
              }
              label="Missing coat"
            />
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {String(filtered.length)} of {String(entities?.length ?? 0)}{" "}
            entities. Names and facts come from upstream sources at build time;
            what an editor owns is the selection, the codes, and the overrides.
          </Typography>

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Published name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Parent</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="center">In catalog</TableCell>
                <TableCell align="center">Flag</TableCell>
                <TableCell align="center">Coat</TableCell>
                <TableCell align="right">Overrides</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((entity) => (
                <TableRow key={entity.key} hover>
                  <TableCell>
                    <code>{entity.key}</code>
                  </TableCell>
                  <TableCell>{entity.publishedName ?? "—"}</TableCell>
                  <TableCell>{entity.type}</TableCell>
                  <TableCell>
                    {entity.parentKey === null ||
                    entity.parentKey === undefined ? (
                      "—"
                    ) : (
                      <code>{entity.parentKey}</code>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusChip value={entity.status} />
                  </TableCell>
                  <TableCell align="center">
                    {entity.includeInCountryCatalog ? "yes" : "no"}
                  </TableCell>
                  <TableCell align="center">
                    {entity.hasFlag === true ? "yes" : "—"}
                  </TableCell>
                  <TableCell align="center">
                    {entity.hasCoatOfArms === true ? "yes" : "—"}
                  </TableCell>
                  <TableCell align="right">
                    {entity.overrideCount > 0
                      ? String(entity.overrideCount)
                      : "—"}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      component={Link}
                      to={`/drafts/${draftId ?? ""}/entities/${entity.key}`}
                      size="small"
                    >
                      {editable ? "Edit" : "View"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Stack>
      </CardContent>
    </Card>
  );
}
