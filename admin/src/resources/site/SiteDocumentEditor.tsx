import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useEffect, useMemo, useState } from "react";
import { Title, usePermissions } from "react-admin";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { routes } from "../../app/routes";
import { useReportSaveStatus } from "../../app/SaveStatusContext";
import { useUnsavedChanges } from "../../app/UnsavedChanges";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { absoluteTime, relativeTime } from "../../components/relative-time";
import { ErrorState } from "../../components/StateViews";
import { StickyActionBar } from "../../components/StickyActionBar";
import {
  canDraft,
  DocumentStateChips,
  SnapshotNotice,
} from "./SiteDocumentsPage";
import {
  SiteApiError,
  sitePageUrl,
  useSiteDocument,
  useSiteDocumentVersions,
  useSiteDocumentWriter,
  useSiteStatus,
} from "./useSiteDocuments";
import type { SiteDocumentDetail } from "./useSiteDocuments";

function canPublish(permissions: unknown): boolean {
  return permissions === "PUBLISHER" || permissions === "ADMIN";
}

/** What the operator is about to be asked to confirm, or nothing. */
type PendingAction =
  | { kind: "publish" }
  | { kind: "unpublish" }
  | { kind: "delete" }
  | { kind: "restore"; version: number }
  | null;

/**
 * The preview is what the site will show, because it is the site's own
 * renderer answering: the console never carries a Markdown implementation
 * of its own. Rendered HTML from that renderer has no raw markup in it —
 * `html: false` is set server-side — so it can be placed as it is.
 */
