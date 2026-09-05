import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useNavigate, useParams } from "react-router-dom";
import { useRefreshDrafts } from "../../app/CurrentDraftContext";
import { routes } from "../../app/routes";
import { useReportSaveStatus } from "../../app/SaveStatusContext";
import { LoadingState } from "../../components/LoadingState";
import { StickyActionBar } from "../../components/StickyActionBar";
import { DEFAULT_TEMPLATE, deckCodeFromKey, templateOf } from "./deck-cards";
import { DeckAccessEditor } from "./DeckAccessEditor";
import type { DeckAccessValue, PublishedAccess } from "./DeckAccessEditor";
import { DeckMembersEditor } from "./DeckMembersEditor";
import type { DeckMembership } from "./DeckMembersEditor";
import {
  useCommerceContour,
  useDeckWriter,
  useDraftDeck,
  usePublishedDeckCodes,
  useDraftWithDecks,
} from "./useDraftDecks";
import type { DeckCardFields, DraftDeckDetail } from "./useDraftDecks";

interface LocalizedText {
  name: string;
  description: string;
}

const LOCALES = ["ru", "en"] as const;

function emptyNames(): Record<string, LocalizedText> {
  return {
    ru: { name: "", description: "" },
    en: { name: "", description: "" },
  };
}

function emptyMembership(): DeckMembership {
  return {
    members: "all-current",
    defaults: {
      templateCode: DEFAULT_TEMPLATE.code,
      templateSchemaVersion: DEFAULT_TEMPLATE.schemaVersion,
    },
    previewCardIds: [],
  };
}

function membershipOf(deck: DraftDeckDetail): DeckMembership {
  const template =
    templateOf(deck.defaultTemplateCode ?? "") ?? DEFAULT_TEMPLATE;
  return {
    members: deck.members,
    defaults: {
      templateCode: template.code,
      templateSchemaVersion:
        deck.defaultTemplateSchemaVersion ?? template.schemaVersion,
    },
    previewCardIds: deck.previewCardIds ?? [],
  };
}

function accessOf(deck: DraftDeckDetail | null): DeckAccessValue {
  return {
    model: deck?.access?.model ?? "FREE",
    requiredEntitlementKey: deck?.access?.requiredEntitlementKey ?? "",
  };
}

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
  return deck.access?.model === "ENTITLEMENT" ? "paid" : "free";
}

