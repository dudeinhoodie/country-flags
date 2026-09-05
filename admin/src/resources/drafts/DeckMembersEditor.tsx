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
import Typography from "@mui/material/Typography";
import { useMemo, useState } from "react";
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
import { useDraftEntityPool } from "./useDraftDecks";
import type { DeckMembers, DraftEntityListItem } from "./useDraftDecks";

type MembersMode = "all-current" | "explicit" | "taxonomy";

const MAX_PREVIEW_CARDS = 3;

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

/** Whether the entity already carries the drawing this template shows. */
function hasAssetFor(
  entity: DraftEntityListItem | undefined,
  assetType: "FLAG" | "COAT_OF_ARMS" | null,
): boolean | undefined {
  if (entity === undefined) {
    return undefined;
  }
  if (assetType === "FLAG") {
    return entity.hasFlag;
  }
  if (assetType === "COAT_OF_ARMS") {
    return entity.hasCoatOfArms;
  }
  return true;
}

const UNITED_STATES_KEYS = new Set(["united-states", "usa", "us"]);

/**
 * The fifty states, as a click.
 *
 * `parentKey` is what says an administrative unit belongs to the United
 * States; a deployment whose entity list does not carry it yet is read from
 * the key instead, which is how the catalog names them.
 */
function isUnitedStatesSubdivision(entity: DraftEntityListItem): boolean {
  if (entity.type !== "subdivision") {
    return false;
  }
  // The catalog has spelled the country both ways over the years, and the
  // namespace in front of it is not part of the answer.
  const parent = (entity.parentKey ?? "").split(".").pop() ?? "";
  return (
    UNITED_STATES_KEYS.has(parent.replace(/_/gu, "-")) ||
    entity.key.startsWith("subdivision.us.")
  );
}

function nameOf(entity: DraftEntityListItem | undefined, key: string): string {
  return entity?.publishedName ?? key;
}

