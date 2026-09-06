import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useRef, useState } from "react";
import { Title, useGetIdentity, usePermissions } from "react-admin";
import { Link, useNavigate, useParams } from "react-router-dom";
import { conflictOfError } from "../../api/draft-conflict";
import type { DraftConflict } from "../../api/draft-conflict";
import { useRefreshDrafts } from "../../app/CurrentDraftContext";
import { routes } from "../../app/routes";
import { useReportSaveStatus } from "../../app/SaveStatusContext";
import { useUnsavedChanges } from "../../app/UnsavedChanges";
import { useFieldFocus } from "../../app/useFieldFocus";
import { ConflictDialog } from "../../components/ConflictDialog";
import { EditorTabPanel, EditorTabs } from "../../components/EditorTabs";
import type { EditorTabDefinition } from "../../components/EditorTabs";
import { FindingList } from "../../components/FindingList";
import { LoadingState } from "../../components/LoadingState";
import { MetaItem, PageHeader } from "../../components/PageHeader";
import { ErrorState } from "../../components/StateViews";
import { StickyActionBar } from "../../components/StickyActionBar";
import { deckCodeFromKey, membersToRefs } from "./deck-cards";
import { DeckAccessEditor } from "./DeckAccessEditor";
import type { PublishedAccess } from "./DeckAccessEditor";
import {
  DECK_LOCALES,
  deckChanges,
  emptyDeckForm,
  formOf,
  payloadOf,
  sameDeck,
} from "./deck-form";
import type { DeckForm } from "./deck-form";
import { DeckMembersEditor, modeOf, PreviewCards } from "./DeckMembersEditor";
import {
  useCommerceContour,
  useDeckWriter,
  useDraftDeck,
  useDraftEntityPool,
  usePublishedDeckCodes,
  useDraftWithDecks,
} from "./useDraftDecks";
import type { DraftDeckDetail } from "./useDraftDecks";
import { useValidateDraft } from "./useValidateDraft";

/**
 * One deck, tab by tab (§8.1).
 *
 * The tab is a route segment, because the server addresses a finding to a
 * tab and a field: `content` with `/members/3` has to open the third card in
 * the list, and `access` with `/access/requiredEntitlementKey` has to put the
 * caret in the entitlement box (§9).
 *
 * Saving is explicit, the form knows what it was loaded with, and a write
 * over a revision somebody else has moved is refused rather than applied.
 */

const TABS: readonly EditorTabDefinition[] = [
  { id: "details", label: "Details" },
  { id: "content", label: "Cards" },
  { id: "presentation", label: "Presentation" },
  { id: "access", label: "Access & store" },
  { id: "review", label: "Review" },
];

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/** The commerce fields a deck's own history has already fixed. */
function publishedAccessOf(
  deck: DraftDeckDetail | null,
  publishedCodes: ReadonlySet<string> | null,
): PublishedAccess {
  if (deck === null || publishedCodes === null) {
    return "unpublished";
  }
  if (!publishedCodes.has(deckCodeFromKey(deck.key))) {
    return "unpublished";
  }
  // What the deck last saved says, not what the form is now showing: the
  // server refuses a change away from it either way.
  return deck.access.model === "ENTITLEMENT" ? "paid" : "free";
}