export function DeckEditor() {
  const { draftId, deckKey } = useParams();
  const isNew = deckKey === undefined || deckKey === "new";
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const editable = canEdit(permissions);

  const { draft, error: draftError } = useDraftWithDecks(draftId ?? "");
  const { deck, error: deckError } = useDraftDeck(
    draftId ?? "",
    isNew ? undefined : deckKey,
  );
  const { create, update } = useDeckWriter(draftId ?? "");
  const publishedCodes = usePublishedDeckCodes();
  const contour = useCommerceContour();

  const [key, setKey] = useState("");
  const [kind, setKind] = useState<"curated" | "taxonomy">("curated");
  const [names, setNames] =
    useState<Record<string, LocalizedText>>(emptyNames());
  const [membership, setMembership] =
    useState<DeckMembership>(emptyMembership());
  const [access, setAccess] = useState<DeckAccessValue>(accessOf(null));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reportSave = useReportSaveStatus();
  const refreshDrafts = useRefreshDrafts();

  // The loaded deck seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (deck !== null && seededKey !== deck.key) {
    setSeededKey(deck.key);
    setKey(deck.key);
    setKind(deck.kind);
    setNames({ ...emptyNames(), ...deck.names });
    setMembership(membershipOf(deck));
    setAccess(accessOf(deck));
  }

  if (draftError !== null || deckError !== null) {
    return <Alert severity="error">{draftError ?? deckError}</Alert>;
  }
  if (draft === null || (!isNew && deck === null)) {
    return <LoadingState label="Loading the deck…" />;
  }

  const published = publishedAccessOf(deck, publishedCodes);

  function cardFields(): DeckCardFields {
    return {
      defaultTemplateCode: membership.defaults.templateCode,
      defaultTemplateSchemaVersion: membership.defaults.templateSchemaVersion,
      access:
        access.model === "ENTITLEMENT"
          ? {
              model: "ENTITLEMENT",
              requiredEntitlementKey: access.requiredEntitlementKey.trim(),
            }
          : { model: "FREE" },
      previewCardIds: membership.previewCardIds,
    };
  }

  function save(): void {
    if (draft === null) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    reportSave("saving");
    const done = (): void => {
      setSaving(false);
      reportSave("saved");
      // The shell shows when the draft was last written; a save it did not
      // hear about would leave that reading stale.
      refreshDrafts();
      void navigate(routes.draftDecks(draft.id));
    };
    const failed = (cause: unknown): void => {
      setSaving(false);
      const message =
        cause instanceof Error ? cause.message : "The deck could not be saved";
      setSaveError(message);
      reportSave("error", message);
    };
    if (isNew) {
      void create(draft.revision, {
        key,
        kind,
        names,
        members: membership.members,
        ...cardFields(),
      }).then(done, failed);
      return;
    }
    if (deck === null) {
      return;
    }
    void update(draft.revision, deck.key, {
      kind,
      names,
      members: membership.members,
      ...cardFields(),
    }).then(done, failed);
  }

  return (
    <>
      <Card sx={{ mt: 2 }}>
        <Title title={isNew ? "New deck" : `Deck ${key}`} />
        <CardContent>
          <Stack spacing={3}>
            {!editable && (
              <Alert severity="info">
                You are viewing this deck. Editing needs the EDITOR role.
              </Alert>
            )}
            {saveError !== null && <Alert severity="error">{saveError}</Alert>}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                size="small"
                disabled={!isNew || !editable}
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
                value={kind}
                size="small"
                disabled={!editable}
                onChange={(event) =>
                  setKind(event.target.value as "curated" | "taxonomy")
                }
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="curated">Curated</MenuItem>
                <MenuItem value="taxonomy">Taxonomy</MenuItem>
              </TextField>
            </Stack>

            {LOCALES.map((locale) => (
              <Stack key={locale} spacing={1}>
                <Typography variant="subtitle2">
                  {locale.toUpperCase()}
                </Typography>
                <TextField
                  label="Name"
                  value={names[locale]?.name ?? ""}
                  size="small"
                  disabled={!editable}
                  onChange={(event) =>
                    setNames({
                      ...names,
                      [locale]: {
                        name: event.target.value,
                        description: names[locale]?.description ?? "",
                      },
                    })
                  }
                />
                <TextField
                  label="Description"
                  value={names[locale]?.description ?? ""}
                  size="small"
                  multiline
                  minRows={2}
                  disabled={!editable}
                  onChange={(event) =>
                    setNames({
                      ...names,
                      [locale]: {
                        name: names[locale]?.name ?? "",
                        description: event.target.value,
                      },
                    })
                  }
                />
              </Stack>
            ))}

            <DeckMembersEditor
              draftId={draft.id}
              value={membership}
              savedMemberCount={deck?.memberCount ?? null}
              disabled={!editable}
              onChange={setMembership}
            />

            <Divider />

            <DeckAccessEditor
              value={access}
              published={published}
              contour={contour}
              disabled={!editable}
              onChange={setAccess}
            />
          </Stack>
        </CardContent>
      </Card>

      <StickyActionBar
        status={
          editable
            ? undefined
            : "You are viewing this deck; editing needs the EDITOR role."
        }
        secondary={
          <Button
            variant="outlined"
            onClick={() => {
              void navigate(routes.draftDecks(draft.id));
            }}
            disabled={saving}
          >
            Cancel
          </Button>
        }
        primary={
          <Button
            variant="contained"
            disabled={!editable || saving}
            onClick={save}
          >
            {saving ? "Saving\u2026" : isNew ? "Create deck" : "Save deck"}
          </Button>
        }
      />
    </>
  );
}
