import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpwardOutlined";
import CloseIcon from "@mui/icons-material/CloseOutlined";
import StarIcon from "@mui/icons-material/StarOutlined";
import StarBorderIcon from "@mui/icons-material/StarBorderOutlined";
import { visuallyHidden } from "@mui/utils";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CARD_TEMPLATES,
  cardIdentity,
  DEFAULT_TEMPLATE,
  membersToRefs,
  refsToMembers,
  templateLabel,
  templateOf,
} from "./deck-cards";
import type { CardRef, DeckDefaults, EntityType } from "./deck-cards";
import { EMPTY_CANDIDATE_QUERY, useCardCandidates } from "./useDraftDecks";
import type {
  CandidateQuery,
  CardCandidate,
  DeckMembers,
  DraftEntityListItem,
} from "./useDraftDecks";

type MembersMode = "all-current" | "explicit" | "taxonomy";

export const MAX_PREVIEW_CARDS = 3;

const ENTITY_TYPES: readonly EntityType[] = [
  "country",
  "territory",
  "area",
  "subdivision",
  "region",
  "subregion",
];

export interface DeckMembership {
  members: DeckMembers;
  defaults: DeckDefaults;
  previewCardIds: string[];
}

export function modeOf(members: DeckMembers): MembersMode {
  if (members === "all-current") {
    return "all-current";
  }
  return Array.isArray(members) ? "explicit" : "taxonomy";
}

function nameOf(entity: DraftEntityListItem | undefined, key: string): string {
  return entity?.publishedName ?? key;
}

/**
 * Which cards the deck holds, and in what order (§8.2).
 *
 * The library on the left is searched on the server: which entity/template
 * pairs exist, which are ready, and why a row cannot be added are projection
 * rules, and a browser deciding them from a list of entities would be a
 * second implementation of the same rules quietly drifting from the first
 * (§12). Every unavailable row says why, so a greyed-out line is
 * instructions rather than a dead end.
 *
 * The order on the right is the deck's editorial order and the release build
 * keeps it. Dragging is a convenience; the arrows are the interface, and
 * they keep focus on the card they moved so a whole deck can be arranged
 * without a mouse (§11).
 */

interface CardLibraryProps {
  draftId: string;
  deckKey: string | undefined;
  defaults: DeckDefaults;
  held: ReadonlySet<string>;
  disabled: boolean;
  onAdd: (refs: CardRef[]) => void;
}

