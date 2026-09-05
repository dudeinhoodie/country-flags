import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAdminApiClient } from "../api/ApiClientContext";
import type { components } from "../api/generated/admin-api";
import { useCurrentDraft } from "./CurrentDraftContext";
import { routes } from "./routes";

type PublishedEntity = components["schemas"]["AdminEntitySummary"];
type PublishedDeck = components["schemas"]["AdminDeckSummary"];
type DraftEntity = components["schemas"]["AdminDraftEntityListItem"];

interface Hit {
  id: string;
  group: string;
  primary: string;
  secondary: string;
  href: string;
}

const MIN_QUERY = 2;

function draftHits(
  draftId: string,
  entities: readonly DraftEntity[],
  query: string,
): Hit[] {
  const needle = query.toLowerCase();
  return entities
    .filter((entity) =>
      [
        entity.key,
        entity.publishedName ?? "",
        entity.identifiers.isoAlpha2 ?? "",
        entity.identifiers.isoAlpha3 ?? "",
        entity.identifiers.isoSubdivision ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .slice(0, 6)
    .map((entity) => ({
      id: `draft-${entity.key}`,
      group: "In this draft",
      primary: entity.publishedName ?? entity.key,
      secondary: `${entity.key} · ${entity.type}${
        entity.identifiers.isoSubdivision === undefined
          ? ""
          : ` · ${entity.identifiers.isoSubdivision}`
      }`,
      href: routes.draftEntity(draftId, entity.key),
    }));
}

/**
 * One box that finds a country by name, key, ISO or subdivision code, and a
 * deck by name or code (§4.2).
 *
 * It searches the draft first, because that is where work happens, then the
 * published release. There is no search endpoint spanning both (#356), so
 * the draft's entity list — a single whole answer the console already
 * holds — is filtered here and the published lists are asked with `q`.
 */
export function GlobalSearch() {
  const client = useAdminApiClient();
  const { draft } = useCurrentDraft();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [draftEntities, setDraftEntities] = useState<readonly DraftEntity[]>(
    [],
  );
  const [published, setPublished] = useState<{
    entities: readonly PublishedEntity[];
    decks: readonly PublishedDeck[];
  }>({ entities: [], decks: [] });

  // ⌘K / Ctrl+K from anywhere, the shortcut the button advertises.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(query.trim());
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open || draft === null) {
      return;
    }
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/entities", {
        params: { path: { draftId: draft.id } },
      })
      .then(({ data }) => {
        if (!cancelled && data !== undefined) {
          setDraftEntities(data.items);
        }
      })
      .catch(() => {
        // The published half of the search still answers.
      });
    return () => {
      cancelled = true;
    };
  }, [client, draft, open]);

  useEffect(() => {
    if (!open || debounced.length < MIN_QUERY) {
      return;
    }
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/content/entities", {
        params: { query: { q: debounced, limit: 6 } },
      }),
      client.GET("/v1/admin/content/decks", {
        params: { query: { limit: 100 } },
      }),
    ])
      .then(([entities, decks]) => {
        if (cancelled) {
          return;
        }
        setPublished({
          entities: entities.data?.items ?? [],
          decks: decks.data?.items ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setPublished({ entities: [], decks: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, debounced, open]);

  const hits = useMemo<Hit[]>(() => {
    if (debounced.length < MIN_QUERY) {
      return [];
    }
    const needle = debounced.toLowerCase();
    const inDraft =
      draft === null ? [] : draftHits(draft.id, draftEntities, debounced);
    const entities = published.entities.slice(0, 6).map((entity) => ({
      id: `entity-${entity.id}`,
      group: "Published countries",
      primary: entity.nameRu ?? entity.nameEn ?? entity.contentKey,
      secondary: `${entity.contentKey}${entity.isoAlpha2 === null ? "" : ` · ${entity.isoAlpha2}`}`,
      href: routes.publishedEntity(entity.id),
    }));
    const decks = published.decks
      .filter((deck) =>
        [deck.code, deck.nameRu ?? "", deck.nameEn ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .slice(0, 6)
      .map((deck) => ({
        id: `deck-${deck.id}`,
        group: "Published decks",
        primary: deck.nameRu ?? deck.nameEn ?? deck.code,
        secondary: `${deck.code} · ${String(deck.cardCount)} cards`,
        href: routes.publishedDeck(deck.id),
      }));
    return [...inDraft, ...entities, ...decks];
  }, [debounced, draft, draftEntities, published]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      void navigate(href);
    },
    [navigate],
  );

  let lastGroup = "";

  return (
    <>
      <Button
        color="inherit"
        size="small"
        onClick={() => setOpen(true)}
        startIcon={<SearchIcon fontSize="small" />}
        aria-label="Search content"
        aria-keyshortcuts="Meta+K Control+K"
        sx={{
          border: "1px solid",
          borderColor: "rgba(255, 255, 255, 0.28)",
          borderRadius: 2,
          px: 1.25,
          minWidth: { xs: 0, md: 220 },
          justifyContent: "flex-start",
          fontWeight: 500,
        }}
      >
        <Box
          component="span"
          sx={{ display: { xs: "none", md: "inline" }, opacity: 0.85 }}
        >
          Search content
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        <Chip
          size="small"
          label="⌘K"
          sx={{
            display: { xs: "none", md: "inline-flex" },
            height: 20,
            color: "inherit",
            border: "1px solid",
            borderColor: "rgba(255, 255, 255, 0.28)",
            backgroundColor: "transparent",
          }}
        />
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-label="Search content"
      >
        <DialogContent sx={{ p: 2 }}>
          <TextField
            autoFocus
            fullWidth
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Country name, entity key, ISO or subdivision code, deck"
            label="Search content"
            onKeyDown={(event) => {
              if (event.key === "Enter" && hits[0] !== undefined) {
                go(hits[0].href);
              }
            }}
          />
          <Divider sx={{ my: 1.5 }} />
          {debounced.length < MIN_QUERY ? (
            <Typography variant="body2" color="text.secondary">
              Type at least two characters. The draft is searched first, then
              the published release.
            </Typography>
          ) : hits.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nothing matches “{debounced}”.
            </Typography>
          ) : (
            <List dense sx={{ maxHeight: 380, overflowY: "auto" }}>
              {hits.map((hit) => {
                const heading = hit.group === lastGroup ? null : hit.group;
                lastGroup = hit.group;
                return (
                  <Box key={hit.id}>
                    {heading !== null && (
                      <Typography
                        variant="overline"
                        color="text.secondary"
                        sx={{ display: "block", px: 1, pt: 1 }}
                      >
                        {heading}
                      </Typography>
                    )}
                    <ListItemButton onClick={() => go(hit.href)}>
                      <ListItemText
                        primary={hit.primary}
                        secondary={hit.secondary}
                      />
                    </ListItemButton>
                  </Box>
                );
              })}
            </List>
          )}
          <Stack direction="row" sx={{ justifyContent: "flex-end", pt: 1 }}>
            <Button size="small" onClick={() => setOpen(false)}>
              Close
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </>
  );
}
