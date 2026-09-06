import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface BundleBuildRequest {
  contentVersion: string;
  /** The oldest client the release will let read it. */
  minimumClientVersion: string;
  /** Where this environment actually serves the release's files from. */
  assetBaseUrl: string;
}

export interface ContentBuildPaths {
  /** The pipeline's compiled entry point. */
  cli: string;
  /** Where built bundles are written; one directory per version below it. */
  outputRoot: string;
}

/**
 * Where the pipeline and its output live, for the two layouts this code runs
 * in: `backend/dist/modules/content/publisher` inside the image, and
 * `backend/src/modules/content/publisher` under ts-node in a checkout. Both
 * sit five levels below the tree that holds `tools/`, so one relative path
 * serves both and neither has to be configured to work.
 *
 * The environment variables are the escape hatch for a layout that is
 * neither — a local experiment, or an image that moves the pipeline.
 */
export function contentBuildPaths(
  env: NodeJS.ProcessEnv = process.env,
  moduleDirectory: string = __dirname,
): ContentBuildPaths {
  const repositoryRoot = resolve(moduleDirectory, "../../../../..");
  return {
    cli:
      env.CONTENT_PIPELINE_CLI?.trim() ??
      join(repositoryRoot, "tools/content-pipeline/dist/src/cli.js"),
    // Not beside the pipeline: the image's own tree is somebody else's, and
    // a container filesystem is writable in /tmp and read-only in spirit
    // everywhere else.
    outputRoot: env.CONTENT_BUILD_OUTPUT_ROOT?.trim() ?? "/tmp/content-build",
  };
}

/**
 * Builds the release the run asks for, from the catalog this image carries.
 *
 * The pipeline is a separate program rather than a library call: it is an
 * ES module with no package entry point, its build is a long CPU-bound job
 * that has no business sharing an event loop with anything, and running it
 * the way CI runs it means the bundle a publish applies is built by exactly
 * the command whose output the repository's fixture check compares against.
 *
 * What it builds is the catalog at this image's commit. That is the whole
 * difference between this path and the CI workflow, which can build any
 * commit — and it is why the workflow stays (ADR-017 §6).
 */
export async function buildContentBundle(
  request: BundleBuildRequest,
  paths: ContentBuildPaths,
): Promise<string> {
  const bundleDirectory = join(paths.outputRoot, request.contentVersion);
  try {
    await run(
      process.execPath,
      [
        paths.cli,
        "build",
        "--catalog-version",
        request.contentVersion,
        // Refuses to produce a bundle with blocking findings, which is the
        // difference between a build for inspection and one for a release.
        "--publish-ready",
        "--asset-base-url",
        request.assetBaseUrl,
        "--minimum-client-version",
        request.minimumClientVersion,
        "--output",
        paths.outputRoot,
      ],
      {
        // A 250-entity catalogue rasterises seven hundred and fifty files,
        // and the job it runs in is allowed half an hour in total.
        timeout: 900_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } catch (error: unknown) {
    // What the pipeline printed is the diagnosis — "3 blocking report
    // item(s)" or a missing asset — and the wrapper's own "Command failed"
    // is not. The run's failure message is the only thing an operator sees
    // in the console, so it has to carry the reason rather than the shape.
    throw new Error(reasonOf(error));
  }
  return bundleDirectory;
}

function reasonOf(error: unknown): string {
  const detail = (error as { stderr?: unknown } | null)?.stderr;
  const printed = typeof detail === "string" ? detail.trim() : "";
  if (printed.length > 0) {
    return `The content build failed: ${printed.split("\n").slice(-5).join(" ")}`;
  }
  return `The content build failed: ${error instanceof Error ? error.message : String(error)}`;
}