function MemberFilters({
  entities,
  assetsKnown,
  filters,
  onChange,
}: {
  entities: DraftEntityListItem[];
  assetsKnown: boolean;
  filters: MemberFilterState;
  onChange: (next: MemberFilterState) => void;
}) {
  const parents = useMemo(() => {
    const keys = new Set<string>();
    for (const entity of entities) {
      if (entity.parentKey !== null && entity.parentKey !== undefined) {
        keys.add(entity.parentKey);
      }
    }
    return [...keys].sort();
  }, [entities]);

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
      <TextField
        label="Search"
        value={filters.query}
        size="small"
        onChange={(event) =>
          onChange({ ...filters, query: event.target.value })
        }
        sx={{ minWidth: 180 }}
      />
      <TextField
        select
        label="Kind"
        value={filters.kind}
        size="small"
        onChange={(event) => onChange({ ...filters, kind: event.target.value })}
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
        select
        label="Parent"
        value={filters.parent}
        size="small"
        disabled={parents.length === 0}
        onChange={(event) =>
          onChange({ ...filters, parent: event.target.value })
        }
        sx={{ minWidth: 180 }}
        helperText={parents.length === 0 ? "No parents in this draft" : " "}
      >
        <MenuItem value="">Any parent</MenuItem>
        {parents.map((parent) => (
          <MenuItem key={parent} value={parent}>
            {parent}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        label="Asset"
        value={filters.asset}
        size="small"
        disabled={!assetsKnown}
        onChange={(event) =>
          onChange({
            ...filters,
            asset: event.target.value as MemberFilterState["asset"],
          })
        }
        sx={{ minWidth: 190 }}
        helperText={
          assetsKnown ? " " : "This draft does not report drawings yet"
        }
      >
        <MenuItem value="any">Any</MenuItem>
        <MenuItem value="present">Has the drawing</MenuItem>
        <MenuItem value="missing">Missing the drawing</MenuItem>
      </TextField>
      <TextField
        select
        label="Add as"
        value={filters.templateCode}
        size="small"
        onChange={(event) =>
          onChange({ ...filters, templateCode: event.target.value })
        }
        sx={{ minWidth: 200 }}
      >
        {CARD_TEMPLATES.map((template) => (
          <MenuItem key={template.code} value={template.code}>
            {template.label}
          </MenuItem>
        ))}
      </TextField>
    </Stack>
  );
}

interface MemberFilterState {
  query: string;
  kind: string;
  parent: string;
  asset: "any" | "present" | "missing";
  templateCode: string;
}

function ExplicitMembers({
  refs,
  defaults,
  previewCardIds,
  entities,
  entitiesError,
  disabled,
  onChange,
}: {
  refs: CardRef[];
  defaults: DeckDefaults;
  previewCardIds: string[];
  entities: DraftEntityListItem[] | null;
  entitiesError: string | null;
  disabled: boolean;
  /**
   * One patch rather than two callbacks: removing a starred member changes
   * the members and the previews together, and two calls against the same
   * captured value would leave the second one overwriting the first.
   */
  onChange: (patch: { refs?: CardRef[]; previewCardIds?: string[] }) => void;
}) {
  const [filters, setFilters] = useState<MemberFilterState>({
    query: "",
    kind: "",
    parent: "",
    asset: "any",
    templateCode: defaults.templateCode,
  });
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const pool = useMemo(() => entities ?? [], [entities]);
  const byKey = useMemo(
    () => new Map(pool.map((entity) => [entity.key, entity])),
    [pool],
  );
  const assetsKnown = pool.some(
    (entity) =>
      entity.hasFlag !== undefined || entity.hasCoatOfArms !== undefined,
  );
  const template = templateOf(filters.templateCode) ?? DEFAULT_TEMPLATE;
  const held = new Set(refs.map(cardIdentity));

  const candidates = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    return pool
      .filter((entity) => {
        if (filters.kind !== "" && entity.type !== filters.kind) {
          return false;
        }
        if (filters.parent !== "" && entity.parentKey !== filters.parent) {
          return false;
        }
        if (!template.subjectTypes.includes(entity.type)) {
          return false;
        }
        if (filters.asset !== "any") {
          const has = hasAssetFor(entity, template.assetType);
          if (has === undefined) {
            return false;
          }
          if (filters.asset === "present" ? !has : has) {
            return false;
          }
        }
        if (query.length === 0) {
          return true;
        }
        return (
          entity.key.toLowerCase().includes(query) ||
          (entity.publishedName ?? "").toLowerCase().includes(query)
        );
      })
      .slice(0, 60);
  }, [filters, pool, template]);

  const states = useMemo(() => pool.filter(isUnitedStatesSubdivision), [pool]);

  function add(entityKey: string): void {
    const ref: CardRef = {
      entityKey,
      templateCode: template.code,
      templateSchemaVersion: template.schemaVersion,
    };
    if (held.has(cardIdentity(ref))) {
      return;
    }
    onChange({ refs: [...refs, ref] });
  }

  function addAllStates(): void {
    const additions = states
      .map(
        (entity): CardRef => ({
          entityKey: entity.key,
          templateCode: template.code,
          templateSchemaVersion: template.schemaVersion,
        }),
      )
      .filter((ref) => !held.has(cardIdentity(ref)));
    if (additions.length > 0) {
      onChange({ refs: [...refs, ...additions] });
    }
  }

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
  }

  function remove(identity: string): void {
    onChange({
      refs: refs.filter((ref) => cardIdentity(ref) !== identity),
      previewCardIds: previewCardIds.filter((id) => id !== identity),
    });
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
    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
      <Box sx={{ flex: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Add cards
        </Typography>
        {entitiesError !== null && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {entitiesError}
          </Alert>
        )}
        <MemberFilters
          entities={pool}
          assetsKnown={assetsKnown}
          filters={filters}
          onChange={setFilters}
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "center" }}>
          <Button
            size="small"
            variant="outlined"
            disabled={disabled || states.length === 0}
            onClick={addAllStates}
          >
            Add the U.S. states ({states.length})
          </Button>
          <Typography variant="caption" color="text.secondary">
            as {templateLabel(template.code)}
          </Typography>
        </Stack>
        <List dense sx={{ maxHeight: 340, overflowY: "auto" }}>
          {candidates.map((entity) => {
            const identity = cardIdentity({
              entityKey: entity.key,
              templateCode: template.code,
              templateSchemaVersion: template.schemaVersion,
            });
            const drawing = hasAssetFor(entity, template.assetType);
            return (
              <ListItem
                key={entity.key}
                secondaryAction={
                  <Button
                    size="small"
                    aria-label={`Add ${identity}`}
                    disabled={disabled || held.has(identity)}
                    onClick={() => add(entity.key)}
                  >
                    Add
                  </Button>
                }
              >
                <ListItemText
                  primary={nameOf(entity, entity.key)}
                  secondary={
                    drawing === false
                      ? `${entity.key} — no ${template.assetType ?? "asset"} yet`
                      : entity.key
                  }
                />
              </ListItem>
            );
          })}
          {candidates.length === 0 && (
            <ListItem>
              <ListItemText secondary="Nothing matches these filters." />
            </ListItem>
          )}
        </List>
      </Box>

      <Box sx={{ flex: 1 }}>
        <Typography variant="subtitle2">
          In this deck ({refs.length})
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Drag a card, or use the arrows: this order is the deck's editorial
          order, and the release build keeps it.
        </Typography>
        <List dense sx={{ maxHeight: 380, overflowY: "auto" }}>
          {refs.map((ref, index) => {
            const identity = cardIdentity(ref);
            const entity = byKey.get(ref.entityKey);
            const drawing = hasAssetFor(
              entity,
              templateOf(ref.templateCode)?.assetType ?? null,
            );
            const isPreview = previewCardIds.includes(identity);
            return (
              <ListItem
                key={identity}
                draggable={!disabled}
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
                onDragEnd={() => setDragIndex(null)}
                sx={{ cursor: disabled ? "default" : "grab" }}
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <IconButton
                      size="small"
                      aria-label={`${isPreview ? "Unset" : "Set"} ${identity} as a preview card`}
                      disabled={
                        disabled ||
                        (!isPreview &&
                          previewCardIds.length >= MAX_PREVIEW_CARDS)
                      }
                      onClick={() => togglePreview(identity)}
                    >
                      {isPreview ? "★" : "☆"}
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move ${identity} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move ${identity} down`}
                      disabled={disabled || index === refs.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Remove ${identity}`}
                      disabled={disabled}
                      onClick={() => remove(identity)}
                    >
                      ×
                    </IconButton>
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
                      <span>{nameOf(entity, ref.entityKey)}</span>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={templateLabel(ref.templateCode)}
                      />
                      {drawing === false && (
                        <Chip size="small" color="warning" label="no drawing" />
                      )}
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
    </Stack>
  );
}

function PreviewCards({
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
    <Stack spacing={1}>
      <Typography variant="subtitle2">
        Public preview ({previewCardIds.length} of {MAX_PREVIEW_CARDS})
      </Typography>
      <Typography variant="caption" color="text.secondary">
        The cards a locked deck shows before it is bought, in this order. Each
        one is published as public on purpose; star a member above to add it.
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
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    <IconButton
                      size="small"
                      aria-label={`Move preview ${identity} up`}
                      disabled={disabled || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move preview ${identity} down`}
                      disabled={disabled || index === previewCardIds.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Remove preview ${identity}`}
                      disabled={disabled}
                      onClick={() =>
                        onChange(previewCardIds.filter((id) => id !== identity))
                      }
                    >
                      ×
                    </IconButton>
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

export function DeckMembersEditor({
  draftId,
  value,
  savedMemberCount,
  disabled,
  onChange,
}: {
  draftId: string;
  value: DeckMembership;
  savedMemberCount: number | null;
  disabled: boolean;
  onChange: (next: DeckMembership) => void;
}) {
  const { entities, error: entitiesError } = useDraftEntityPool(draftId);
  const mode = modeOf(value.members);
  const refs = membersToRefs(value.members, value.defaults);

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
          onChange={(event) => setDefaults(event.target.value)}
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
          onChange={(event) =>
            onChange({ ...value, members: { taxonomy: event.target.value } })
          }
          sx={{ maxWidth: 420 }}
        />
      )}

      {mode === "explicit" && (
        <ExplicitMembers
          refs={refs}
          defaults={value.defaults}
          previewCardIds={value.previewCardIds}
          entities={entities}
          entitiesError={entitiesError}
          disabled={disabled}
          onChange={applyPatch}
        />
      )}

      <PreviewCards
        previewCardIds={value.previewCardIds}
        refs={refs}
        entities={entities}
        curated={mode === "explicit"}
        disabled={disabled}
        onChange={(previewCardIds) => onChange({ ...value, previewCardIds })}
      />
    </Stack>
  );
}
