import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { sourceAdapter } from "./adapters.js";
import { readJson, sha256, stableJson, writeJson } from "./stable-json.js";
import type { SourceDefinition, SourceKey, SourceRegistry } from "./types.js";

const USER_AGENT =
  "country-flags-content-pipeline/0.1 (+https://github.com/dudeinhoodie/country-flags)";
const ALLOWED_HOSTS = new Set([
  "api.worldbank.org",
  "api.github.com",
  "github.com",
  "query.wikidata.org",
  "raw.githubusercontent.com",
  "unstats.un.org",
]);

export async function loadRegistry(root: string): Promise<SourceRegistry> {
  const registry = await readJson<SourceRegistry>(
    join(root, "sources/registry.json"),
  );
  const keys = registry.sources.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Source registry contains duplicate keys");
  }
  return registry;
}

export async function loadVerifiedSnapshot<T>(
  root: string,
  source: SourceDefinition,
): Promise<T> {
  const path = join(root, source.snapshotPath);
  const content = await readFile(path);
  const actual = sha256(content);
  if (actual !== source.sha256) {
    throw new Error(
      `${source.key} snapshot checksum mismatch: expected ${source.sha256}, received ${actual}`,
    );
  }
  return JSON.parse(content.toString("utf8")) as T;
}

async function fetchWithRetry(
  url: string,
  attempts = 3,
  timeoutMs = 15_000,
): Promise<Response> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Upstream host ${host} is not allowlisted`);
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json, text/html;q=0.9, */*;q=0.8",
          "User-Agent": USER_AGENT,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return response;
      }
      if (response.status !== 429 && response.status < 500) {
        throw new Error(`HTTP ${String(response.status)} for ${url}`);
      }
      lastError = new Error(`HTTP ${String(response.status)} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, attempt * 250);
      });
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Unable to fetch ${url}`);
}

export async function pullSource(
  root: string,
  sourceKey: SourceKey,
  requestedRevision?: string,
  updateRegistry = false,
): Promise<void> {
  const registry = await loadRegistry(root);
  const source = registry.sources.find(({ key }) => key === sourceKey);
  if (source === undefined) {
    throw new Error(`Unknown source ${sourceKey}`);
  }
  const revisionChanged =
    requestedRevision !== undefined && requestedRevision !== source.revision;
  if (revisionChanged) {
    if (!updateRegistry) {
      throw new Error(
        `${sourceKey} is pinned to ${source.revision}; refusing implicit revision ${requestedRevision}`,
      );
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(requestedRevision)) {
      throw new Error("Source revision contains unsafe characters");
    }
    source.revision = requestedRevision;
    source.url = revisionUrl(source);
  }
  const currentSnapshot = await loadVerifiedSnapshot(root, source);
  if (source.url.startsWith("file:")) {
    return;
  }

  const adapter = sourceAdapter(source);
  const payload = await adapter.pull(
    source,
    async (url) => {
      const response = await fetchWithRetry(url);
      const body = await response.text();
      try {
        return JSON.parse(body) as unknown;
      } catch {
        return body;
      }
    },
    currentSnapshot,
  );
  const snapshot = adapter.parse(payload, source, currentSnapshot);
  adapter.normalize(snapshot, source);
  const content = stableJson(snapshot);
  const hash = sha256(content);
  if (hash !== source.sha256) {
    if (updateRegistry) {
      const snapshotPath = join(root, source.snapshotPath);
      await mkdir(dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, content, "utf8");
      source.sha256 = hash;
      source.retrievedAt = new Date().toISOString();
      await writeJson(join(root, "sources/registry.json"), registry);
      return;
    }
    throw new Error(
      `${sourceKey} upstream changed at pinned revision ${source.revision}; expected ${source.sha256}, received ${hash}`,
    );
  }
  const snapshotPath = join(root, source.snapshotPath);
  await mkdir(dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, content, "utf8");
  if (revisionChanged) {
    source.retrievedAt = new Date().toISOString();
    await writeJson(join(root, "sources/registry.json"), registry);
  }
}

function revisionUrl(source: SourceDefinition): string {
  switch (source.key) {
    case "cldr":
      return `https://github.com/unicode-org/cldr-json/releases/tag/${source.revision}`;
    case "annexare":
      return `https://github.com/annexare/Countries/tree/${source.revision}`;
    case "flag-icons":
      return `https://github.com/lipis/flag-icons/releases/tag/${source.revision}`;
    default:
      return source.url;
  }
}
