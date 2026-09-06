import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
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
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { useCallback, useEffect, useRef, useState } from "react";
import { Title, useGetIdentity, usePermissions } from "react-admin";
import { Link, useParams } from "react-router-dom";
import { conflictOfError } from "../../api/draft-conflict";
import type { DraftConflict } from "../../api/draft-conflict";
import { routes } from "../../app/routes";
import { useRefreshDrafts } from "../../app/CurrentDraftContext";
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
import { useFeature } from "../../config/RuntimeConfigContext";
import { EntityMedia } from "./EntityMedia";
import type { UploadRequest } from "./EntityMedia";
import {
  ENTITY_STATUSES,
  ENTITY_TYPES,
  IDENTIFIERS,
  LOCALIZED_FACTS,
  MEASURED_FACTS,
  NAME_FIELDS,
  PARENT_TYPES,
  SUBDIVISION_RECOGNITION_STATUS,
  EMPTY_MEASURED,
  entityChanges,
  formOf,
  identifierError,
  namePath,
  payloadOf,
  sameEntity,
} from "./entity-form";
import type { EntityForm, EntityType } from "./entity-form";
import { useAssetWriter } from "./useDraftAssets";
import {
  useDraftEntities,
  useDraftEntity,
  useEntityWriter,
} from "./useDraftEntities";
import type {
  DraftEntityDetail,
  DraftEntityListItem,
} from "./useDraftEntities";
import { useValidateDraft } from "./useValidateDraft";

export { identifierError } from "./entity-form";

/**
 * One country, state or region, tab by tab (§6.2).
 *
 * The tabs are route segments rather than component state, because a
 * validation finding is addressed to an object, a tab and a field: the
 * console has to be able to open all three from a link (§9). The `data-field`
 * attributes below are the other half of that — they are what a pointer like
 * `/parentKey` lands on.
 *
 * Saving is explicit. The form knows what it was loaded with, so it can say
 * whether it is dirty, restore itself, and — when someone else has saved in
 * the meantime — say exactly what this editor would have written.
 */

const TABS: readonly EditorTabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "names", label: "Names & locales" },
  { id: "facts", label: "Facts" },
  { id: "media", label: "Media" },
  { id: "usage", label: "Deck usage" },
];

const DELIVERY_LABEL: Record<string, string> = {
  PUBLIC: "Public",
  PUBLIC_PREVIEW: "Public preview",
  PAID_ONLY: "Paid-only",
};

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

