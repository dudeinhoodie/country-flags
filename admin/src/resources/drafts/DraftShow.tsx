import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { useDeckWriter, useDraftWithDecks } from "./useDraftDecks";

const MEMBERS_MODE_LABEL: Record<string, string> = {
  "all-current": "All current countries",
  explicit: "Chosen list",
  taxonomy: "Taxonomy node",
};

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

export function DraftShow() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { draft, decks, error, reload } = useDraftWithDecks(draftId ?? "");
  const { remove } = useDeckWriter(draftId ?? "");
  const [actionError, setActionError] = useState<string | null>(null);
  const editable = canEdit(permissions);

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (draft === null || decks === null) {
    return <Typography color="text.secondary">Loading the draft…</Typography>;
  }

  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Draft" />
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Chip label={draft.status} size="small" />
            <Chip
              label={`revision ${String(draft.revision)}`}
              size="small"
              variant="outlined"
            />
            <Box sx={{ flexGrow: 1 }} />
            <Button
              component="a"
              href={`/api/v1/admin/content/drafts/${draft.id}/export`}
              size="small"
              variant="outlined"
            >
              Download export
            </Button>
            {editable && (
              <Button
                component={Link}
                to={`/drafts/${draft.id}/decks/new`}
                size="small"
                variant="contained"
              >
                New deck
              </Button>
            )}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            Based on content version <b>{draft.baseContentVersion}</b>, catalog
            commit <b>{draft.baseCatalogCommit}</b>.
          </Typography>

          {actionError !== null && (
            <Alert severity="error" onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}

          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Name (ru)</TableCell>
                <TableCell>Membership</TableCell>
                <TableCell align="right">Countries</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {decks.map((deck) => (
                <TableRow key={deck.key} hover>
                  <TableCell>
                    <code>{deck.key}</code>
                  </TableCell>
                  <TableCell>{deck.names.ru?.name ?? "—"}</TableCell>
                  <TableCell>
                    {MEMBERS_MODE_LABEL[deck.membersMode] ?? deck.membersMode}
                  </TableCell>
                  <TableCell align="right">{deck.memberCount}</TableCell>
                  <TableCell align="right">
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{ justifyContent: "flex-end" }}
                    >
                      <Button
                        component={Link}
                        to={`/drafts/${draft.id}/decks/${deck.key}`}
                        size="small"
                      >
                        {editable ? "Edit" : "View"}
                      </Button>
                      {editable && (
                        <Button
                          size="small"
                          color="error"
                          onClick={() => {
                            void remove(draft.revision, deck.key).then(
                              () => {
                                setActionError(null);
                                reload();
                              },
                              (cause: unknown) => {
                                setActionError(
                                  cause instanceof Error
                                    ? cause.message
                                    : "The deck could not be removed",
                                );
                              },
                            );
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </Stack>
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
