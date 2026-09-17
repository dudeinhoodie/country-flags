import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useNavigate } from "react-router-dom";
import { routes } from "../../app/routes";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { relativeTime } from "../../components/relative-time";
import { EmptyState, ErrorState } from "../../components/StateViews";
import {
  sitePageUrl,
  useSiteDocuments,
  useSiteDocumentWriter,
  useSiteStatus,
} from "./useSiteDocuments";
import type { SiteDocumentSummary } from "./useSiteDocuments";

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function canDraft(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/**
 * Where a document stands in three words: what the site serves, and whether
 * the draft has gone past it. "Published · v3" with unpublished changes is
 * the state an editor most needs to see, so it gets two chips rather than a
 * merged one.
 */
export function DocumentStateChips({
  document,
}: {
  document: SiteDocumentSummary;
}) {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
      {document.publishedVersion === null ? (
        <Chip size="small" variant="outlined" label="Not published" />
      ) : (
        <Chip
          size="small"
          variant="outlined"
          color="success"
          label={`Published · v${String(document.publishedVersion)}`}
        />
      )}
      {document.publishedVersion !== null && document.hasUnpublishedChanges && (
        <Chip
          size="small"
          variant="outlined"
          color="warning"
          label="Draft changes"
        />
      )}
    </Stack>
  );
}

/** Says plainly when publishing here reaches no site at all. */
export function SnapshotNotice({
  configured,
}: {
  configured: boolean | undefined;
}) {
  if (configured !== false) {
    return null;
  }
  return (
    <Alert severity="warning">
      This deployment has no snapshot store configured: publishing records a
      version, but nothing reaches a site until SITE_OBJECT_STORAGE_* is set.
    </Alert>
  );
}

/**
 * The site's documents (ADR-023): the privacy policy, the terms and
 * whatever else the app links to, one row per address and language.
 *
 * Nothing here edits published text directly. A row is a draft; the site
 * serves the version a PUBLISHER last released, and the list says which.
 */
export function SiteDocumentsPage() {
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const { status } = useSiteStatus();
  const { documents, error, reload } = useSiteDocuments();
  const { create } = useSiteDocumentWriter();
  const [slug, setSlug] = useState("");
  const [locale, setLocale] = useState("en");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const editable = canDraft(permissions);
  const slugProblem =
    slug === "" || SLUG_PATTERN.test(slug)
      ? null
      : "Lowercase words joined by hyphens, like privacy or terms-of-use";
  const localeProblem =
    locale === "" || LOCALE_PATTERN.test(locale)
      ? null
      : "A language tag, like en, ru or pt-BR";

  function start(): void {
    setSaving(true);
    setActionError(null);
    create({ slug, locale, title })
      .then((created) => {
        setSlug("");
        setTitle("");
        reload();
        void navigate(routes.siteDocument(created.slug, created.locale));
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error
            ? cause.message
            : "The document was not created",
        );
      })
      .finally(() => {
        setSaving(false);
      });
  }

  if (error !== null) {
    return <ErrorState message={error} onRetry={reload} />;
  }

  return (
    <Box sx={{ pb: 4 }}>
      <Title title="Site documents" />
      <PageHeader
        title="Site documents"
        description="The pages the app links to — the privacy policy, the terms — as Markdown drafts per language. The site serves what a PUBLISHER last published, and keeps serving it while the API is down."
        meta={
          <>
            <MetaItem label="Published">
              {status === null ? "…" : String(status.publishedCount)}
            </MetaItem>
            {status?.siteUrl !== null && status?.siteUrl !== undefined && (
              <MetaItem label="Site">
                <Link href={status.siteUrl} target="_blank" rel="noopener">
                  {status.siteUrl.replace(/^https?:\/\//, "")}
                </Link>
              </MetaItem>
            )}
          </>
        }
      />

      <Stack spacing={2}>
        <SnapshotNotice configured={status?.snapshotConfigured} />

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
            You are reading the documents. Drafting one needs the EDITOR role,
            and putting one on the site needs PUBLISHER.
          </Alert>
        )}

        <Card>
          <CardContent>
            {documents === null ? (
              <LoadingState label="Loading the documents…" />
            ) : documents.length === 0 ? (
              <EmptyState
                title="No documents yet"
                description="Start one below, or import the seed files with `corepack yarn site:documents:import`."
              />
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Address</TableCell>
                    <TableCell>Language</TableCell>
                    <TableCell>Title</TableCell>
                    <TableCell>State</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {documents.map((document) => {
                    const pageUrl = sitePageUrl(
                      status,
                      document.slug,
                      document.locale,
                    );
                    return (
                      <TableRow
                        key={`${document.slug}.${document.locale}`}
                        hover
                      >
                        <TableCell>
                          <code>/{document.slug}</code>
                        </TableCell>
                        <TableCell>{document.locale}</TableCell>
                        <TableCell>{document.title}</TableCell>
                        <TableCell>
                          <DocumentStateChips document={document} />
                        </TableCell>
                        <TableCell>
                          {relativeTime(document.updatedAt)}
                        </TableCell>
                        <TableCell align="right">
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ justifyContent: "flex-end" }}
                          >
                            {pageUrl !== null &&
                              document.publishedVersion !== null && (
                                <Button
                                  size="small"
                                  href={pageUrl}
                                  target="_blank"
                                  rel="noopener"
                                >
                                  On the site
                                </Button>
                              )}
                            <Button
                              size="small"
                              variant="outlined"
                              onClick={() => {
                                void navigate(
                                  routes.siteDocument(
                                    document.slug,
                                    document.locale,
                                  ),
                                );
                              }}
                            >
                              {editable ? "Open" : "View"}
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography variant="h6" component="h2">
                Start a document
              </Typography>
              <Typography variant="body2" color="text.secondary">
                The address is shared by every language of the document: the app
                opens <code>/privacy?lang=ru</code> and the site picks the
                Russian text, or English when Russian is not published.
              </Typography>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
              >
                <TextField
                  size="small"
                  label="Address"
                  value={slug}
                  disabled={!editable || saving}
                  error={slugProblem !== null}
                  helperText={slugProblem ?? "For example privacy"}
                  sx={{ minWidth: 220 }}
                  onChange={(event) => {
                    setSlug(event.target.value.toLowerCase());
                  }}
                />
                <TextField
                  size="small"
                  label="Language"
                  value={locale}
                  disabled={!editable || saving}
                  error={localeProblem !== null}
                  helperText={localeProblem ?? "en or ru"}
                  sx={{ minWidth: 140 }}
                  onChange={(event) => {
                    setLocale(event.target.value);
                  }}
                />
                <TextField
                  size="small"
                  label="Title"
                  value={title}
                  disabled={!editable || saving}
                  helperText="Shown as the page heading"
                  sx={{ minWidth: 280 }}
                  onChange={(event) => {
                    setTitle(event.target.value);
                  }}
                />
                <Button
                  variant="contained"
                  disabled={
                    !editable ||
                    saving ||
                    slugProblem !== null ||
                    localeProblem !== null ||
                    slug === "" ||
                    locale === "" ||
                    title.trim() === ""
                  }
                  onClick={start}
                >
                  Start draft
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}