function CardLibrary({
  draftId,
  deckKey,
  defaults,
  held,
  disabled,
  onAdd,
}: CardLibraryProps) {
  const [query, setQuery] = useState<CandidateQuery>({
    ...EMPTY_CANDIDATE_QUERY,
    templateCode: defaults.templateCode,
  });
  const { candidates, total, error } = useCardCandidates(
    draftId,
    deckKey,
    query,
  );

  const addable = (candidates ?? []).filter(
    (candidate) => candidate.available && !held.has(candidate.cardId),
  );

  function refOf(candidate: CardCandidate): CardRef {
    return {
      entityKey: candidate.entityKey,
      templateCode: candidate.templateCode,
      templateSchemaVersion: candidate.templateSchemaVersion,
    };
  }

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
        Card library
      </Typography>
      {error !== null && (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {error}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
        <TextField
          label="Search"
          value={query.search}
          size="small"
          onChange={(event) => {
            setQuery({ ...query, search: event.target.value });
          }}
          helperText="Matched against the key and the published name"
          sx={{ minWidth: 200 }}
        />
        <TextField
          select
          label="Kind"
          value={query.entityType}
          size="small"
          onChange={(event) => {
            setQuery({ ...query, entityType: event.target.value });
          }}
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">Any kind</MenuItem>
          {ENTITY_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Parent"
          value={query.parentKey}
          size="small"
          onChange={(event) => {
            setQuery({ ...query, parentKey: event.target.value });
          }}
          helperText="The country a subdivision belongs to"
          sx={{ minWidth: 200 }}
        />
        <TextField
          select
          label="Readiness"
          value={query.readiness}
          size="small"
          onChange={(event) => {
            setQuery({
              ...query,
              readiness: event.target.value as CandidateQuery["readiness"],
            });
          }}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="any">Any</MenuItem>
          <MenuItem value="ready">Ready to teach</MenuItem>
          <MenuItem value="blocked">Blocked</MenuItem>
        </TextField>
        <TextField
          select
          label="Add as"
          value={query.templateCode}
          size="small"
          onChange={(event) => {
            setQuery({ ...query, templateCode: event.target.value });
          }}
          sx={{ minWidth: 200 }}
        >
          {CARD_TEMPLATES.map((template) => (
            <MenuItem key={template.code} value={template.code}>
              {template.label}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      {/* A bulk recipe over what the filters already say, rather than a
          hard-coded list of countries: `U.S. states` is kind=subdivision
          under a parent, and so is every recipe anybody will want next. */}
      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled || addable.length === 0}
          onClick={() => {
            onAdd(addable.map(refOf));
          }}
        >
          {`Add all ${String(addable.length)} matching`}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {candidates === null
            ? "Searching…"
            : `${String(total)} ${total === 1 ? "candidate" : "candidates"} matched`}
        </Typography>
      </Stack>

      <List dense sx={{ maxHeight: 340, overflowY: "auto" }}>
        {(candidates ?? []).map((candidate) => {
          const alreadyHeld = held.has(candidate.cardId);
          // The reason a row cannot be added is what turns a greyed-out line
          // into instructions; the server writes it, except for a card this
          // unsaved form has already picked up.
          const reason = alreadyHeld
            ? "This deck already holds the card"
            : (candidate.disabledReason?.message ?? null);
          return (
            <ListItem
              key={candidate.cardId}
              secondaryAction={
                <Button
                  size="small"
                  aria-label={`Add ${candidate.cardId}`}
                  disabled={disabled || alreadyHeld || !candidate.available}
                  onClick={() => {
                    onAdd([refOf(candidate)]);
                  }}
                >
                  Add
                </Button>
              }
            >
              <ListItemText
                primary={candidate.entityName ?? candidate.entityKey}
                secondary={
                  reason === null
                    ? `${candidate.entityKey} · ${templateLabel(candidate.templateCode)}`
                    : `${candidate.entityKey} — ${reason}`
                }
              />
            </ListItem>
          );
        })}
        {candidates !== null && candidates.length === 0 && (
          <ListItem>
            <ListItemText secondary="Nothing matches these filters." />
          </ListItem>
        )}
        {candidates === null && (
          <ListItem>
            <ListItemText secondary="Reading the card library…" />
          </ListItem>
        )}
      </List>
    </Box>
  );
}

/** Where focus goes after a card is moved, so the keyboard keeps its place. */
interface PendingFocus {
  cardId: string;
  direction: "up" | "down";
}

function MemberList({
  refs,
  previewCardIds,
  entities,
  disabled,
  onChange,
}: {
  refs: CardRef[];
  previewCardIds: string[];
  entities: DraftEntityListItem[] | null;
  disabled: boolean;
  /**
   * One patch rather than two callbacks: removing a starred member changes
   * the members and the previews together, and two calls against the same
   * captured value would leave the second one overwriting the first.
   */
  onChange: (patch: { refs?: CardRef[]; previewCardIds?: string[] }) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pending, setPending] = useState<PendingFocus | null>(null);
  const list = useRef<HTMLUListElement | null>(null);
  const byKey = useMemo(
    () => new Map((entities ?? []).map((entity) => [entity.key, entity])),
    [entities],
  );

  // The button that moved a card may now be at an end and disabled, so focus
  // falls back to the other arrow on the same card: a keyboard reader must
  // never be thrown back to the top of the document mid-sort (§11).
  useEffect(() => {
    if (pending === null || list.current === null) {
      return;
    }
    const escaped = CSS.escape(pending.cardId);
    const wanted = list.current.querySelector<HTMLButtonElement>(
      `[data-move="${pending.direction}"][data-card="${escaped}"]`,
    );
    const other = list.current.querySelector<HTMLButtonElement>(
      `[data-move="${pending.direction === "up" ? "down" : "up"}"][data-card="${escaped}"]`,
    );
    (wanted?.disabled === false ? wanted : other)?.focus();
    setPending(null);
  }, [pending, refs]);

  function move(from: number, to: number): void {
    if (to < 0 || to >= refs.length || from === to) {
      return;
    }
    const moved = refs[from];
    if (moved === undefined) {
      return;
    }
    const next = [...refs];
    next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange({ refs: next });
    const identity = cardIdentity(moved);
    setPending({ cardId: identity, direction: to < from ? "up" : "down" });
    setAnnouncement(
      `${identity} moved to position ${String(to + 1)} of ${String(refs.length)}`,
    );
  }

  function remove(identity: string): void {
    onChange({
      refs: refs.filter((ref) => cardIdentity(ref) !== identity),
      previewCardIds: previewCardIds.filter((id) => id !== identity),
    });
    setAnnouncement(`${identity} removed from the deck`);
  }

  function togglePreview(identity: string): void {
    if (previewCardIds.includes(identity)) {
      onChange({
        previewCardIds: previewCardIds.filter((id) => id !== identity),
      });
      return;
    }
    if (previewCardIds.length >= MAX_PREVIEW_CARDS) {
      return;
    }
    onChange({ previewCardIds: [...previewCardIds, identity] });
  }

  return (
    <Box sx={{ flex: 1, minWidth: 0 }} data-field="/members">
      <Typography variant="subtitle2" component="h3">
        In this deck ({refs.length})
      </Typography>
      <Typography variant="caption" color="text.secondary">
        This order is the deck&apos;s editorial order, and the release build
        keeps it. Drag a card, use the arrows, or hold Alt and press the up and
        down arrow keys.
      </Typography>
      {/* Focus alone does not say what happened; the move is announced. */}
      <Box aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
      <List dense sx={{ maxHeight: 380, overflowY: "auto" }} ref={list}>
        {refs.map((ref, index) => {
          const identity = cardIdentity(ref);
          const entity = byKey.get(ref.entityKey);
          const isPreview = previewCardIds.includes(identity);
          return (
            <ListItem
              key={identity}
              data-field={`/members/${String(index)}`}
              draggable={!disabled}
              aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              onKeyDown={(event) => {
                if (!event.altKey || disabled) {
                  return;
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(index, index - 1);
                }
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(index, index + 1);
                }
              }}
              onDragStart={(event) => {
                setDragIndex(index);
                // Firefox refuses to start a drag with an empty payload.
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", identity);
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== null) {
                  move(dragIndex, index);
                }
                setDragIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
              }}
              sx={{ cursor: disabled ? "default" : "grab" }}
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <IconAction
                    label={`${isPreview ? "Unset" : "Set"} ${identity} as a preview card`}
                    disabled={
                      disabled ||
                      (!isPreview && previewCardIds.length >= MAX_PREVIEW_CARDS)
                    }
                    onClick={() => {
                      togglePreview(identity);
                    }}
                  >
                    {isPreview ? (
                      <StarIcon fontSize="small" />
                    ) : (
                      <StarBorderIcon fontSize="small" />
                    )}
                  </IconAction>
                  <IconAction
                    label={`Move ${identity} up`}
                    disabled={disabled || index === 0}
                    data-move="up"
                    data-card={identity}
                    onClick={() => {
                      move(index, index - 1);
                    }}
                  >
                    <ArrowUpwardIcon fontSize="small" />
                  </IconAction>
                  <IconAction
                    label={`Move ${identity} down`}
                    disabled={disabled || index === refs.length - 1}
                    data-move="down"
                    data-card={identity}
                    onClick={() => {
                      move(index, index + 1);
                    }}
                  >
                    <ArrowDownwardIcon fontSize="small" />
                  </IconAction>
                  <IconAction
                    label={`Remove ${identity}`}
                    disabled={disabled}
                    onClick={() => {
                      remove(identity);
                    }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconAction>
                </Stack>
              }
            >
              <ListItemText
                primary={
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: "center" }}
                  >
                    <span>{`${String(index + 1)}. ${nameOf(entity, ref.entityKey)}`}</span>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={templateLabel(ref.templateCode)}
                    />
                  </Stack>
                }
                secondary={ref.entityKey}
              />
            </ListItem>
          );
        })}
        {refs.length === 0 && (
          <ListItem>
            <ListItemText secondary="This deck holds nothing yet." />
          </ListItem>
        )}
      </List>
    </Box>
  );
}

