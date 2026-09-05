import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { PageHeader } from "../../components/PageHeader";
import { DraftAssets } from "./DraftAssets";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * The draft's media queue (§4.3, `/drafts/:draftId/media`).
 *
 * The contextual slots on an entity are where a flag is normally replaced
 * (#318); this is the global view of everything uploaded into the draft.
 */
export function DraftAssetsPage() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  const draft = draftId ?? "";
  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Media"
        description="Flags and coats of arms uploaded into this draft, with the provenance each one has to carry."
        surface="draft"
        actions={
          <Button
            component={Link}
            to={routes.draftOverview(draft)}
            size="small"
          >
            Draft overview
          </Button>
        }
      />
      <Card>
        <CardContent>
          <DraftAssets draftId={draft} editable={canEdit(permissions)} />
        </CardContent>
      </Card>
    </Box>
  );
}
