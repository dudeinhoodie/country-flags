import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useCallback, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { conflictOf, messageOf } from "../../api/draft-conflict";
import type { DraftConflict } from "../../api/draft-conflict";
import { ConflictDialog } from "../../components/ConflictDialog";
import { FindingList } from "../../components/FindingList";
import type { components } from "../../api/generated/admin-api";

type Finding = components["schemas"]["AdminValidationFinding"];
type CarriedChange = components["schemas"]["AdminCarriedChange"];

const COLLISION = "CATALOG_CARRY_COLLISION";

const CHANGE_LABEL: Record<string, string> = {
  added: "added",
  changed: "changed",
  removed: "removed",
};

/** A commit is read to be recognised, not retyped. */
function shortCommit(commit: string): string {
  return commit.length > 12 ? commit.slice(0, 12) : commit;
}

function collisionsOf(payload: unknown): Finding[] | null {
  const envelope = payload as
    | { error?: { code?: unknown; details?: { collisions?: unknown } } }
    | undefined;
  if (envelope?.error?.code !== COLLISION) {
    return null;
  }
  const collisions = envelope.error.details?.collisions;
  return Array.isArray(collisions) ? (collisions as Finding[]) : [];
}

/**
 * The way out of a catalog that moved under an open draft (#395).
 *
 * Every merge to master redeploys with a new catalog, and a proposal built
 * on the old one would silently revert whatever landed meanwhile — so it is
 * refused, and used to be refused with nothing but "start a new draft".
 * Starting again means uploading the drawing again and retyping its
 * provenance, because assets belong to the draft they were uploaded into.
 *
 * So this panel appears exactly when the draft's base has fallen behind, and
 * offers to move it forward. A collision comes back as findings in the same
 * shape validation uses, which is why they are shown with the same list:
 * each row opens the object, the tab and the field that diverged (#356). A
 * stale revision comes back in the same shape every other draft write uses,
 * so it opens the same recovery dialog (#355).
 */
export function CarryDraftPanel({
  draftId,
  draftRevision,
  baseCatalogCommit,
  catalogCommit,
  editable,
  onCarried,
}: {
  draftId: string;
  draftRevision: number;
  baseCatalogCommit: string;
  /** The catalog this deployment carries now. */
  catalogCommit: string;
  editable: boolean;
  /** Re-reads the draft: the carry moved its revision and its document. */
  onCarried: () => void;
}) {
  const client = useAdminApiClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collisions, setCollisions] = useState<Finding[] | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [incoming, setIncoming] = useState<CarriedChange[] | null>(null);

  const carry = useCallback(() => {
    setBusy(true);
    setError(null);
    setCollisions(null);
    client
      .POST("/v1/admin/content/drafts/{draftId}/carry", {
        params: { path: { draftId } },
        body: { draftRevision, baseCatalogCommit },
      })
      .then(({ data, error: apiError }) => {
        setBusy(false);
        if (data === undefined) {
          const collided = collisionsOf(apiError);
          if (collided !== null) {
            setCollisions(collided);
            return;
          }
          const stale = conflictOf(apiError);
          if (stale !== null) {
            setConflict(stale);
            return;
          }
          setError(
            messageOf(apiError, "The draft could not be carried forward"),
          );
          return;
        }
        setIncoming(data.incoming);
        onCarried();
      })
      .catch(() => {
        setBusy(false);
        setError("The draft could not be carried forward");
      });
  }, [client, draftId, draftRevision, baseCatalogCommit, onCarried]);

  if (baseCatalogCommit === catalogCommit) {
    return incoming === null ? null : (
      <Alert
        severity="success"
        sx={{ mb: 2 }}
        onClose={() => setIncoming(null)}
      >
        <AlertTitle>This draft is now based on the current catalog</AlertTitle>
        {incoming.length === 0 ? (
          "Nothing in the catalog changed under it. Validate it again before proposing."
        ) : (
          <>
            <Typography variant="body2">
              {incoming.length === 1
                ? "One change came in from the catalog. Validate the draft again before proposing."
                : `${String(incoming.length)} changes came in from the catalog. Validate the draft again before proposing.`}
            </Typography>
            <List dense disablePadding>
              {incoming.slice(0, 20).map((change) => (
                <ListItem
                  key={`${change.objectType}-${change.objectKey}`}
                  disableGutters
                >
                  <ListItemText
                    primary={`${change.objectType} ${change.objectKey}`}
                    secondary={CHANGE_LABEL[change.change] ?? change.change}
                  />
                </ListItem>
              ))}
            </List>
          </>
        )}
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      {conflict !== null && (
        <ConflictDialog
          conflict={conflict}
          changes={[]}
          viewerId={null}
          onReload={() => {
            setConflict(null);
            onCarried();
          }}
          onClose={() => setConflict(null)}
        />
      )}
      <Alert severity="warning">
        <AlertTitle>The catalog moved since this draft was imported</AlertTitle>
        <Stack spacing={1.5}>
          <Typography variant="body2">
            This draft was imported from{" "}
            <code>{shortCommit(baseCatalogCommit)}</code> and the deployment now
            carries <code>{shortCommit(catalogCommit)}</code>. A proposal cannot
            be opened on the older one: it would quietly revert whatever landed
            in the meantime. Carrying the draft forward keeps every edit and
            every uploaded drawing and moves the base — unless the two changed
            the same field, which is refused and listed rather than merged.
          </Typography>
          {error !== null && <Alert severity="error">{error}</Alert>}
          {collisions !== null && (
            <Stack spacing={1}>
              <Typography variant="body2">
                {collisions.length === 1
                  ? "One field was changed both here and in the catalog. Nothing was carried and nothing was lost: open it, decide what it should say, and carry the draft again."
                  : `${String(collisions.length)} fields were changed both here and in the catalog. Nothing was carried and nothing was lost: open each one, decide what it should say, and carry the draft again.`}
              </Typography>
              <FindingList
                draftId={draftId}
                findings={collisions}
                emptyLabel="Nothing collided."
              />
            </Stack>
          )}
          {editable && (
            <Box>
              <Button variant="contained" disabled={busy} onClick={carry}>
                Carry onto the current catalog
              </Button>
            </Box>
          )}
        </Stack>
      </Alert>
    </Box>
  );
}
