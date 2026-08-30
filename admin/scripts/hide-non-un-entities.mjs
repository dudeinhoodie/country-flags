// Applies ADR-018 through the admin console's own API, so the edit is a
// draft with a diff, a validation report, an audit trail and a proposal
// pull request — the same thing fifty-three clicks would produce, minus the
// clicks. It is not a way around the console; it is the console's API.
//
// The set of entities is derived here from the draft itself, by the rule
// ADR-018 states — the UN members and observers plus Kosovo and Taiwan are
// taught, everything else in the pool is not. Nothing is typed out, so a
// catalogue that moved since the ADR was written produces a different and
// still correct plan, and the expected size is asserted before any write.
//
//   ADMIN_API_BASE=https://<backend>/v1 \
//   ADMIN_ORIGIN=https://<console> \
//   ADMIN_SESSION=<cf_admin_session cookie> \
//   node admin/scripts/hide-non-un-entities.mjs
//
// It prints the plan and stops. Add --apply to write it, and --propose to
// open the proposal pull request afterwards (that step needs the PUBLISHER
// role; the writes need EDITOR).
//
//   --draft <id>    edit an existing draft instead of creating one
//   --expect <n>    how many entities must remain taught (default 197)
//
// A run that stops on the expected-size check has already created its draft
// and written nothing into it. The draft is listed in the console and can be
// handed back here with --draft once the number is understood.
//
// The session cookie is httpOnly, so it cannot be read from page scripts:
// copy it from the browser's own storage inspector while signed in to the
// console. It is a live credential — pass it in the environment, never on
// the command line, where it would land in the shell history.

const SESSION_COOKIE = "cf_admin_session";

const TAUGHT_RECOGNITION = new Set(["un_member", "un_observer"]);
const TAUGHT_EXCEPTIONS = new Set(["country.kosovo", "country.taiwan"]);
/** The learnable pool's types (ADR-015); regions and subregions are neither. */
const POOL_TYPES = new Set(["country", "territory", "area"]);
const RETIRED_DECK = "deck.special-areas";

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function option(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? fallback : process.argv[at + 1];
}

const apply = flag("apply");
const propose = flag("propose");

/**
 * Where to call and who as. Read inside `main` rather than at module scope,
 * so a missing variable is one printed line and not a stack trace: the
 * whole point of naming them is to be told which one is missing.
 */
let api;
let origin;
let session;

function readConfiguration() {
  api = requiredEnv("ADMIN_API_BASE").replace(/\/+$/, "");
  origin = requiredEnv("ADMIN_ORIGIN");
  session = requiredEnv("ADMIN_SESSION");
  const expected = Number(option("expect", "197"));
  if (!Number.isInteger(expected) || expected < 1) {
    throw new Error("--expect must be a positive integer");
  }
  return expected;
}

/**
 * One request. The console's mutations are guarded by the Origin header as
 * well as the cookie (`assertTrustedAdminOrigin`), so both go on every call
 * rather than only on the ones that happen to need them today.
 */
async function call(method, path, { body, ifMatch } = {}) {
  const url = `${api}${path}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        cookie: `${SESSION_COOKIE}=${session}`,
        origin,
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(ifMatch === undefined ? {} : { "if-match": String(ifMatch) }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    // "fetch failed" on its own does not say which address was wrong, and
    // the address is the thing an operator has just typed.
    throw new Error(
      `${method} ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  let payload = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text.slice(0, 400) };
    }
  }
  if (!response.ok) {
    // The typed error envelope carries the useful half; the status alone
    // says nothing about which precondition was not met. The request id
    // goes with it, because that is what the backend's logs are keyed by.
    const envelope = payload?.error ?? payload ?? {};
    const code = String(envelope.code ?? "UNKNOWN");
    const message = String(envelope.message ?? text.slice(0, 200));
    const requestId =
      envelope.requestId === undefined
        ? ""
        : ` [request ${String(envelope.requestId)}]`;
    throw new Error(
      `${method} ${path} failed: ${String(response.status)} ${code} — ${message}${requestId}`,
    );
  }
  return payload;
}

function isTaught(entity) {
  return (
    entity.type === "country" &&
    (TAUGHT_RECOGNITION.has(entity.recognitionStatus) ||
      TAUGHT_EXCEPTIONS.has(entity.key))
  );
}

