import type {
  FindingObjectType,
  FindingTarget,
  ValidationFinding,
} from "./draft-validation.service";

/**
 * Carrying a draft onto the catalog that moved under it.
 *
 * A draft records the catalog commit it was imported from, and a proposal
 * built on a stale base would silently revert whatever landed in `master`
 * meanwhile — which is the overwrite the ownership split exists to prevent
 * (ADR-014 §4). Refusing is therefore right, but refusing *everything* is
 * not: every merge to master redeploys dev with a new catalog, so a deploy
 * about somebody else's entity used to kill an unrelated draft along with
 * the coat of arms uploaded into it (#395).
 *
 * So the base is moved forward wherever it can be proved that nothing is
 * being reverted, and refused — by object and by field — wherever it cannot.
 * The proof is an ordinary three-way merge: the document the draft started
 * from, the document it holds now, and the catalog this deployment carries.
 * Where only one side moved, that side wins; where both moved to the same
 * value, they agree; where both moved to different values, nobody wins and
 * the collision is reported at the field it happened on.
 *
 * Everything here is a pure function of three documents. The draft row, the
 * uploaded drawings and the audit trail are the service's business.
 */

/** What the carry brought in from the catalog, for the editor to read. */
export interface CarriedChange {
  objectType: FindingObjectType;
  objectKey: string;
  change: "added" | "changed" | "removed";
}

export interface CarryPlan {
  /** The draft document rebased onto the catalog, when nothing collided. */
  document: Record<string, unknown>;
  /** The catalog's own changes the draft did not touch, now carried in. */
  incoming: CarriedChange[];
  /**
   * Where the two sides moved the same field to different values. A carry
   * with any of these is refused whole: the draft, its edits and its
   * uploads stay exactly as they were, and the editor is told which field
   * to look at rather than which draft to abandon.
   */
  collisions: ValidationFinding[];
}

/** One uploaded drawing, as far as the merge needs to know it. */
export interface CarriedAsset {
  entityContentKey: string;
  /** The editorial spelling: `flag`, `coat_of_arms`, `map`. */
  assetType: string;
  variant: string;
}

const ENTITY_TABS = new Set(["overview", "names", "facts", "media", "usage"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const keys = Object.keys(left).sort();
    const others = Object.keys(right).sort();
    return (
      keys.length === others.length &&
      keys.every((key, index) => key === others[index]) &&
      keys.every((key) => deepEqual(left[key], right[key]))
    );
  }
  return false;
}

/** RFC 6901 escaping, so a key containing a slash cannot forge a pointer. */
function escapePointer(segment: string): string {
  return segment.replace(/~/gu, "~0").replace(/\//gu, "~1");
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/gu, "/").replace(/~0/gu, "~");
}

/**
 * Every leaf pointer at which two values differ.
 *
 * The walk descends into objects and stops at arrays. An array is compared
 * whole on purpose: a member inserted at the top of a deck shifts every
 * index below it, and a positional merge would happily "keep" both sides by
 * writing a list neither of them asked for. `/members` changed on both
 * sides is a collision, and that is the honest answer.
 *
 * A sub-object one side does not have is still walked field by field: an
 * entity that gains its first `overrides` map here and its first
 * `identifiers` map there has not been changed twice. The root is the
 * exception — whether the object exists at all is decided there, and
 * descending into an object the other side deleted would let an edit
 * resurrect it one field at a time.
 */
