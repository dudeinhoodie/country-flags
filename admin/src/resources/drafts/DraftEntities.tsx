import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
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
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function DraftEntities() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { entities, error } = useDraftEntities(draftId ?? "");
  const [query, setQuery] = useState("");
  const editable = canEdit(permissions);

  const filtered = useMemo(() => {
    if (entities === null) {
      return null;
    }
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? entities
      : entities.filter((entity) => matches(entity, needle));
  }, [entities, query]);

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
                <TableCell>Status</TableCell>
                <TableCell align="center">In catalog</TableCell>
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
                    <StatusChip value={entity.status} />
                  </TableCell>
                  <TableCell align="center">
                    {entity.includeInCountryCatalog ? "yes" : "no"}
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