async function main() {
  const expected = readConfiguration();

  const me = await call("GET", "/admin/me");
  process.stdout.write(
    `Signed in as ${String(me.email ?? me.id)} (${String(me.role ?? "unknown role")})\n`,
  );

  const existingDraft = option("draft", undefined);
  let draft;
  if (existingDraft === undefined) {
    // Creating a draft is itself a write, so a dry run will not do it: it
    // reads an existing draft instead, and says so rather than quietly
    // leaving a draft behind on a run that was only meant to look.
    if (!apply) {
      process.stdout.write(
        "Nothing to read: a dry run needs a draft. Pass --draft <id>, " +
          "or --apply to create one and write the plan.\n",
      );
      process.exitCode = 1;
      return;
    }
    draft = await call("POST", "/admin/content/drafts");
    process.stdout.write(`Created draft ${String(draft.id)}\n`);
  } else {
    draft = await call("GET", `/admin/content/drafts/${existingDraft}`);
    process.stdout.write(
      `Using draft ${String(draft.id)} (revision ${String(draft.revision)}, ${String(draft.status)})\n`,
    );
  }

  const draftId = String(draft.id);
  let revision = Number(draft.revision);

  const { items: entities } = await call(
    "GET",
    `/admin/content/drafts/${draftId}/entities`,
  );
  const pool = entities.filter((entity) => POOL_TYPES.has(entity.type));
  const active = pool.filter((entity) => entity.status === "active");
  const toHide = active
    .filter((entity) => !isTaught(entity))
    .sort((left, right) => left.key.localeCompare(right.key, "en"));
  const staying = active.filter(isTaught);

  process.stdout.write(
    `\nPool: ${String(pool.length)} entities, ${String(active.length)} active.\n`,
  );
  process.stdout.write(
    `Taught after this change: ${String(staying.length)}. To hide: ${String(toHide.length)}.\n`,
  );
  const byType = {};
  for (const entity of toHide) {
    byType[entity.type] = (byType[entity.type] ?? 0) + 1;
  }
  for (const [type, count] of Object.entries(byType).sort()) {
    process.stdout.write(`  ${type}: ${String(count)}\n`);
  }
  for (const entity of toHide) {
    process.stdout.write(`  - ${entity.key}\n`);
  }

  // Asserted before the first write rather than checked afterwards: a plan
  // that does not end at the agreed number is a plan somebody should read,
  // not one to half-apply and then reason about.
  if (staying.length !== expected) {
    throw new Error(
      `The plan would leave ${String(staying.length)} taught entities, not ${String(expected)}. ` +
        "Check the catalogue, then re-run with --expect <n> if the number is right.",
    );
  }

  const { items: decks } = await call(
    "GET",
    `/admin/content/drafts/${draftId}/decks`,
  );
  const doomedDeck = decks.find((deck) => deck.key === RETIRED_DECK);
  if (doomedDeck !== undefined) {
    process.stdout.write(
      `\nDeck to delete: ${RETIRED_DECK} (${String(doomedDeck.memberCount)} members).\n`,
    );
  }

  if (!apply) {
    process.stdout.write("\nDry run. Re-run with --apply to write it.\n");
    return;
  }

  // One at a time, in key order, because the draft's revision is a chain:
  // each write returns the revision the next one must present as If-Match.
  process.stdout.write("\n");
  for (const [index, entity] of toHide.entries()) {
    const stamp = await call(
      "PATCH",
      `/admin/content/drafts/${draftId}/entities/${encodeURIComponent(entity.key)}`,
      { body: { status: "hidden" }, ifMatch: revision },
    );
    revision = Number(stamp.revision);
    process.stdout.write(
      `[${String(index + 1)}/${String(toHide.length)}] ${entity.key} → hidden (revision ${String(revision)})\n`,
    );
  }

  if (doomedDeck !== undefined) {
    const stamp = await call(
      "DELETE",
      `/admin/content/drafts/${draftId}/decks/${encodeURIComponent(RETIRED_DECK)}`,
      { ifMatch: revision },
    );
    revision = Number(stamp.revision);
    process.stdout.write(
      `Deleted ${RETIRED_DECK} (revision ${String(revision)})\n`,
    );
  }

  const validated = await call(
    "POST",
    `/admin/content/drafts/${draftId}/validate`,
  );
  revision = Number(validated.revision);
  // `blocking` and `warnings` are counts, not flags: a report with warnings
  // is a report to read, and only a blocking count stops the run.
  const report = validated.report ?? {};
  const findings = Array.isArray(report.findings) ? report.findings : [];
  process.stdout.write(
    `\nValidation: ${String(validated.status)} — ` +
      `${String(report.blocking ?? 0)} blocking, ${String(report.warnings ?? 0)} warnings\n`,
  );
  for (const finding of findings.slice(0, 20)) {
    process.stdout.write(
      `  ${String(finding.level)} ${String(finding.code)} ${String(finding.subject)}: ${String(finding.message)}\n`,
    );
  }
  if (findings.length > 20) {
    process.stdout.write(`  … and ${String(findings.length - 20)} more\n`);
  }
  if (Number(report.blocking ?? 0) > 0) {
    throw new Error(
      "The draft does not validate; it is saved, and the console shows the findings above in context.",
    );
  }

  if (!propose) {
    process.stdout.write(
      `\nDraft ${draftId} is ready at revision ${String(revision)}. ` +
        "Open it in the console to review the diff, or re-run with --propose.\n",
    );
    return;
  }

  const proposal = await call(
    "POST",
    `/admin/content/drafts/${draftId}/proposal`,
    {
      body: {
        draftRevision: revision,
        baseContentVersion: String(draft.baseContentVersion),
        baseCatalogCommit: String(draft.baseCatalogCommit),
      },
    },
  );
  process.stdout.write(`\nProposal: ${String(proposal.proposalUrl)}\n`);
  process.stdout.write(
    "The proposal branch rebuilds its own derived artifacts (content-proposal-sync).\n" +
      "Still needed on that branch: the pinned pool size, 250 → 197, in\n" +
      "tools/content-pipeline/test/pipeline.spec.ts and BundledFlagsTests.swift.\n",
  );
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