export function changedPointers(
  before: unknown,
  after: unknown,
  prefix = "",
): string[] {
  if (deepEqual(before, after)) {
    return [];
  }
  const walkable =
    (isPlainObject(before) && isPlainObject(after)) ||
    (prefix !== "" &&
      (before === undefined || after === undefined) &&
      (isPlainObject(before) || isPlainObject(after)));
  if (!walkable) {
    return [prefix];
  }
  const keys = [
    ...new Set([
      ...(isPlainObject(before) ? Object.keys(before) : []),
      ...(isPlainObject(after) ? Object.keys(after) : []),
    ]),
  ].sort();
  if (keys.length === 0) {
    // An empty map on one side and nothing on the other: no field says so,
    // so the difference is the map itself.
    return [prefix];
  }
  return keys.flatMap((key) =>
    changedPointers(
      isPlainObject(before) ? before[key] : undefined,
      isPlainObject(after) ? after[key] : undefined,
      `${prefix}/${escapePointer(key)}`,
    ),
  );
}

/** Whether one pointer contains the other; the root pointer contains all. */
function covers(outer: string, inner: string): boolean {
  return outer === inner || inner.startsWith(`${outer}/`);
}

function valueAt(document: unknown, pointer: string): unknown {
  if (pointer === "") {
    return document;
  }
  let current = document;
  for (const segment of pointer.slice(1).split("/")) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[unescapePointer(segment)];
  }
  return current;
}

/** A copy of `target` with `pointer` set — or removed, for `undefined`. */
function withValueAt(
  target: Record<string, unknown>,
  pointer: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = pointer.slice(1).split("/");
  const key = unescapePointer(head ?? "");
  if (rest.length === 0) {
    if (value === undefined) {
      const remaining = { ...target };
      delete remaining[key];
      return remaining;
    }
    return { ...target, [key]: value };
  }
  const child = target[key];
  return {
    ...target,
    [key]: withValueAt(
      isPlainObject(child) ? child : {},
      `/${rest.join("/")}`,
      value,
    ),
  };
}

interface ObjectMerge {
  /** The merged value, or undefined when the object is gone. */
  value: unknown;
  /** Pointers the two sides moved to different values. */
  conflicts: string[];
}

/**
 * The three-way merge of one object.
 *
 * An object absent on a side is not a special case: `changedPointers`
 * answers the root pointer for it, and the root pointer covers every other,
 * so "deleted here, edited there" collides on the whole object exactly as
 * it should.
 */
export function mergeObject(
  base: unknown,
  mine: unknown,
  theirs: unknown,
): ObjectMerge {
  const minePointers = changedPointers(base, mine);
  if (minePointers.length === 0) {
    return { value: theirs, conflicts: [] };
  }
  const theirPointers = changedPointers(base, theirs);
  if (theirPointers.length === 0) {
    return { value: mine, conflicts: [] };
  }

  const conflicts: string[] = [];
  const applicable: string[] = [];
  for (const pointer of minePointers) {
    const overlapping = theirPointers.filter(
      (other) => covers(other, pointer) || covers(pointer, other),
    );
    if (overlapping.length === 0) {
      applicable.push(pointer);
      continue;
    }
    // Both sides typed the same thing: agreement, not a collision.
    if (
      overlapping.length === 1 &&
      overlapping[0] === pointer &&
      deepEqual(valueAt(mine, pointer), valueAt(theirs, pointer))
    ) {
      continue;
    }
    // Reported at the widest of the two: the catalog dropping the whole
    // object is a collision about the object, not about the one field of it
    // this draft happened to touch.
    conflicts.push(
      overlapping.reduce(
        (widest, other) => (covers(other, widest) ? other : widest),
        pointer,
      ),
    );
  }
  if (conflicts.length > 0) {
    return { value: theirs, conflicts: [...new Set(conflicts)] };
  }
  let merged = isPlainObject(theirs) ? theirs : {};
  for (const pointer of applicable) {
    merged =
      pointer === ""
        ? (mine as Record<string, unknown>)
        : withValueAt(merged, pointer, valueAt(mine, pointer));
  }
  return { value: merged, conflicts: [] };
}

/** How a collection of objects is identified, addressed and described. */
interface CollectionSpec {
  field: string;
  objectType: FindingObjectType;
  identityOf: (entry: Record<string, unknown>) => string;
  /** What a reader calls the object; the console's `objectKey`. */
  keyOf: (entry: Record<string, unknown>) => string;
  /** The editor tab and edit-model pointer a document pointer lands on. */
  targetOf: (key: string, pointer: string) => FindingTarget;
}