/**
 * An icon-only control, always with a name (§11).
 *
 * The tooltip is for the eye and the label is for everything else; a button
 * that is only a glyph is unusable to half the people who have to use it.
 */
function IconAction({
  label,
  disabled,
  onClick,
  children,
  ...rest
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          {...rest}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/** The cards a locked deck shows before it is bought (§8.3). */
export function PreviewCards({
  previewCardIds,
  refs,
  entities,
  curated,
  disabled,
  onChange,
}: {
  previewCardIds: string[];
  refs: CardRef[];
  entities: DraftEntityListItem[] | null;
  /** Whether the deck lists its members, so a preview can be checked here. */
  curated: boolean;
  disabled: boolean;
  onChange: (next: string[]) => void;
}) {
  const byKey = useMemo(
    () => new Map((entities ?? []).map((entity) => [entity.key, entity])),
    [entities],
  );
  const byIdentity = new Map(refs.map((ref) => [cardIdentity(ref), ref]));

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= previewCardIds.length) {
      return;
    }
    const moved = previewCardIds[index];
    if (moved === undefined) {
      return;
    }
    const next = [...previewCardIds];
    next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <Stack spacing={1} data-field="/previewCardIds">
      <Typography variant="subtitle2" component="h3">
        Public preview ({previewCardIds.length} of {MAX_PREVIEW_CARDS})
      </Typography>
      <Typography variant="caption" color="text.secondary">
        The cards a locked deck shows before it is bought, in this order. Each
        one is published as public on purpose; star a member on the Cards tab to
        add it.
      </Typography>
      {previewCardIds.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nothing is shown before the deck is bought.
        </Typography>
      ) : (
        <List dense>
          {previewCardIds.map((identity, index) => {
            const ref = byIdentity.get(identity);
            return (
              <ListItem
                key={identity}
                data-field={`/previewCardIds/${String(index)}`}
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <IconAction
                      label={`Move preview ${identity} up`}
                      disabled={disabled || index === 0}
                      onClick={() => {
                        move(index, -1);
                      }}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconAction>
                    <IconAction
                      label={`Move preview ${identity} down`}
                      disabled={disabled || index === previewCardIds.length - 1}
                      onClick={() => {
                        move(index, 1);
                      }}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconAction>
                    <IconAction
                      label={`Remove preview ${identity}`}
                      disabled={disabled}
                      onClick={() => {
                        onChange(
                          previewCardIds.filter((id) => id !== identity),
                        );
                      }}
                    >
                      <CloseIcon fontSize="small" />
                    </IconAction>
                  </Stack>
                }
              >
                <ListItemText
                  primary={`${String(index + 1)}. ${nameOf(
                    ref === undefined ? undefined : byKey.get(ref.entityKey),
                    ref?.entityKey ?? identity,
                  )}`}
                  secondary={
                    ref === undefined
                      ? curated
                        ? `${identity} — the deck no longer holds this card`
                        : identity
                      : templateLabel(ref.templateCode)
                  }
                />
              </ListItem>
            );
          })}
        </List>
      )}
      {curated &&
        previewCardIds.some((identity) => !byIdentity.has(identity)) && (
          <Alert severity="warning">
            A preview must be a card the deck holds. Remove the ones the deck no
            longer carries, or the release will refuse to publish.
          </Alert>
        )}
    </Stack>
  );
}

