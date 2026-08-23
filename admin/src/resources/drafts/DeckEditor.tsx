import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useNavigate, useParams } from "react-router-dom";
import { DeckMembersEditor } from "./DeckMembersEditor";
import {
  useDeckWriter,
  useDraftDeck,
  useDraftWithDecks,
} from "./useDraftDecks";
import type { DeckMembers } from "./useDraftDecks";

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

function canEdit(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
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

  const [key, setKey] = useState("");
  const [kind, setKind] = useState<"curated" | "taxonomy">("curated");
  const [names, setNames] =
    useState<Record<string, LocalizedText>>(emptyNames());
  const [members, setMembers] = useState<DeckMembers>("all-current");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The loaded deck seeds the form once; deriving during render instead
  // would fight the editor's own state on every keystroke.
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (deck !== null && seededKey !== deck.key) {
    setSeededKey(deck.key);
    setKey(deck.key);
    setKind(deck.kind);
    setNames({ ...emptyNames(), ...deck.names });
    setMembers(deck.members);
  }

  if (draftError !== null || deckError !== null) {
    return <Alert severity="error">{draftError ?? deckError}</Alert>;
  }
  if (draft === null || (!isNew && deck === null)) {
    return <Typography color="text.secondary">Loading the deck…</Typography>;
  }

  function save(): void {
    if (draft === null) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    const done = (): void => {
      setSaving(false);
      void navigate(`/drafts/${draft.id}`);
    };
    const failed = (cause: unknown): void => {
      setSaving(false);
      setSaveError(
        cause instanceof Error ? cause.message : "The deck could not be saved",
      );
    };
    if (isNew) {
      void create(draft.revision, { key, kind, names, members }).then(
        done,
        failed,
      );
      return;
    }
    if (deck === null) {
      return;
    }
    void update(draft.revision, deck.key, { kind, names, members }).then(
      done,
      failed,
    );
  }

  return (
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
            members={members}
            memberCount={deck?.memberCount ?? null}
            disabled={!editable}
            onChange={setMembers}
          />

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              disabled={!editable || saving}
              onClick={save}
            >
              {isNew ? "Create deck" : "Save deck"}
            </Button>
            <Button
              onClick={() => {
                void navigate(`/drafts/${draft.id}`);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
