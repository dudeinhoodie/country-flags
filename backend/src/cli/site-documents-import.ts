import "reflect-metadata";
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { PrismaService } from "../infrastructure/database/prisma.service";
import { AdminAuditService } from "../modules/admin-auth/admin-audit.service";
import {
  parseCreateRequest,
  parseLocale,
  parseSlug,
} from "../modules/admin-site/admin-site.request";
import { AdminSiteService } from "../modules/admin-site/admin-site.service";
import {
  createSiteObjectStorage,
  describeSiteObjectStorage,
  SiteSnapshotStore,
} from "../modules/admin-site/site-snapshot-store";

/**
 * Seeds the site's documents from Markdown files (ADR-023).
 *
 *   corepack yarn site:documents:import --actor-email <admin email> \
 *     [--dir backend/seed/site-documents] [--publish] [--overwrite]
 *
 * One file per document and locale, named `<slug>.<locale>.md`, whose first
 * line is `# <title>` and whose rest is the body. A document that already
 * exists is left alone unless `--overwrite` says to replace its draft; with
 * `--publish` every imported draft is published as the next version and the
 * snapshot is written, which needs the SITE_OBJECT_STORAGE_* variables of the
 * environment being seeded.
 *
 * The actor has to be an existing admin user: every document names who
 * created it, and a seed is not exempt from the audit trail.
 */

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

interface SeedFile {
  slug: string;
  locale: string;
  title: string;
  body: string;
}

export function readSeedFile(path: string, contents: string): SeedFile {
  const name = basename(path, ".md");
  const separator = name.lastIndexOf(".");
  if (separator === -1) {
    throw new Error(`${path}: expected a name like <slug>.<locale>.md`);
  }
  const slug = parseSlug(name.slice(0, separator));
  const locale = parseLocale(name.slice(separator + 1));

  const lines = contents.split(/\r?\n/);
  const first = lines.findIndex((line) => line.trim().length > 0);
  const heading = first === -1 ? "" : (lines[first] ?? "");
  if (!heading.startsWith("# ")) {
    throw new Error(`${path}: the first line must be "# <title>"`);
  }
  const title = heading.slice(2).trim();
  const body = lines
    .slice(first + 1)
    .join("\n")
    .replace(/^\s*\n/, "")
    .trimEnd();
  return { slug, locale, title, body: `${body}\n` };
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const actorEmail = option(args, "--actor-email");
  if (actorEmail === undefined) {
    throw new Error(
      "site:documents:import requires --actor-email <email of an existing admin user>",
    );
  }
  const directory = resolve(
    option(args, "--dir") ?? resolve(__dirname, "../../seed/site-documents"),
  );
  const publish = args.includes("--publish");
  const overwrite = args.includes("--overwrite");

  if (publish && !describeSiteObjectStorage().configured) {
    throw new Error(
      "--publish would write the snapshot to an in-process store that vanishes with this command. Configure SITE_OBJECT_STORAGE_* for the environment being seeded, or drop --publish and publish from the console.",
    );
  }

  const files = readdirSync(directory)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => {
      const path = resolve(directory, name);
      return readSeedFile(path, readFileSync(path, "utf8"));
    });
  if (files.length === 0) {
    throw new Error(`${directory} holds no <slug>.<locale>.md files`);
  }

  const database = new PrismaService();
  try {
    const actor = await database.adminUser.findUnique({
      where: { email: actorEmail },
    });
    if (actor === null) {
      throw new Error(
        `${actorEmail} is not an admin user here; sign into the console once so the account exists, then run this again`,
      );
    }
    const site = new AdminSiteService(
      database,
      new AdminAuditService(database),
      new SiteSnapshotStore(createSiteObjectStorage()),
      process.env.SITE_PUBLIC_URL ?? null,
    );
    const requestId = `cli-site-import-${String(Date.now())}`;

    for (const file of files) {
      const address = `${file.slug}.${file.locale}`;
      const existing = await database.siteDocument.findUnique({
        where: { slug_locale: { slug: file.slug, locale: file.locale } },
      });
      let document;
      if (existing === null) {
        document = await site.create(
          actor,
          parseCreateRequest({
            slug: file.slug,
            locale: file.locale,
            title: file.title,
            body: file.body,
          }),
          requestId,
        );
        process.stdout.write(`created ${address}\n`);
      } else if (overwrite) {
        document = await site.update(
          actor,
          file.slug,
          file.locale,
          { revision: existing.revision, title: file.title, body: file.body },
          requestId,
        );
        process.stdout.write(
          `replaced the draft of ${address} (revision ${String(document.revision)})\n`,
        );
      } else {
        process.stdout.write(`kept ${address} (already exists)\n`);
        continue;
      }

      if (publish) {
        const published = await site.publish(
          actor,
          file.slug,
          file.locale,
          { revision: document.revision, note: "Imported from the seed files" },
          requestId,
        );
        process.stdout.write(
          `published ${address} as version ${String(published.publishedVersion?.version ?? 0)}\n`,
        );
      }
    }
  } finally {
    await database.$disconnect();
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Site documents import failed: ${message}\n`);
    process.exitCode = 1;
  });
}
