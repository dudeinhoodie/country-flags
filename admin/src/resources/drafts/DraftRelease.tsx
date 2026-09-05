import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { usePermissions } from "react-admin";
import { useParams } from "react-router-dom";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { relativeTime } from "../../components/relative-time";
import { ErrorState } from "../../components/StateViews";
import { StatusChip } from "../../components/StatusChip";
import { ReleasePanel } from "./ReleasePanel";
import { useDraftWithDecks } from "./useDraftDecks";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * Validate, diff, propose, publish (§4.3, `/drafts/:draftId/release`).
 *
 * The role guards and the production confirmation live inside the panel and
 * are untouched by the redesign: this screen only gives them an address of
 * their own, so the workspace and a validation summary can link to them.
 */
export function DraftRelease() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const { draft, error, reload } = useDraftWithDecks(draftId ?? "");

  if (error !== null) {
    return <ErrorState message={error} />;
  }
  if (draft === null) {
    return <LoadingState label="Loading the draft…" />;
  }

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Validation & release"
        description="What this draft would change, whether anything blocks it, and the run that puts it live."
        surface="draft"
        surfaceNote={`revision ${String(draft.revision)}`}
        meta={
          <>
            <MetaItem label="Status">
              <StatusChip value={draft.status} />
            </MetaItem>
            <MetaItem label="Base version">{draft.baseContentVersion}</MetaItem>
            <MetaItem label="Updated">{relativeTime(draft.updatedAt)}</MetaItem>
          </>
        }
      />
      <Card>
        <CardContent>
          <ReleasePanel
            draftId={draft.id}
            draftRevision={draft.revision}
            baseContentVersion={draft.baseContentVersion}
            baseCatalogCommit={draft.baseCatalogCommit}
            proposalUrl={draft.proposalUrl}
            canPublish={permissions === "PUBLISHER" || permissions === "ADMIN"}
            storedReport={
              (draft.validationReport ?? null) as Parameters<
                typeof ReleasePanel
              >[0]["storedReport"]
            }
            editable={canEdit(permissions)}
            onValidated={reload}
          />
        </CardContent>
      </Card>
    </Box>
  );
}