/** An identity segment. Anything a key cannot be reads as absent. */
function text(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

/**
 * The entity editor's address for a field of the editorial record.
 *
 * The console never sees the editorial document: it edits the shape
 * `/entities/{key}` returns, where the override map is spread into a names
 * tab and a facts form (#356). So `overrides["names.ru.short"]` is
 * `/names/ru/short` on the names tab, and the dotted override path becomes
 * the pointer by the same mechanical rule the form itself uses.
 */
export function entityFieldTarget(key: string, pointer: string): FindingTarget {
  const segments = pointer === "" ? [] : pointer.slice(1).split("/");
  const [head, ...rest] = segments.map(unescapePointer);
  if (head === undefined) {
    return {
      objectType: "entity",
      objectKey: key,
      tab: "overview",
      field: null,
    };
  }
  if (head === "overrides") {
    const path = rest.join("/").split(".");
    const tab = ENTITY_TABS.has(path[0] ?? "")
      ? (path[0] as string)
      : "overview";
    return {
      objectType: "entity",
      objectKey: key,
      tab,
      field: `/${path.join("/")}`,
    };
  }
  if (head === "config") {
    // The document nests the listing toggle under `config`; the form does
    // not, so the pointer drops the wrapper the editor never sees.
    return {
      objectType: "entity",
      objectKey: key,
      tab: "overview",
      field: rest.length === 0 ? null : `/${rest.join("/")}`,
    };
  }
  return {
    objectType: "entity",
    objectKey: key,
    tab: "overview",
    field: `/${segments.join("/")}`,
  };
}

/** The deck builder's tab for a field of the editorial deck. */
export function deckFieldTarget(key: string, pointer: string): FindingTarget {
  const head = pointer === "" ? "" : (pointer.slice(1).split("/")[0] ?? "");
  const tab =
    head === "members" || head === "kind"
      ? "content"
      : head === "previewCards"
        ? "presentation"
        : head === "access"
          ? "access"
          : "details";
  return {
    objectType: "deck",
    objectKey: key,
    tab,
    // The console calls the preview list by the name its own form uses.
    field:
      pointer === ""
        ? null
        : head === "previewCards"
          ? "/previewCardIds"
          : pointer,
  };
}

const ENTITIES: CollectionSpec = {
  field: "entities",
  objectType: "entity",
  identityOf: (entry) => text(entry.key),
  keyOf: (entry) => text(entry.key),
  targetOf: entityFieldTarget,
};

const DECKS: CollectionSpec = {
  field: "decks",
  objectType: "deck",
  identityOf: (entry) => text(entry.key),
  keyOf: (entry) => text(entry.key),
  targetOf: deckFieldTarget,
};

const RELATIONS: CollectionSpec = {
  field: "additionalRelations",
  objectType: "relation",
  identityOf: (entry) =>
    [entry.parentKey, entry.childKey, entry.taxonomyKey].map(text).join(" "),
  keyOf: (entry) => `${text(entry.parentKey)} to ${text(entry.childKey)}`,
  targetOf: (key) => ({
    objectType: "relation",
    objectKey: key,
    tab: null,
    field: "/additionalRelations",
  }),
};

/** The identity of one drawing of one entity: the symbol slot it fills. */
export function symbolIdentity(
  entityKey: string,
  assetType: string,
  variant: string,
): string {
  return [entityKey, assetType, variant].join(" ");
}

const ASSET_OVERRIDES: CollectionSpec = {
  field: "assetOverrides",
  objectType: "asset",
  identityOf: (entry) =>
    symbolIdentity(
      text(entry.entityKey),
      text(entry.assetType),
      // v2 has no variant and means the drawing in force.
      entry.variant === undefined ? "current" : text(entry.variant),
    ),
  keyOf: (entry) => text(entry.entityKey),
  // An override is edited on the entity that owns it: the media editor is
  // contextual and there is no screen where an asset floats free.
  targetOf: (key, pointer) => ({
    objectType: "asset",
    objectKey: key,
    tab: "media",
    field: pointer === "" ? null : pointer,
  }),
};

const COLLECTIONS = [ENTITIES, DECKS, RELATIONS, ASSET_OVERRIDES];

function indexOf(
  document: Record<string, unknown> | undefined,
  spec: CollectionSpec,
): Map<string, Record<string, unknown>> {
  const entries = document?.[spec.field];
  const index = new Map<string, Record<string, unknown>>();
  if (!Array.isArray(entries)) {
    return index;
  }
  for (const entry of entries) {
    if (isPlainObject(entry)) {
      index.set(spec.identityOf(entry), entry);
    }
  }
  return index;
}

function collision(
  code: string,
  target: FindingTarget,
  message: string,
): ValidationFinding {
  return {
    level: "blocking",
    code,
    subject: target.objectKey,
    message,
    target,
  };
}

function changeOf(
  base: unknown,
  theirs: unknown,
): CarriedChange["change"] | null {
  if (deepEqual(base, theirs)) {
    return null;
  }
  if (base === undefined) {
    return "added";
  }
  return theirs === undefined ? "removed" : "changed";
}

/** Everything that is not one of the merged collections, nor the version. */
function scalarsOf(document: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(document)) {
    if (
      key !== "schemaVersion" &&
      !COLLECTIONS.some((spec) => spec.field === key)
    ) {
      rest[key] = value;
    }
  }
  return rest;
}