export function EntityEditor() {
  const { draftId, entityKey, tab: rawTab } = useParams();
  const draft = draftId ?? "";
  const { permissions } = usePermissions<string>();
  const { identity } = useGetIdentity();
  const editable = canEdit(permissions);
  const advancedOverrides = useFeature("advancedOverrides");

  const {
    detail,
    error: entityError,
    reload,
  } = useDraftEntity(draft, entityKey);
  const { entities } = useDraftEntities(draft);
  const { update } = useEntityWriter(draft);
  const assets = useAssetWriter(draft);
  const reportSave = useReportSaveStatus();
  const refreshDrafts = useRefreshDrafts();

  const [form, setForm] = useState<EntityForm | null>(null);
  const [baseline, setBaseline] = useState<EntityForm | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [seeded, setSeeded] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parentWarning, setParentWarning] = useState(false);
  // Which answer the form must be rebuilt from once a reload lands. Object
  // identity, not a flag: the reload is in flight while the old answer is
  // still on screen, and reseeding from that one would undo nothing.
  const reseedFrom = useRef<DraftEntityDetail | null>(null);

  const seed = useCallback((next: DraftEntityDetail) => {
    const seededForm = formOf(next.entity);
    setForm(seededForm);
    setBaseline(seededForm);
    setRevision(next.draftRevision);
    setSeeded(next.entity.key);
  }, []);

  // The loaded entity seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  if (detail !== null && seeded !== detail.entity.key) {
    seed(detail);
  }

  useEffect(() => {
    const wanted = reseedFrom.current;
    if (wanted !== null && detail !== null && detail !== wanted) {
      reseedFrom.current = null;
      seed(detail);
    }
  }, [detail, seed]);

  const dirty =
    form !== null && baseline !== null && !sameEntity(baseline, form);
  const { allowLeaving } = useUnsavedChanges(
    dirty && editable,
    entityKey === undefined ? "" : routes.draftEntity(draft, entityKey),
  );

  // The top bar says whether what is on screen is written down (§4.2). It is
  // told when the form becomes dirty and when it stops being — typing a value
  // back to what it was is not an unsaved change — but only this screen's own
  // reading is withdrawn, so a "Saved" the save itself put there survives.
  const announcedDirty = useRef(false);
  useEffect(() => {
    if (dirty) {
      announcedDirty.current = true;
      reportSave("unsaved");
    } else if (announcedDirty.current) {
      announcedDirty.current = false;
      reportSave("idle");
    }
  }, [dirty, reportSave]);

  const onValidated = useCallback(() => {
    reload();
  }, [reload]);
  const validation = useValidateDraft(draft, onValidated);

  const ready = detail !== null && form !== null;
  useFieldFocus(ready);

  if (entityError !== null) {
    return <ErrorState message={entityError} onRetry={reload} />;
  }
  if (detail === null || form === null || baseline === null) {
    return <LoadingState label="Loading the entity…" />;
  }

  const tab = TABS.some((entry) => entry.id === rawTab)
    ? (rawTab ?? "overview")
    : "overview";
  const findings = detail.validation.findings;
  const tabs = TABS.map((entry) => ({
    ...entry,
    issues: findings.filter((finding) => finding.target.tab === entry.id)
      .length,
  }));

  function patch(changes: Partial<EntityForm>): void {
    setForm((current) =>
      current === null ? current : { ...current, ...changes },
    );
  }

  const isSubdivision = form.type === "subdivision";
  // What the active release serves for this entity. An entity the release
  // already carries is one whose parent other things are built on.
  const published = Object.keys(detail.publishedNames).length > 0;
  const parentChanged = form.parentKey !== (detail.entity.parentKey ?? "");
  const needsParentWarning =
    published && detail.entity.type === "subdivision" && parentChanged;

  const parentOptions: DraftEntityListItem[] = (entities ?? []).filter(
    (candidate) =>
      PARENT_TYPES.includes(candidate.type) &&
      candidate.key !== detail.entity.key,
  );
  const selectedParent =
    parentOptions.find((candidate) => candidate.key === form.parentKey) ?? null;

  const identifierErrors = Object.entries(form.identifiers)
    .map(([key, value]) => identifierError(key, value))
    .filter((message): message is string => message !== null);
  const parentMissing = isSubdivision && form.parentKey.trim() === "";
  const blocked = identifierErrors.length > 0 || parentMissing;

  const locales = [
    ...new Set([
      "en",
      "ru",
      ...Object.keys(detail.publishedNames),
      ...Object.keys(form.nameOverrides).map(
        (path) => path.split(".")[1] ?? "",
      ),
      ...LOCALIZED_FACTS.flatMap(({ key }) =>
        Object.keys(form.localizedFacts[key] ?? {}),
      ),
      ...Object.keys(form.languageRows),
    ]),
  ].filter((locale) => locale !== "");

  function save(): void {
    if (form === null || detail === null || revision === null || blocked) {
      return;
    }
    setBusy(true);
    setSaveError(null);
    reportSave("saving");
    const sent = form;
    void update(revision, detail.entity.key, payloadOf(sent)).then(
      (stamp) => {
        setBusy(false);
        setBaseline(sent);
        setRevision(stamp.revision);
        // The form is about to go clean, and the effect above must not read
        // that as a reason to withdraw the word "Saved".
        announcedDirty.current = false;
        reportSave("saved");
        // The shell shows when the draft was last written; a save it did
        // not hear about would leave that reading stale.
        refreshDrafts();
        allowLeaving();
        // The saved entity is re-read rather than assumed: validation, the
        // media slots and the deck usages all move with it.
        reload();
      },
      (cause: unknown) => {
        setBusy(false);
        const conflicted = conflictOfError(cause);
        if (conflicted !== null) {
          setConflict(conflicted);
          reportSave("error", "Somebody else saved this draft first");
          return;
        }
        const message =
          cause instanceof Error
            ? cause.message
            : "The entity could not be saved";
        setSaveError(message);
        reportSave("error", message);
      },
    );
  }

  function requestSave(): void {
    if (needsParentWarning) {
      setParentWarning(true);
      return;
    }
    save();
  }

  function discard(): void {
    setForm(baseline);
    setSaveError(null);
    announcedDirty.current = false;
    reportSave("idle");
  }

  function upload(request: UploadRequest): void {
    if (revision === null) {
      return;
    }
    setBusy(true);
    setUploadError(null);
    void assets.upload(revision, request.file, request.fields).then(
      (result) => {
        setBusy(false);
        setRevision(result.draft.revision);
        refreshDrafts();
        // The slots come from the entity read, so the drawing shows up only
        // once that has been asked again. The form is left alone.
        reload();
      },
      (cause: unknown) => {
        setBusy(false);
        const conflicted = conflictOfError(cause);
        if (conflicted !== null) {
          setConflict(conflicted);
          return;
        }
        setUploadError(
          cause instanceof Error ? cause.message : "The upload was refused",
        );
      },
    );
  }

  const displayName =
    detail.publishedNames.ru ??
    detail.publishedNames.en ??
    form.nameOverrides[namePath("en", "short")] ??
    detail.entity.key;

  return (
    <Box sx={{ pb: 4 }}>
      <Title title={`Entity ${detail.entity.key}`} />
      <PageHeader
        title={displayName}
        surface="draft"
        surfaceNote={`revision ${String(revision ?? detail.draftRevision)}`}
        breadcrumbs={
          <Link to={routes.draftEntities(draft)}>Countries &amp; regions</Link>
        }
        meta={
          <>
            <MetaItem label="Key">
              <code>{detail.entity.key}</code>
            </MetaItem>
            <MetaItem label="Kind">{form.type}</MetaItem>
            <MetaItem label="Delivery">
              {DELIVERY_LABEL[detail.delivery] ?? detail.delivery}
            </MetaItem>
            <MetaItem label="Used in">
              {`${String(detail.usages.length)} ${detail.usages.length === 1 ? "card" : "cards"}`}
            </MetaItem>
            {!detail.locales.complete && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label={`Missing ${detail.locales.missing.join(", ")}`}
              />
            )}
          </>
        }
      />

      {!editable && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You are viewing this entity. Editing needs the EDITOR role.
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

      {findings.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <FindingList draftId={draft} findings={findings} />
        </Box>
      )}

      <EditorTabs
        tabs={tabs}
        current={tab}
        idPrefix="entity"
        label="Entity editor sections"
        hrefOf={(id) => `${routes.draftEntity(draft, detail.entity.key)}/${id}`}
      />

      <Card>
        <CardContent>
          <EditorTabPanel idPrefix="entity" tab="overview" current={tab}>
            <Stack spacing={3}>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                {/* Read-only rather than disabled: the key cannot change,
                    but it is the first thing anybody needs to read off this
                    screen, and a disabled field is skipped by the keyboard
                    and dimmed past AA contrast (§11). */}
                <TextField
                  label="Key"
                  data-field="/key"
                  value={detail.entity.key}
                  size="small"
                  slotProps={{ htmlInput: { readOnly: true } }}
                  helperText="Bound to upstream sources — it cannot change."
                  sx={{ minWidth: 280 }}
                />
                <TextField
                  select
                  label="Type"
                  value={form.type}
                  onChange={(event) => {
                    patch({ type: event.target.value as EntityType });
                  }}
                  size="small"
                  disabled={!editable}
                  sx={{ minWidth: 160 }}
                >
                  {ENTITY_TYPES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label="Status"
                  value={form.status}
                  onChange={(event) => {
                    patch({
                      status: event.target
                        .value as (typeof ENTITY_STATUSES)[number],
                    });
                  }}
                  size="small"
                  disabled={!editable}
                  sx={{ minWidth: 160 }}
                >
                  {ENTITY_STATUSES.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
                <Box data-field="/includeInCountryCatalog">
                  <FormControlLabel
                    control={
                      <Switch
                        checked={isSubdivision ? false : form.inCatalog}
                        onChange={(event) => {
                          patch({ inCatalog: event.target.checked });
                        }}
                        disabled={!editable || isSubdivision}
                      />
                    }
                    label="In country catalog"
                  />
                  {isSubdivision && (
                    <FormHelperText>
                      A subdivision is taught only through a deck that names it,
                      so it never joins the country catalog.
                    </FormHelperText>
                  )}
                </Box>
              </Stack>

              {isSubdivision && (
                <Autocomplete
                  data-field="/parentKey"
                  options={parentOptions}
                  value={selectedParent}
                  onChange={(_event, option) => {
                    patch({ parentKey: option === null ? "" : option.key });
                  }}
                  getOptionLabel={(option) =>
                    option.publishedName === null
                      ? option.key
                      : `${option.publishedName} — ${option.key}`
                  }
                  isOptionEqualToValue={(option, value) =>
                    option.key === value.key
                  }
                  disabled={!editable}
                  size="small"
                  sx={{ maxWidth: 520 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Parent"
                      required
                      error={parentMissing}
                      helperText={
                        parentMissing
                          ? "A subdivision needs the country or territory it belongs to."
                          : "The country or territory this unit belongs to; the publisher turns it into the administrative relation."
                      }
                    />
                  )}
                />
              )}

              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Recognition status"
                  value={
                    isSubdivision
                      ? SUBDIVISION_RECOGNITION_STATUS
                      : form.recognitionStatus
                  }
                  onChange={(event) => {
                    patch({ recognitionStatus: event.target.value });
                  }}
                  size="small"
                  disabled={!editable || isSubdivision}
                  helperText={
                    isSubdivision
                      ? "Recognition is a question about states, not about their parts."
                      : " "
                  }
                  sx={{ minWidth: 220 }}
                />
                <TextField
                  label="Recognition as of"
                  value={form.recognitionAsOf}
                  onChange={(event) => {
                    patch({ recognitionAsOf: event.target.value });
                  }}
                  size="small"
                  disabled={!editable}
                  placeholder="YYYY-MM-DD"
                />
                <TextField
                  label="Valid from"
                  value={form.validFrom}
                  onChange={(event) => {
                    patch({ validFrom: event.target.value });
                  }}
                  size="small"
                  disabled={!editable}
                  placeholder="YYYY-MM-DD"
                />
                <TextField
                  label="Valid to"
                  value={form.validTo}
                  onChange={(event) => {
                    patch({ validTo: event.target.value });
                  }}
                  size="small"
                  disabled={!editable}
                  placeholder="YYYY-MM-DD"
                />
              </Stack>

              <Divider />
              <Typography variant="subtitle2" component="h2">
                Identifiers
              </Typography>
              <Stack
                direction="row"
                spacing={2}
                useFlexGap
                sx={{ flexWrap: "wrap" }}
              >
                {IDENTIFIERS.map(({ key, expected }) => {
                  const message = identifierError(
                    key,
                    form.identifiers[key] ?? "",
                  );
                  return (
                    <TextField
                      key={key}
                      label={key}
                      data-field={`/identifiers/${key}`}
                      value={form.identifiers[key] ?? ""}
                      onChange={(event) => {
                        patch({
                          identifiers: {
                            ...form.identifiers,
                            [key]: event.target.value,
                          },
                        });
                      }}
                      size="small"
                      disabled={!editable}
                      error={message !== null}
                      helperText={message ?? expected}
                      sx={{ width: 190 }}
                    />
                  );
                })}
              </Stack>

              {advancedOverrides && permissions === "ADMIN" && (
                <AdvancedOverrides
                  form={form}
                  editable={editable}
                  onChange={patch}
                />
              )}
            </Stack>
          </EditorTabPanel>

          <EditorTabPanel idPrefix="entity" tab="names" current={tab}>
            <Stack spacing={3}>
              <Typography variant="body2" color="text.secondary">
                Names come from upstream sources; a value typed here becomes an
                editorial override that outranks them. Clear a field to give the
                name back to the sources.
              </Typography>
              {locales.map((locale) => (
                <Stack
                  key={locale}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                >
                  {NAME_FIELDS.map((field) => {
                    const path = namePath(locale, field);
                    return (
                      <TextField
                        key={path}
                        label={`${field} (${locale})`}
                        data-field={`/names/${locale}/${field}`}
                        value={form.nameOverrides[path] ?? ""}
                        onChange={(event) => {
                          patch({
                            nameOverrides: {
                              ...form.nameOverrides,
                              [path]: event.target.value,
                            },
                          });
                        }}
                        size="small"
                        disabled={!editable}
                        placeholder={
                          field === "short"
                            ? (detail.publishedNames[locale] ?? "")
                            : ""
                        }
                        helperText={
                          field === "short" &&
                          detail.publishedNames[locale] !== undefined
                            ? `Published: ${detail.publishedNames[locale]}`
                            : " "
                        }
                        sx={{ minWidth: 260 }}
                      />
                    );
                  })}
                </Stack>
              ))}
            </Stack>
          </EditorTabPanel>

          <EditorTabPanel idPrefix="entity" tab="facts" current={tab}>
            <Stack spacing={3}>
              <Typography variant="body2" color="text.secondary">
                What a curator answers by hand. A field left empty is not
                published; clearing one removes the answer.
              </Typography>
              {LOCALIZED_FACTS.map(({ key, label }) => (
                <Stack
                  key={key}
                  direction={{ xs: "column", sm: "row" }}
                  spacing={2}
                >
                  {locales.map((locale) => (
                    <TextField
                      key={`${key}.${locale}`}
                      label={`${label} (${locale})`}
                      data-field={`/facts/${key}/${locale}`}
                      value={form.localizedFacts[key]?.[locale] ?? ""}
                      onChange={(event) => {
                        patch({
                          localizedFacts: {
                            ...form.localizedFacts,
                            [key]: {
                              ...(form.localizedFacts[key] ?? {}),
                              [locale]: event.target.value,
                            },
                          },
                        });
                      }}
                      size="small"
                      disabled={!editable}
                      sx={{ minWidth: 240 }}
                    />
                  ))}
                </Stack>
              ))}
              {MEASURED_FACTS.map(({ key, label, unit }) => {
                const measured = form.measuredFacts[key] ?? EMPTY_MEASURED;
                const set = (next: Partial<typeof measured>): void => {
                  patch({
                    measuredFacts: {
                      ...form.measuredFacts,
                      [key]: { ...measured, ...next },
                    },
                  });
                };
                return (
                  <Stack
                    key={key}
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                  >
                    <TextField
                      label={label}
                      data-field={`/facts/${key}`}
                      value={measured.value}
                      onChange={(event) => {
                        set({ value: event.target.value });
                      }}
                      size="small"
                      disabled={!editable}
                      inputMode="numeric"
                      sx={{ minWidth: 200 }}
                    />
                    <TextField
                      label={`${label} unit`}
                      value={measured.unit}
                      onChange={(event) => {
                        set({ unit: event.target.value });
                      }}
                      size="small"
                      disabled={!editable}
                      placeholder={unit}
                    />
                    <TextField
                      label={`${label} observed at`}
                      value={measured.observedAt}
                      onChange={(event) => {
                        set({ observedAt: event.target.value });
                      }}
                      size="small"
                      disabled={!editable}
                      placeholder="YYYY-MM-DD"
                    />
                  </Stack>
                );
              })}
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  label="Statehood date"
                  data-field="/facts/statehoodDate"
                  value={form.statehoodDate}
                  onChange={(event) => {
                    patch({ statehoodDate: event.target.value });
                  }}
                  size="small"
                  disabled={!editable}
                  placeholder="YYYY-MM-DD"
                  helperText="When the unit joined the entity above it."
                  sx={{ minWidth: 240 }}
                />
              </Stack>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                {locales.map((locale) => (
                  <TextField
                    key={`languages.${locale}`}
                    label={`Languages (${locale})`}
                    data-field={`/facts/languages/${locale}`}
                    value={form.languageRows[locale] ?? ""}
                    onChange={(event) => {
                      patch({
                        languageRows: {
                          ...form.languageRows,
                          [locale]: event.target.value,
                        },
                      });
                    }}
                    size="small"
                    disabled={!editable}
                    helperText="Comma-separated, in the same order in every locale."
                    sx={{ minWidth: 280 }}
                  />
                ))}
              </Stack>
            </Stack>
          </EditorTabPanel>

          <EditorTabPanel idPrefix="entity" tab="media" current={tab}>
            <EntityMedia
              draftId={draft}
              entityKey={detail.entity.key}
              slots={detail.assets}
              editable={editable}
              busy={busy}
              uploadError={uploadError}
              onUpload={upload}
              onDismissError={() => {
                setUploadError(null);
              }}
            />
          </EditorTabPanel>

          <EditorTabPanel idPrefix="entity" tab="usage" current={tab}>
            <DeckUsage draftId={draft} usages={detail.usages} />
          </EditorTabPanel>
        </CardContent>
      </Card>

      <StickyActionBar
        status={
          blocked
            ? "Fix the highlighted fields before saving."
            : editable
              ? dirty
                ? "Unsaved changes."
                : "Everything on this screen is saved."
              : "You are viewing this entity; editing needs the EDITOR role."
        }
        secondary={
          <>
            <Button
              variant="outlined"
              disabled={!editable || busy || !dirty}
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
            disabled={!editable || busy || blocked || !dirty}
            onClick={requestSave}
          >
            {busy ? "Saving…" : "Save entity"}
          </Button>
        }
      />

      <Dialog
        open={parentWarning}
        onClose={() => {
          setParentWarning(false);
        }}
      >
        <DialogTitle>Move a published subdivision?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {detail.entity.key} is already published under{" "}
            {detail.entity.parentKey ?? "no parent"}. Changing its parent
            rewrites the administrative relation the release carries, so decks,
            filters and progress that read it will follow the new country at the
            next publish.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setParentWarning(false);
            }}
          >
            Keep the parent
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              setParentWarning(false);
              save();
            }}
          >
            Move it to {form.parentKey}
          </Button>
        </DialogActions>
      </Dialog>

      {conflict !== null && (
        <ConflictDialog
          conflict={conflict}
          changes={entityChanges(baseline, form)}
          viewerId={identity?.id === undefined ? null : String(identity.id)}
          onClose={() => {
            setConflict(null);
          }}
          onReload={() => {
            setConflict(null);
            reportSave("idle");
            reseedFrom.current = detail;
            reload();
          }}
        />
      )}
    </Box>
  );
}

