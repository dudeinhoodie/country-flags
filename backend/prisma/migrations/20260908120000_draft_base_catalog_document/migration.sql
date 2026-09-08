-- A draft remembers the catalog it was imported from, not just its commit.
--
-- `base_catalog_commit` alone can only answer "has the catalog moved", and
-- the answer was used to refuse every proposal built on a stale base. That
-- refusal is right — a stale export would silently revert whatever landed in
-- master meanwhile (ADR-014 §4) — but it was the only answer available, and
-- since every merge redeploys dev with a new catalog it killed unrelated
-- drafts wholesale, uploaded drawings included (#395).
--
-- Telling an edit of this draft's from a change of somebody else's needs the
-- document the draft started from, so it is stored beside the edited one. It
-- is a snapshot on purpose: fetching it back by commit would put a GitHub
-- outage on a path that is otherwise local, and would answer nothing at all
-- in a deployment that has no GitHub credential — a normal state here.
--
-- Nullable, because rows written before this migration have no base
-- recorded. Those drafts keep working; they simply cannot be carried
-- forward, which is the safe direction.

ALTER TABLE "public"."content_drafts"
  ADD COLUMN "base_document" JSONB;

-- Prisma cannot express a CHECK, and this one is worth having: a base that
-- is a scalar or an array is not a catalog document, and a three-way merge
-- fed one would compare nonsense rather than fail.
ALTER TABLE "public"."content_drafts"
  ADD CONSTRAINT "content_drafts_base_document_check" CHECK (
    "base_document" IS NULL OR jsonb_typeof("base_document") = 'object'
  );