function versionOf(document: Record<string, unknown>): number {
  const declared = document.schemaVersion;
  return typeof declared === "number" ? declared : 1;
}

/**
 * Carries `mine` onto `theirs`, given the `base` both were written from.
 *
 * The result is either a document whose every difference from the catalog
 * is an edit somebody made on purpose, or a list of the fields where that
 * could not be shown. There is no third answer: a merge nobody can justify
 * is refused, because the cost of being wrong here is a change of somebody
 * else's that quietly disappears.
 */
export function planCarry(
  base: Record<string, unknown>,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
  uploads: readonly CarriedAsset[] = [],
): CarryPlan {
  const collisions: ValidationFinding[] = [];
  const incoming: CarriedChange[] = [];
  const document: Record<string, unknown> = {};

  const scalars = mergeObject(
    scalarsOf(base),
    scalarsOf(mine),
    scalarsOf(theirs),
  );
  for (const pointer of scalars.conflicts) {
    collisions.push(
      collision(
        "CATALOG_FIELD_CHANGED_ON_BOTH_SIDES",
        {
          objectType: "catalog",
          objectKey: "catalog",
          tab: null,
          field: pointer,
        },
        `The catalog's ${pointer} was changed both in this draft and in the catalog since the draft was imported`,
      ),
    );
  }
  Object.assign(document, isPlainObject(scalars.value) ? scalars.value : {});
  for (const pointer of changedPointers(scalarsOf(base), scalarsOf(theirs))) {
    incoming.push({
      objectType: "catalog",
      objectKey: `catalog${pointer}`,
      change: "changed",
    });
  }

  for (const spec of COLLECTIONS) {
    const baseIndex = indexOf(base, spec);
    const mineIndex = indexOf(mine, spec);
    const theirsIndex = indexOf(theirs, spec);
    // The catalog's order first, so a carried draft reads like a fresh
    // import of it; whatever only the draft holds is appended in its own.
    const identities = [
      ...theirsIndex.keys(),
      ...[...mineIndex.keys()].filter((identity) => !theirsIndex.has(identity)),
    ];

    const merged: Record<string, unknown>[] = [];
    for (const identity of identities) {
      const baseEntry = baseIndex.get(identity);
      const mineEntry = mineIndex.get(identity);
      const theirsEntry = theirsIndex.get(identity);
      const key = spec.keyOf(theirsEntry ?? mineEntry ?? baseEntry ?? {});
      const result = mergeObject(baseEntry, mineEntry, theirsEntry);
      for (const pointer of result.conflicts) {
        collisions.push(
          collision(
            pointer === ""
              ? "OBJECT_CHANGED_ON_BOTH_SIDES"
              : "FIELD_CHANGED_ON_BOTH_SIDES",
            spec.targetOf(key, pointer),
            pointer === ""
              ? `This ${spec.objectType} was changed both in this draft and in the catalog since the draft was imported`
              : `${pointer} was changed both in this draft and in the catalog since the draft was imported`,
          ),
        );
      }
      const change = changeOf(baseEntry, theirsEntry);
      if (change !== null && result.conflicts.length === 0) {
        incoming.push({ objectType: spec.objectType, objectKey: key, change });
      }
      if (isPlainObject(result.value)) {
        merged.push(result.value);
      }
    }
    // An absent optional collection stays absent rather than becoming an
    // empty array nobody wrote.
    if (
      merged.length > 0 ||
      spec.field in mine ||
      spec.field in theirs ||
      spec.field in base
    ) {
      document[spec.field] = merged;
    }
  }

  collisions.push(...uploadCollisions(base, theirs, uploads));

  // The console can read and write both versions, and an edit that needs v3
  // lifts the document it is made in. A draft already lifted must not be
  // pushed back down by a catalog still written in v2, so the carried
  // document takes the newer of the two.
  const version = Math.max(versionOf(mine), versionOf(theirs));
  return {
    document: { ...document, schemaVersion: version },
    incoming,
    collisions,
  };
}

