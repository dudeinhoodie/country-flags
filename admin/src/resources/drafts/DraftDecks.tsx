import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import StyleOutlinedIcon from "@mui/icons-material/StyleOutlined";
import { useState } from "react";
import { usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { relativeTime } from "../../components/relative-time";
import { EmptyState, ErrorState } from "../../components/StateViews";
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

/**
 * The decks of one draft (§4.3, `/drafts/:draftId/decks`).
 *
 * It used to be a table inside the draft page next to the release panel;
 * building decks and publishing them are different jobs, and the navigation
 * now says so.
 */
export function DraftDecks() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { draft, decks, error, reload } = useDraftWithDecks(draftId ?? "");
  const { remove } = useDeckWriter(draftId ?? "");
  const [actionError, setActionError] = useState<string | null>(null);
  const editable = canEdit(permissions);

  if (error !== null) {
    return <ErrorState message={error} />;
  }
  if (draft === null || decks === null) {
    return <LoadingState label="Loading the decks…" />;
  }

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Deck builder"
        description="Every deck this draft would publish. A deck member is an entity taught through a card template, so one country can appear as more than one card."
        surface="draft"
        surfaceNote={`revision ${String(draft.revision)}`}
        meta={
          <>
            <MetaItem label="Decks">{String(decks.length)}</MetaItem>
            <MetaItem label="Updated">{relativeTime(draft.updatedAt)}</MetaItem>
          </>
        }
        actions={
          editable ? (
            <Button
              component={Link}
              to={routes.draftDeck(draft.id, "new")}
              size="small"
              variant="contained"
            >
              New deck
            </Button>
          ) : undefined
        }
      />

      {actionError !== null && (
        <Alert
          severity="error"
          onClose={() => setActionError(null)}
          sx={{ mb: 2 }}
        >
          {actionError}
        </Alert>
      )}

      <Card>
        {decks.length === 0 ? (
          <EmptyState
            title="No decks in this draft"
            description="A deck is what an app actually shows: a set of cards with a name, an order and an access model."
            icon={<StyleOutlinedIcon sx={{ fontSize: 40 }} />}
            action={
              editable ? (
                <Button
                  component={Link}
                  to={routes.draftDeck(draft.id, "new")}
                  variant="contained"
                >
                  New deck
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Key</TableCell>
                <TableCell>Name (ru)</TableCell>
                <TableCell>Membership</TableCell>
                <TableCell align="right">Cards</TableCell>
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
                        to={routes.draftDeck(draft.id, deck.key)}
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
        )}
      </Card>
    </Box>
  );
}
