import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { Title, usePermissions } from "react-admin";
import { useParams } from "react-router-dom";
import { DraftAssets } from "./DraftAssets";

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * Stands on its own for now; once the draft page exists the same panel is
 * embedded there, which is where an editor would look for it.
 */
export function DraftAssetsPage() {
  const { draftId } = useParams();
  const { permissions } = usePermissions<string>();
  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Draft symbols" />
      <CardContent>
        <DraftAssets draftId={draftId ?? ""} editable={canEdit(permissions)} />
      </CardContent>
    </Card>
  );
}