/** Everything the Cards tab holds: how membership is decided, and by whom. */
export function DeckMembersEditor({
  draftId,
  deckKey,
  entities,
  value,
  savedMemberCount,
  disabled,
  onChange,
}: {
  draftId: string;
  deckKey: string | undefined;
  /** The draft's entities, read once by the editor and shared with the tabs. */
  entities: DraftEntityListItem[] | null;
  value: DeckMembership;
  savedMemberCount: number | null;
  disabled: boolean;
  onChange: (next: DeckMembership) => void;
}) {
  const mode = modeOf(value.members);
  const refs = membersToRefs(value.members, value.defaults);
  const held = new Set(refs.map(cardIdentity));

  function setDefaults(templateCode: string): void {
    const template = templateOf(templateCode) ?? DEFAULT_TEMPLATE;
    const defaults: DeckDefaults = {
      templateCode: template.code,
      templateSchemaVersion: template.schemaVersion,
    };
    // The members keep the cards they were: what changes is only how a bare
    // key is read, so they are rewritten against the new default.
    onChange({
      ...value,
      defaults,
      members: Array.isArray(value.members)
        ? refsToMembers(refs, defaults)
        : value.members,
    });
  }

  /** Members and previews move together, in one update of the value. */
  function applyPatch(patch: {
    refs?: CardRef[];
    previewCardIds?: string[];
  }): void {
    onChange({
      ...value,
      ...(patch.refs === undefined
        ? {}
        : { members: refsToMembers(patch.refs, value.defaults) }),
      ...(patch.previewCardIds === undefined
        ? {}
        : { previewCardIds: patch.previewCardIds }),
    });
  }

  return (
    <Stack spacing={2}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 1 }}
      >
        <TextField
          select
          label="Membership"
          value={mode}
          size="small"
          disabled={disabled}
          sx={{ minWidth: 220 }}
          onChange={(event) => {
            const next = event.target.value as MembersMode;
            if (next === "all-current") {
              onChange({ ...value, members: "all-current" });
            } else if (next === "explicit") {
              onChange({
                ...value,
                members: refsToMembers(refs, value.defaults),
              });
            } else {
              onChange({ ...value, members: { taxonomy: "" } });
            }
          }}
        >
          <MenuItem value="all-current">All current countries</MenuItem>
          <MenuItem value="explicit">A chosen list</MenuItem>
          <MenuItem value="taxonomy">Everything under a taxonomy node</MenuItem>
        </TextField>
        <TextField
          select
          label="Default template"
          value={value.defaults.templateCode}
          size="small"
          disabled={disabled}
          sx={{ minWidth: 220 }}
          helperText="What a member with no template of its own teaches"
          onChange={(event) => {
            setDefaults(event.target.value);
          }}
        >
          {CARD_TEMPLATES.map((template) => (
            <MenuItem key={template.code} value={template.code}>
              {template.label}
            </MenuItem>
          ))}
        </TextField>
        <Chip
          label={
            mode === "explicit"
              ? `resolves to ${String(refs.length)} cards`
              : `resolved to ${String(savedMemberCount ?? 0)} cards when saved`
          }
          size="small"
        />
      </Stack>

      {mode === "all-current" && (
        <Alert severity="info">
          This deck follows the catalog: every approved, current country joins
          it automatically, now and after future releases, taught through the
          default template.
        </Alert>
      )}

      {mode === "taxonomy" && (
        <TextField
          label="Taxonomy node"
          helperText="For example region.europe — every entity classified under it, at any depth, joins the deck."
          value={
            typeof value.members === "object" && !Array.isArray(value.members)
              ? value.members.taxonomy
              : ""
          }
          size="small"
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...value, members: { taxonomy: event.target.value } });
          }}
          sx={{ maxWidth: 420 }}
        />
      )}

      {mode === "explicit" && (
        <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
          <CardLibrary
            draftId={draftId}
            deckKey={deckKey}
            defaults={value.defaults}
            held={held}
            disabled={disabled}
            onAdd={(added) => {
              const fresh = added.filter((ref) => !held.has(cardIdentity(ref)));
              if (fresh.length > 0) {
                applyPatch({ refs: [...refs, ...fresh] });
              }
            }}
          />
          <MemberList
            refs={refs}
            previewCardIds={value.previewCardIds}
            entities={entities}
            disabled={disabled}
            onChange={applyPatch}
          />
        </Stack>
      )}
    </Stack>
  );
}