/**
 * Where an uploaded drawing would overwrite something the catalog gained.
 *
 * The bytes live on the draft rather than in the document, so the merge
 * above cannot see them: the proposal only turns them into `assetOverrides`
 * entries at the moment it commits, and those entries replace whatever the
 * catalog declares for the same symbol. If the catalog has since written
 * that symbol itself, letting the carry through would hand the proposal a
 * silent overwrite — so the upload collides, on the entity that owns it.
 */
function uploadCollisions(
  base: Record<string, unknown>,
  theirs: Record<string, unknown>,
  uploads: readonly CarriedAsset[],
): ValidationFinding[] {
  if (uploads.length === 0) {
    return [];
  }
  const baseOverrides = indexOf(base, ASSET_OVERRIDES);
  const theirOverrides = indexOf(theirs, ASSET_OVERRIDES);
  const baseEntities = indexOf(base, ENTITIES);
  const theirEntities = indexOf(theirs, ENTITIES);

  const findings: ValidationFinding[] = [];
  for (const upload of uploads) {
    const identity = symbolIdentity(
      upload.entityContentKey,
      upload.assetType,
      upload.variant,
    );
    if (!deepEqual(baseOverrides.get(identity), theirOverrides.get(identity))) {
      findings.push(
        collision(
          "UPLOAD_OVERWRITES_CATALOG_ASSET",
          ASSET_OVERRIDES.targetOf(upload.entityContentKey, ""),
          `The catalog changed the ${upload.assetType} override for ${upload.entityContentKey} since this draft was imported, and the uploaded drawing would replace it`,
        ),
      );
    }
    if (
      baseEntities.has(upload.entityContentKey) &&
      !theirEntities.has(upload.entityContentKey)
    ) {
      findings.push(
        collision(
          "UPLOAD_ENTITY_REMOVED_FROM_CATALOG",
          ASSET_OVERRIDES.targetOf(upload.entityContentKey, ""),
          `The catalog no longer carries ${upload.entityContentKey}, so the drawing uploaded for it has nothing to belong to`,
        ),
      );
    }
  }
  return findings;
}
