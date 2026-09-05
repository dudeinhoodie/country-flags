import Button from "@mui/material/Button";
import { Link } from "react-router-dom";
import { routes } from "../app/routes";
import { useContentStatus } from "../app/useContentStatus";
import { useCurrentDraft } from "../app/CurrentDraftContext";
import { MetaItem, PageHeader } from "./PageHeader";

/**
 * The heading of a read-only screen.
 *
 * `Published content` is a projection of the active release and nothing on
 * it can be edited (§3.4, §4.1). Rather than leave that to be inferred from
 * the absence of buttons, the header states the surface, names the release
 * it is showing, and offers the one thing an editor who wanted to change
 * something actually needs: the same subject inside the current draft.
 */
export function PublishedPageHeader({
  title,
  description,
  draftHref,
  draftLabel = "Edit in the draft workspace",
}: {
  title: string;
  description: string;
  /** Where this subject is edited, given the selected draft. */
  draftHref?: ((draftId: string) => string) | undefined;
  draftLabel?: string | undefined;
}) {
  const status = useContentStatus();
  const { draft } = useCurrentDraft();
  return (
    <PageHeader
      title={title}
      description={description}
      surface="published"
      surfaceNote={status?.activeVersion ?? undefined}
      meta={
        <>
          <MetaItem label="Release">
            {status?.activeVersion ?? "none published yet"}
          </MetaItem>
          <MetaItem label="Changes">only inside a draft, never here</MetaItem>
        </>
      }
      actions={
        draft === null || draftHref === undefined ? (
          <Button component={Link} to={routes.workspace} size="small">
            Open the workspace
          </Button>
        ) : (
          <Button
            component={Link}
            to={draftHref(draft.id)}
            size="small"
            variant="outlined"
          >
            {draftLabel}
          </Button>
        )
      }
    />
  );
}