export function DeckEditor() {
  const { draftId, deckKey, tab: rawTab } = useParams();
  const draft = draftId ?? "";
  const isNew = deckKey === undefined || deckKey === "new";
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const { identity } = useGetIdentity();
  const editable = canEdit(permissions);

  const {
    draft: draftDetail,
    error: draftError,
    reload: reloadDraft,
  } = useDraftWithDecks(draft);
  const {
    deck,
    error: deckError,
    reload,
  } = useDraftDeck(draft, isNew ? undefined : deckKey);
  const { entities } = useDraftEntityPool(draft);
  const { create, update } = useDeckWriter(draft);
  const publishedCodes = usePublishedDeckCodes();
  const contour = useCommerceContour();
  const reportSave = useReportSaveStatus();
  const refreshDrafts = useRefreshDrafts();

  const [form, setForm] = useState<DeckForm>(emptyDeckForm);
  const [baseline, setBaseline] = useState<DeckForm>(emptyDeckForm);
  const [revision, setRevision] = useState<number | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [saving, setSaving] = useState(false);
  const reseedFrom = useRef<DraftDeckDetail | null>(null);

  const seed = useCallback((next: DraftDeckDetail) => {
    const seededForm = formOf(next);
    setForm(seededForm);
    setBaseline(seededForm);
    setRevision(next.draftRevision);
    setSeeded(next.key);
  }, []);

  // The loaded deck seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  if (deck !== null && seeded !== deck.key) {
    seed(deck);
  }
  if (isNew && revision === null && draftDetail !== null) {
    setRevision(draftDetail.revision);
  }

  useEffect(() => {
    const wanted = reseedFrom.current;
    if (wanted !== null && deck !== null && deck !== wanted) {
      reseedFrom.current = null;
      seed(deck);
    }
  }, [deck, seed]);

  const dirty = !sameDeck(baseline, form);
  const { allowLeaving } = useUnsavedChanges(
    dirty && editable,
    deckKey === undefined ? "" : routes.draftDeck(draft, deckKey),
  );

  // The top bar says whether what is on screen is written down (§4.2). Only
  // this screen's own reading is withdrawn when the form goes clean, so a
  // "Saved" the save itself put there survives. No dependency list: the status
  // is scoped to the address it came from, and a tab is an address.
  const announcedDirty = useRef(false);
  useEffect(() => {
    if (dirty) {
      announcedDirty.current = true;
      reportSave("unsaved");
    } else if (announcedDirty.current) {
      announcedDirty.current = false;
      reportSave("idle");
    }
  });

  const onValidated = useCallback(() => {
    reload();
  }, [reload]);
  const validation = useValidateDraft(draft, onValidated);

  useFieldFocus(draftDetail !== null && (isNew || deck !== null));

  if (draftError !== null || deckError !== null) {
    return <ErrorState message={draftError ?? deckError ?? ""} />;
  }
  if (draftDetail === null || (!isNew && deck === null)) {
    return <LoadingState label="Loading the deck…" />;
  }

  const tab = TABS.some((entry) => entry.id === rawTab)
    ? (rawTab ?? "details")
    : "details";
  const findings = deck?.validation.findings ?? [];
  const tabs = TABS.map((entry) => ({
    ...entry,
    issues: findings.filter((finding) => finding.target.tab === entry.id)
      .length,
  }));

  const published = publishedAccessOf(deck, publishedCodes);
  const keyMissing = isNew && form.key.trim() === "";
  const blocked = keyMissing;
  const refs = membersToRefs(form.membership.members, form.membership.defaults);

  function patch(changes: Partial<DeckForm>): void {
    setForm((current) => ({ ...current, ...changes }));
  }

  function save(): void {
    if (revision === null || blocked) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    reportSave("saving");
    const sent = form;
    const done = (stamp: { revision: number }): void => {
      setSaving(false);
      setBaseline(sent);
      setRevision(stamp.revision);
      // The form is about to go clean, and the effect above must not read
      // that as a reason to withdraw the word "Saved".
      announcedDirty.current = false;
      reportSave("saved");
      // The shell shows when the draft was last written; a save it did not
      // hear about would leave that reading stale.
      refreshDrafts();
      allowLeaving();
      if (isNew) {
        void navigate(routes.draftDeck(draft, sent.key));
        return;
      }
      // The saved deck is re-read rather than assumed: the resolved cards,
      // the validation summary and the access checks all move with it.
      reload();
    };
    const failed = (cause: unknown): void => {
      setSaving(false);
      const conflicted = conflictOfError(cause);
      if (conflicted !== null) {
        setConflict(conflicted);
        reportSave("error", "Somebody else saved this draft first");
        return;
      }
      const message =
        cause instanceof Error ? cause.message : "The deck could not be saved";
      setSaveError(message);
      reportSave("error", message);
    };
    if (isNew) {
      void create(revision, { key: sent.key, ...payloadOf(sent) }).then(
        done,
        failed,
      );
      return;
    }
    if (deck === null) {
      return;
    }
    void update(revision, deck.key, payloadOf(sent)).then(done, failed);
  }

  function discard(): void {
    setForm(baseline);
    setSaveError(null);
    announcedDirty.current = false;
    reportSave("idle");
  }

  const title = isNew
    ? "New deck"
    : (form.names.ru?.name ?? form.names.en?.name ?? form.key);

  return (
    <Box sx={{ pb: 4 }}>
      <Title title={isNew ? "New deck" : `Deck ${form.key}`} />
      <PageHeader
        title={title}
        surface="draft"
        surfaceNote={`revision ${String(revision ?? draftDetail.revision)}`}
        breadcrumbs={<Link to={routes.draftDecks(draft)}>Deck builder</Link>}
        meta={
          <>
            <MetaItem label="Key">
              <code>{form.key === "" ? "not chosen yet" : form.key}</code>
            </MetaItem>
            <MetaItem label="Cards">
              {modeOf(form.membership.members) === "explicit"
                ? String(refs.length)
                : String(deck?.memberCount ?? 0)}
            </MetaItem>
            <MetaItem label="Access">
              {form.access.model === "ENTITLEMENT" ? "Paid" : "Free"}
            </MetaItem>
            {deck !== null && deck.summary.missingAssetCount > 0 && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`${String(deck.summary.missingAssetCount)} cards without a drawing`}
              />
            )}
          </>
        }
      />

      {!editable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You are viewing this deck. Editing needs the EDITOR role.
        </Alert>
      )}
      {saveError !== null && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          onClose={() => {
            setSaveError(null);
          }}
        >
          {saveError}
        </Alert>
      )}
      {validation.error !== null && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={validation.dismiss}>
          {validation.error}
        </Alert>
      )}

      <EditorTabs
        tabs={tabs}
        current={tab}
        idPrefix="deck"
        label="Deck builder sections"
        hrefOf={(id) =>
          `${routes.draftDeck(draft, isNew ? "new" : form.key)}/${id}`
        }
      />

      <Card>
        <CardContent>
          <EditorTabPanel idPrefix="deck" tab="details" current={tab}>
            <Stack spacing={3}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Key"
                  data-field="/key"
                  value={form.key}
                  onChange={(event) => {
                    patch({ key: event.target.value });
                  }}
                  size="small"
                  disabled={!isNew || !editable}
                  error={keyMissing}
                  helperText={
                    isNew
                      ? "For example deck.europe — it cannot change later."
                      : " "
                  }
                  sx={{ minWidth: 260 }}
                />
                <TextField
                  select
                  label="Kind"
                  value={form.kind}
                  size="small"
                  disabled={!editable}
                  onChange={(event) => {
                    patch({
                      kind: event.target.value as "curated" | "taxonomy",
                    });
                  }}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="curated">Curated</MenuItem>
                  <MenuItem value="taxonomy">Taxonomy</MenuItem>
                </TextField>
              </Stack>

              {DECK_LOCALES.map((locale) => (
                <Stack key={locale} spacing={1}>
                  <Typography variant="subtitle2" component="h3">
                    {locale.toUpperCase()}
                  </Typography>
                  <TextField
                    label={`Name (${locale})`}
                    data-field={`/names/${locale}/name`}
                    value={form.names[locale]?.name ?? ""}
                    size="small"
                    disabled={!editable}
                    onChange={(event) => {
                      patch({
                        names: {
                          ...form.names,
                          [locale]: {
                            name: event.target.value,
                            description: form.names[locale]?.description ?? "",
                          },
                        },
                      });
                    }}
                  />
                  <TextField
                    label={`Description (${locale})`}
                    data-field={`/names/${locale}/description`}
                    value={form.names[locale]?.description ?? ""}
                    size="small"
                    multiline
                    minRows={2}
                    disabled={!editable}
                    onChange={(event) => {
                      patch({
                        names: {
                          ...form.names,
                          [locale]: {
                            name: form.names[locale]?.name ?? "",
                            description: event.target.value,
                          },
                        },
                      });
                    }}
                  />
                </Stack>
              ))}
            </Stack>
          </EditorTabPanel>

          <EditorTabPanel idPrefix="deck" tab="content" current={tab}>
            <DeckMembersEditor
              draftId={draft}
              deckKey={isNew ? undefined : deckKey}
              entities={entities}
              value={form.membership}
              savedMemberCount={deck?.memberCount ?? null}
              disabled={!editable}
              onChange={(membership) => {
                patch({ membership });
              }}
            />
          </EditorTabPanel>

          <EditorTabPanel idPrefix="deck" tab="presentation" current={tab}>
            <PreviewCards
              previewCardIds={form.membership.previewCardIds}
              refs={refs}
              entities={entities}
              curated={modeOf(form.membership.members) === "explicit"}
              disabled={!editable}
              onChange={(previewCardIds) => {
                patch({
                  membership: { ...form.membership, previewCardIds },
                });
              }}
            />
          </EditorTabPanel>

          <EditorTabPanel idPrefix="deck" tab="access" current={tab}>
            <DeckAccessEditor
              value={form.access}
              published={published}
              contour={contour}
              disabled={!editable}
              onChange={(access) => {
                patch({ access });
              }}
            />
          </EditorTabPanel>

          <EditorTabPanel idPrefix="deck" tab="review" current={tab}>
            <Stack spacing={2}>
              <Typography variant="subtitle2" component="h3">
                What a release would say about this deck
              </Typography>
              <FindingList
                draftId={draft}
                findings={findings}
                emptyLabel="Nothing about this deck is blocking or warned about, as of the last validation run."
              />
              <Box>
                <Button
                  component={Link}
                  to={routes.draftRelease(draft)}
                  variant="outlined"
                >
                  Validation &amp; release
                </Button>
              </Box>
            </Stack>
          </EditorTabPanel>
        </CardContent>
      </Card>

      <StickyActionBar
        status={
          keyMissing
            ? "A deck needs a key before it can be created."
            : editable
              ? dirty
                ? "Unsaved changes."
                : "Everything on this screen is saved."
              : "You are viewing this deck; editing needs the EDITOR role."
        }
        secondary={
          <>
            <Button
              variant="outlined"
              disabled={!editable || saving || !dirty}
              onClick={discard}
            >
              Discard changes
            </Button>
            <Button
              variant="outlined"
              disabled={!editable || validation.validating}
              onClick={validation.validate}
            >
              {validation.validating ? "Validating…" : "Validate"}
            </Button>
          </>
        }
        primary={
          <Button
            variant="contained"
            disabled={!editable || saving || blocked || (!isNew && !dirty)}
            onClick={save}
          >
            {saving ? "Saving…" : isNew ? "Create deck" : "Save deck"}
          </Button>
        }
      />

      {conflict !== null && (
        <ConflictDialog
          conflict={conflict}
          changes={deckChanges(baseline, form)}
          viewerId={identity?.id === undefined ? null : String(identity.id)}
          onClose={() => {
            setConflict(null);
          }}
          onReload={() => {
            setConflict(null);
            reportSave("idle");
            // The refusal already named the revision that won, so the next
            // write can be aimed at it without waiting for a read. A deck
            // being created has no deck of its own to re-read, and without
            // this it would go on being refused against a revision that is
            // gone.
            if (conflict.currentRevision !== null) {
              setRevision(conflict.currentRevision);
            }
            if (isNew) {
              reloadDraft();
              return;
            }
            reseedFrom.current = deck;
            reload();
          }}
        />
      )}
    </Box>
  );
}