function RenderedPreview({ html }: { html: string }) {
  return (
    <Box
      aria-label="Preview"
      role="region"
      sx={{
        "& h1": { fontSize: "1.6rem", mt: 0 },
        "& h2": { fontSize: "1.2rem", mt: 3 },
        "& h3": { fontSize: "1.05rem", mt: 2 },
        "& p, & li": { lineHeight: 1.6 },
        "& a": { color: "primary.main" },
        "& blockquote": {
          borderLeft: 3,
          borderColor: "divider",
          ml: 0,
          pl: 2,
          color: "text.secondary",
        },
        "& code": { fontFamily: "ui-monospace, monospace", fontSize: "0.9em" },
        minHeight: 200,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * One document in one language: the Markdown on the left, what the site
 * will show on the right, and the versions the site has served below.
 *
 * Saving and publishing are two acts on purpose (ADR-023). A save changes
 * the draft and nothing a reader can see; a publish is a PUBLISHER's
 * decision and writes the snapshot the site reads. Rolling back is two
 * acts as well: restore a version into the draft, read it, publish.
 */
export function SiteDocumentEditor() {
  const { slug = "", locale = "" } = useParams();
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const { status } = useSiteStatus();
  const { document, error, reload } = useSiteDocument(slug, locale);
  const { versions, reload: reloadVersions } = useSiteDocumentVersions(
    slug,
    locale,
  );
  const writer = useSiteDocumentWriter();
  const reportSave = useReportSaveStatus();

  // The loaded document is the base; the fields are what the editor typed
  // over it. `loaded` is replaced by every successful write, so "dirty" is
  // always relative to what the server has.
  const [loaded, setLoaded] = useState<SiteDocumentDetail | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  // The last preview the server rendered, and for which text: shown while
  // the text differs from what is saved, replaced by the saved rendering
  // the moment they agree again.
  const [preview, setPreview] = useState<{ body: string; html: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [note, setNote] = useState("");

  const loadedKey =
    document === null
      ? null
      : `${document.slug}.${document.locale}.${String(document.revision)}`;
  const [adoptedKey, setAdoptedKey] = useState<string | null>(null);
  if (document !== null && loadedKey !== adoptedKey && loaded === null) {
    // First arrival of the document: adopt it as the base. Later reloads
    // are adopted explicitly (after a conflict) so typing is never lost.
    setAdoptedKey(loadedKey);
    setLoaded(document);
    setTitle(document.title);
    setBody(document.body);
  }

  const dirty =
    loaded !== null && (title !== loaded.title || body !== loaded.body);
  const { allowLeaving } = useUnsavedChanges(
    dirty,
    routes.siteDocument(slug, locale),
  );

  useEffect(() => {
    reportSave(dirty ? "unsaved" : loaded === null ? "idle" : "saved");
  }, [dirty, loaded, reportSave]);

  // The preview follows the text with a short delay: every keystroke is
  // not a request, and the last one always is.
  useEffect(() => {
    if (loaded === null || body === loaded.body) {
      return;
    }
    const handle = window.setTimeout(() => {
      writer.preview(body).then(
        (html) => {
          setPreview({ body, html });
        },
        () => {
          // A failed preview is not a failed edit; the last good one stays.
        },
      );
    }, 400);
    return () => {
      window.clearTimeout(handle);
    };
  }, [body, loaded, writer]);
  const previewHtml =
    loaded === null || body === loaded.body
      ? loaded?.html
      : (preview?.html ?? loaded.html);

  const editable = canDraft(permissions);
  const publisher = canPublish(permissions);
  const pageUrl = useMemo(
    () => sitePageUrl(status, slug, locale),
    [status, slug, locale],
  );

  function adopt(next: SiteDocumentDetail): void {
    setLoaded(next);
    setTitle(next.title);
    setBody(next.body);
    setConflict(null);
    reloadVersions();
  }

  function failed(cause: unknown, fallback: string): void {
    if (
      cause instanceof SiteApiError &&
      cause.code === "SITE_DOCUMENT_REVISION_CONFLICT"
    ) {
      const current = cause.details.currentRevision;
      setConflict(typeof current === "number" ? current : -1);
      reportSave("error", cause.message);
      return;
    }
    setActionError(cause instanceof Error ? cause.message : fallback);
    reportSave("error", cause instanceof Error ? cause.message : fallback);
  }

  function save(): void {
    if (loaded === null) {
      return;
    }
    setSaving(true);
    setActionError(null);
    reportSave("saving");
    writer
      .save(slug, locale, loaded.revision, {
        ...(title === loaded.title ? {} : { title }),
        ...(body === loaded.body ? {} : { body }),
      })
      .then((next) => {
        // Keep what was typed while the write was in flight, if anything.
        setLoaded(next);
        setConflict(null);
        reportSave("saved");
      })
      .catch((cause: unknown) => {
        failed(cause, "The draft was not saved");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  function confirmPending(): void {
    if (loaded === null || pending === null) {
      return;
    }
    const action = pending;
    setPending(null);
    setSaving(true);
    setActionError(null);
    let write: Promise<void>;
    switch (action.kind) {
      case "publish":
        write = writer
          .publish(slug, locale, loaded.revision, note)
          .then((next) => {
            setNote("");
            adopt(next);
          });
        break;
      case "unpublish":
        write = writer.unpublish(slug, locale).then(adopt);
        break;
      case "restore":
        write = writer
          .restore(slug, locale, action.version, loaded.revision)
          .then(adopt);
        break;
      case "delete":
        write = writer.remove(slug, locale).then(() => {
          allowLeaving();
          void navigate(routes.siteDocuments);
        });
        break;
    }
    write
      .catch((cause: unknown) => {
        failed(cause, "The action did not complete");
      })
      .finally(() => {
        setSaving(false);
      });
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={reload} />;
  }
  if (loaded === null) {
    return <LoadingState label="Loading the document…" />;
  }

  const published = loaded.publishedVersion !== null;
  const bodyEmpty = body.trim() === "";
  const publishBlocked = dirty
    ? "Save the draft before publishing it"
    : bodyEmpty
      ? "An empty document cannot be published"
      : !loaded.hasUnpublishedChanges
        ? "The site already serves this text"
        : null;

  return (
    <Box sx={{ pb: 4 }}>
      <Title title={`${loaded.title} · ${locale}`} />
      <PageHeader
        title={loaded.title}
        surface="draft"
        surfaceNote={`/${slug} · ${locale}`}
        breadcrumbs={
          <Link component={RouterLink} to={routes.siteDocuments}>
            ← Site documents
          </Link>
        }
        meta={
          <>
            <DocumentStateChips document={loaded} />
            <MetaItem label="Revision">{String(loaded.revision)}</MetaItem>
            <MetaItem label="Updated">
              <span title={absoluteTime(loaded.updatedAt)}>
                {relativeTime(loaded.updatedAt)}
              </span>
            </MetaItem>
            {published && pageUrl !== null && (
              <MetaItem label="Live">
                <Link href={pageUrl} target="_blank" rel="noopener">
                  {pageUrl.replace(/^https?:\/\//, "")}
                </Link>
              </MetaItem>
            )}
          </>
        }
        actions={
          <>
            {published && (
              <Button
                variant="outlined"
                color="warning"
                disabled={!publisher || saving}
                onClick={() => {
                  setPending({ kind: "unpublish" });
                }}
              >
                Unpublish
              </Button>
            )}
            {!published && (
              <Button
                variant="outlined"
                color="error"
                disabled={permissions !== "ADMIN" || saving}
                onClick={() => {
                  setPending({ kind: "delete" });
                }}
              >
                Delete
              </Button>
            )}
          </>
        }
      />

      <Stack spacing={2}>
        <SnapshotNotice configured={status?.snapshotConfigured} />
        {conflict !== null && (
          <Alert
            severity="warning"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  if (
                    document !== null &&
                    document.revision !== loaded.revision
                  ) {
                    adopt(document);
                  } else {
                    reload();
                    setAdoptedKey(null);
                    setLoaded(null);
                  }
                }}
              >
                Load the latest
              </Button>
            }
          >
            Someone changed this document since you opened it
            {conflict > 0 ? ` (now at revision ${String(conflict)})` : ""}.
            Loading the latest replaces what you typed here.
          </Alert>
        )}
        {actionError !== null && (
          <Alert
            severity="error"
            onClose={() => {
              setActionError(null);
            }}
          >
            {actionError}
          </Alert>
        )}
        {!editable && (
          <Alert severity="info">
            You are reading this document. Editing needs the EDITOR role,
            publishing needs PUBLISHER.
          </Alert>
        )}

        <Stack
          direction={{ xs: "column", lg: "row" }}
          spacing={2}
          sx={{ alignItems: "stretch" }}
        >
          <Card sx={{ flex: 1, minWidth: 0 }}>
            <CardContent>
              <Stack spacing={2}>
                <TextField
                  label="Title"
                  value={title}
                  disabled={!editable || saving}
                  fullWidth
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                />
                <TextField
                  label="Markdown"
                  value={body}
                  disabled={!editable || saving}
                  fullWidth
                  multiline
                  minRows={24}
                  slotProps={{
                    htmlInput: {
                      "aria-label": "Markdown",
                      spellCheck: true,
                      style: {
                        fontFamily: "ui-monospace, SFMono-Regular, monospace",
                        fontSize: "0.9rem",
                        lineHeight: 1.5,
                      },
                    },
                  }}
                  onChange={(event) => {
                    setBody(event.target.value);
                  }}
                />
                <Typography variant="caption" color="text.secondary">
                  Headings with <code>##</code>, lists with <code>-</code>,
                  links as <code>[text](https://…)</code>. Raw HTML is shown as
                  text, never rendered.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
          <Card sx={{ flex: 1, minWidth: 0 }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: "center", justifyContent: "space-between" }}
                >
                  <Typography variant="overline">Preview</Typography>
                  {dirty && (
                    <Chip size="small" variant="outlined" label="Unsaved" />
                  )}
                </Stack>
                <RenderedPreview html={previewHtml ?? loaded.html} />
              </Stack>
            </CardContent>
          </Card>
        </Stack>

        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h6" component="h2">
                Versions
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Every publication, newest first. Restoring copies that text into
                the draft; the site changes only when it is published again.
              </Typography>
              {versions === null ? (
                <LoadingState label="Loading the versions…" />
              ) : versions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing has been published yet.
                </Typography>
              ) : (
                <Table size="small" aria-label="Versions">
                  <TableHead>
                    <TableRow>
                      <TableCell>Version</TableCell>
                      <TableCell>Title</TableCell>
                      <TableCell>Note</TableCell>
                      <TableCell>Published</TableCell>
                      <TableCell />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {versions.map((version) => (
                      <TableRow key={version.version} hover>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: "center" }}
                          >
                            <span>v{String(version.version)}</span>
                            {version.current && (
                              <Chip
                                size="small"
                                color="success"
                                variant="outlined"
                                label="On the site"
                              />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>{version.title}</TableCell>
                        <TableCell>{version.note ?? "—"}</TableCell>
                        <TableCell>
                          <span title={absoluteTime(version.publishedAt)}>
                            {relativeTime(version.publishedAt)}
                          </span>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            disabled={!editable || saving || dirty}
                            onClick={() => {
                              setPending({
                                kind: "restore",
                                version: version.version,
                              });
                            }}
                          >
                            Restore into draft
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <StickyActionBar
        status={
          conflict !== null
            ? "Refused: the document moved on"
            : saving
              ? "Working…"
              : dirty
                ? "Unsaved changes"
                : (publishBlocked ?? "Ready to publish")
        }
        secondary={
          <Button
            variant="outlined"
            disabled={!editable || !dirty || saving || title.trim() === ""}
            onClick={save}
          >
            Save draft
          </Button>
        }
        primary={
          <Button
            variant="contained"
            disabled={!publisher || saving || publishBlocked !== null}
            title={publishBlocked ?? undefined}
            onClick={() => {
              setPending({ kind: "publish" });
            }}
          >
            Publish
          </Button>
        }
      />

      <Dialog
        open={pending !== null}
        onClose={
          saving
            ? undefined
            : () => {
                setPending(null);
              }
        }
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {pending?.kind === "publish" && "Publish this document"}
          {pending?.kind === "unpublish" && "Take this document off the site"}
          {pending?.kind === "delete" && "Delete this document"}
          {pending?.kind === "restore" &&
            `Restore version ${String(pending.version)} into the draft`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <DialogContentText>
              {pending?.kind === "publish" &&
                `The site will serve this text at /${slug} in ${locale} within a minute as version ${String((versions?.[0]?.version ?? 0) + 1)}.`}
              {pending?.kind === "unpublish" &&
                `Readers of /${slug} in ${locale} will get the English text instead, or nothing if there is none. The versions stay recorded.`}
              {pending?.kind === "delete" &&
                "The draft and its recorded versions are removed. This cannot be undone."}
              {pending?.kind === "restore" &&
                "The draft's title and text are replaced by that version's. Nothing changes on the site until you publish."}
            </DialogContentText>
            {pending?.kind === "publish" && (
              <TextField
                size="small"
                label="Note for the history"
                value={note}
                autoFocus
                fullWidth
                helperText="Optional — why this version exists"
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setPending(null);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            variant="contained"
            color={pending?.kind === "delete" ? "error" : "primary"}
            disabled={saving}
            onClick={confirmPending}
          >
            {pending?.kind === "publish" && "Publish"}
            {pending?.kind === "unpublish" && "Unpublish"}
            {pending?.kind === "delete" && "Delete"}
            {pending?.kind === "restore" && "Restore"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
