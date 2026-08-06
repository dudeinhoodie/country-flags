import "dotenv/config";
import { resolve } from "node:path";

import { loadSigningPublicKeys } from "../modules/content/bundle/bundle-signer";
import { validateBundle } from "../modules/content/bundle/bundle-validator";

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const bundleDirArgument = option(args, "--bundle-dir");
  if (bundleDirArgument === undefined) {
    throw new Error("content:bundle:validate requires --bundle-dir <path>");
  }

  const { domain } = await validateBundle(
    resolve(bundleDirArgument),
    loadSigningPublicKeys(),
  );

  process.stdout.write(
    `${JSON.stringify({
      entities: domain.catalog.entities.length,
      relations: domain.catalog.relations.length,
      decks: domain.catalog.decks.length,
      assets: domain.assets.length,
      cardTemplates: domain.cardTemplates.length,
      learningCards: domain.learningCards.length,
    })}\n`,
  );
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Content bundle validation failed: ${message}\n`);
  process.exitCode = 1;
});
