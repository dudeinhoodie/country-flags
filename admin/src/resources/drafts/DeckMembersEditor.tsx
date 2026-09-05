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
import { useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { DeckMembers } from "./useDraftDecks";

type MembersMode = "all-current" | "explicit" | "taxonomy";

interface EntityOption {
  contentKey: string;
  label: string;
}

export function modeOf(members: DeckMembers): MembersMode {
  if (members === "all-current") {
    return "all-current";
  }
  return Array.isArray(members) ? "explicit" : "taxonomy";
}

function useEntitySearch(query: string): EntityOption[] {
  const client = useAdminApiClient();
  const [options, setOptions] = useState<EntityOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      client
        .GET("/v1/admin/content/entities", {
          params: {
            query: {
              limit: 20,
              ...(query.trim().length > 0 ? { q: query.trim() } : {}),
            },
          },
        })
        .then(({ data }) => {
          if (cancelled || data === undefined) {
            return;
          }
          setOptions(
            data.items.map((item) => ({
              contentKey: item.contentKey,
              label: item.nameRu ?? item.nameEn ?? item.slug,
            })),
          );
        })
        .catch(() => {
          // Search is an aid, not the gate: the server validates members.
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [client, query]);

  return options;
}

function ExplicitMembers({
  members,
  onChange,
}: {
  members: string[];
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const options = useEntitySearch(query);
  const chosen = new Set(members);

  function move(index: number, delta: number): void {
    const target = index + delta;
    if (target < 0 || target >= members.length) {
      return;
    }
    const moved = members[index];
    if (moved === undefined) {
      return;
    }
    const next = [...members];
    next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
      <Box sx={{ flex: 1 }}>
        <TextField
          label="Find a country"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          size="small"
          fullWidth
        />
        <List dense sx={{ maxHeight: 320, overflowY: "auto" }}>
          {options.map((option) => (
            <ListItem
              key={option.contentKey}
              secondaryAction={
                <Button
                  size="small"
                  disabled={chosen.has(option.contentKey)}
                  onClick={() => onChange([...members, option.contentKey])}
                >
                  Add
                </Button>
              }
            >
              <ListItemText
                primary={option.label}
                secondary={option.contentKey}
              />
            </ListItem>
          ))}
        </List>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Typography variant="subtitle2">
          In this deck ({members.length})
        </Typography>
        <Typography variant="caption" color="text.secondary">
          The release build sorts members by key, so this order is editorial
          bookkeeping rather than the order learners will see.
        </Typography>
        <List dense sx={{ maxHeight: 320, overflowY: "auto" }}>
          {members.map((key, index) => (
            <ListItem
              key={key}
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    size="small"
                    aria-label={`Move ${key} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Move ${key} down`}
                    disabled={index === members.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    size="small"
                    aria-label={`Remove ${key}`}
                    onClick={() =>
                      onChange(members.filter((entry) => entry !== key))
                    }
                  >
                    ×
                  </IconButton>
                </Stack>
              }
            >
              <ListItemText primary={key} />
            </ListItem>
          ))}
        </List>
      </Box>
    </Stack>
  );
}

export function DeckMembersEditor({
  members,
  memberCount,
  disabled,
  onChange,
}: {
  members: DeckMembers;
  memberCount: number | null;
  disabled: boolean;
  onChange: (next: DeckMembers) => void;
}) {
  const mode = modeOf(members);
  // A member is a card variant now, and it may be written as a bare entity
  // key or spelled out with its template. This editor speaks the first
  // shape; the second stays readable rather than being flattened into
  // something it is not (#319).
  const explicitMembers = Array.isArray(members) ? members : [];
  const entityKeys = explicitMembers.filter(
    (member): member is string => typeof member === "string",
  );
  const cardRefCount = explicitMembers.length - entityKeys.length;

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
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
              onChange("all-current");
            } else if (next === "explicit") {
              onChange(explicitMembers);
            } else {
              onChange({ taxonomy: "" });
            }
          }}
        >
          <MenuItem value="all-current">All current countries</MenuItem>
          <MenuItem value="explicit">A chosen list</MenuItem>
          <MenuItem value="taxonomy">Everything under a taxonomy node</MenuItem>
        </TextField>
        {memberCount !== null && (
          <Chip
            label={`resolves to ${String(memberCount)} countries`}
            size="small"
          />
        )}
      </Stack>

      {mode === "all-current" && (
        <Alert severity="info">
          This deck follows the catalog: every approved, current country joins
          it automatically, now and after future releases.
        </Alert>
      )}

      {mode === "taxonomy" && (
        <TextField
          label="Taxonomy node"
          helperText="For example region.europe — every entity classified under it, at any depth, joins the deck."
          value={
            typeof members === "object" && !Array.isArray(members)
              ? members.taxonomy
              : ""
          }
          size="small"
          disabled={disabled}
          onChange={(event) => onChange({ taxonomy: event.target.value })}
          sx={{ maxWidth: 420 }}
        />
      )}

      {mode === "explicit" && cardRefCount > 0 && (
        <Alert severity="info">
          This deck names card variants — an entity taught through a particular
          template — and the editor that understands them arrives with the deck
          editor rework. Its {cardRefCount} explicit
          {cardRefCount === 1 ? " member is " : " members are "} left untouched
          here.
        </Alert>
      )}

      {mode === "explicit" && !disabled && cardRefCount === 0 && (
        <ExplicitMembers members={entityKeys} onChange={onChange} />
      )}

      {mode === "explicit" && disabled && cardRefCount === 0 && (
        <Typography variant="body2" color="text.secondary">
          {entityKeys.join(", ")}
        </Typography>
      )}
    </Stack>
  );
}