/**
 * The escape hatch §6.2 keeps behind a flag and the ADMIN role.
 *
 * A dotted path writes a field no form validates, which is exactly why it is
 * useful in an emergency and exactly why it is not part of ordinary editing.
 */
function AdvancedOverrides({
  form,
  editable,
  onChange,
}: {
  form: EntityForm;
  editable: boolean;
  onChange: (changes: Partial<EntityForm>) => void;
}) {
  return (
    <>
      <Divider />
      <Typography variant="subtitle2" component="h2">
        Advanced: raw overrides
      </Typography>
      <Alert severity="warning">
        A dotted path pins any merged field, with no schema behind it. It is
        here for what the typed fields cannot reach; everything else belongs in
        the tabs above.
      </Alert>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Path</TableCell>
            <TableCell>Value</TableCell>
            <TableCell width={56}>
              <Box component="span" sx={{ position: "absolute", left: -10000 }}>
                Remove
              </Box>
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {form.rawOverrides.map((row, index) => (
            <TableRow key={index}>
              <TableCell>
                <TextField
                  value={row.path}
                  label={`Override path ${String(index + 1)}`}
                  onChange={(event) => {
                    onChange({
                      rawOverrides: form.rawOverrides.map((entry, at) =>
                        at === index
                          ? { ...entry, path: event.target.value }
                          : entry,
                      ),
                    });
                  }}
                  size="small"
                  fullWidth
                  disabled={!editable}
                  placeholder="recognition.note.en"
                />
              </TableCell>
              <TableCell>
                <TextField
                  value={row.value}
                  label={`Override value ${String(index + 1)}`}
                  onChange={(event) => {
                    onChange({
                      rawOverrides: form.rawOverrides.map((entry, at) =>
                        at === index
                          ? { ...entry, value: event.target.value }
                          : entry,
                      ),
                    });
                  }}
                  size="small"
                  fullWidth
                  disabled={!editable}
                />
              </TableCell>
              <TableCell>
                {editable && (
                  <IconButton
                    size="small"
                    aria-label={`Remove override ${row.path === "" ? String(index + 1) : row.path}`}
                    onClick={() => {
                      onChange({
                        rawOverrides: form.rawOverrides.filter(
                          (_, at) => at !== index,
                        ),
                      });
                    }}
                  >
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editable && (
        <Box>
          <Button
            size="small"
            onClick={() => {
              onChange({
                rawOverrides: [...form.rawOverrides, { path: "", value: "" }],
              });
            }}
          >
            Add override
          </Button>
        </Box>
      )}
    </>
  );
}

/** Which cards and decks teach this entity, and how they deliver it. */
function DeckUsage({
  draftId,
  usages,
}: {
  draftId: string;
  usages: DraftEntityDetail["usages"];
}) {
  if (usages.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No deck teaches this entity yet. A deck that names it, or one that
        follows the catalog, is what puts it in front of a learner.
      </Typography>
    );
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>Deck</TableCell>
          <TableCell>Card</TableCell>
          <TableCell>Access</TableCell>
          <TableCell>Delivery</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {usages.map((usage) => (
          <TableRow key={usage.cardId}>
            <TableCell>
              <Link to={routes.draftDeck(draftId, usage.deckKey)}>
                {usage.deckName ?? usage.deckKey}
              </Link>
            </TableCell>
            <TableCell>
              <code>{usage.cardId}</code>
              {usage.isPreview && (
                <Chip size="small" sx={{ ml: 1 }} label="preview" />
              )}
            </TableCell>
            <TableCell>
              {usage.accessModel === "ENTITLEMENT" ? "Paid" : "Free"}
            </TableCell>
            <TableCell>
              {DELIVERY_LABEL[usage.delivery] ?? usage.delivery}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
