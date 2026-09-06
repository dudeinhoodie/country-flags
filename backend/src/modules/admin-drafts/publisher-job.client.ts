import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";

export interface PublisherJobConfig {
  project: string;
  region: string;
  job: string;
}

/** Where an access token for the Cloud Run Admin API comes from. */
export type AccessTokenSource = () => Promise<string>;

const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

/**
 * The runtime's own identity, from the metadata server.
 *
 * No key is involved and none can leak: the token is minted for the service
 * account the revision runs as, lives an hour, and is only ever used to say
 * "start this job". What that identity may do is decided by an IAM binding
 * (`roles/run.invoker` on the one job), not by anything in this process — so
 * a compromised API can start the publisher and still cannot sign a release
 * or write content (ADR-017 §3).
 */
export function metadataAccessToken(): AccessTokenSource {
  let cached: { token: string; expiresAt: number } | null = null;
  return async () => {
    const now = Date.now();
    if (cached !== null && cached.expiresAt > now) {
      return cached.token;
    }
    const response = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!response.ok) {
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        "PUBLISHER_JOB_UNREACHABLE",
        "This deployment could not obtain a credential for the publisher job",
        { status: response.status },
      );
    }
    const token = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    // A minute of margin: a token that expires between this call and the
    // request it authorises would fail for a reason nobody could reproduce.
    cached = {
      token: token.access_token,
      expiresAt: now + Math.max(token.expires_in - 60, 0) * 1000,
    };
    return cached.token;
  };
}

/**
 * The service's whole reach into the publisher: it can ask for an execution,
 * and that is all it can do (ADR-017 §1).
 *
 * It cannot read the signing key, write content or move the pointer — those
 * belong to the job's own service account. Publishing from the console is a
 * right to *request* a run, checked by the existing RBAC; it is not a right
 * to publish.
 *
 * An unconfigured deployment is a normal state rather than a broken one: the
 * runs still queue, the console says no executor is configured, and the
 * cancel endpoint is the way out of a queue nothing is draining.
 */
export class PublisherJobClient {
  constructor(
    private readonly config: PublisherJobConfig | null,
    private readonly accessToken: AccessTokenSource = metadataAccessToken(),
  ) {}

  get isConfigured(): boolean {
    return this.config !== null;
  }

  /**
   * Starts one execution for one run and answers with its name.
   *
   * The run id travels as a container override rather than as part of the
   * job definition, so the job is defined once and each execution is told
   * which row it belongs to.
   */
  async start(runId: string): Promise<string> {
    const config = this.config;
    if (config === null) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "PUBLISHER_JOB_NOT_CONFIGURED",
        "This deployment has no publisher job, so a queued run has nothing to execute it",
      );
    }

    const response = await fetch(
      `https://run.googleapis.com/v2/projects/${config.project}/locations/${config.region}/jobs/${config.job}:run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await this.accessToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          overrides: {
            containerOverrides: [
              { env: [{ name: "PUBLISH_RUN_ID", value: runId }] },
            ],
          },
        }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        "PUBLISHER_JOB_START_FAILED",
        "Cloud Run refused to start the publisher job",
        // The body can echo a token in an error, so only the status and a
        // truncated reason travel outward.
        { status: response.status, reason: detail.slice(0, 200) },
      );
    }

    // `jobs:run` answers with a long-running operation whose metadata is the
    // execution. The execution name is what an operator pastes into a log
    // query, so it is preferred; the operation name is the fallback that at
    // least identifies the attempt.
    const operation = (await response.json()) as {
      name?: string;
      metadata?: { name?: string };
    };
    return operation.metadata?.name ?? operation.name ?? "";
  }
}

/**
 * The three coordinates are read straight from the environment, like the
 * GitHub credential beside them, and environment validation refuses a
 * deployment that carries some of them but not all: an operator who set one
 * believes the console can publish, and nothing would say otherwise until a
 * run sat in the queue.
 */
export function createPublisherJobClient(
  env: NodeJS.ProcessEnv = process.env,
): PublisherJobClient {
  const project = env.PUBLISHER_JOB_PROJECT?.trim();
  const region = env.PUBLISHER_JOB_REGION?.trim();
  const job = env.PUBLISHER_JOB_NAME?.trim();
  if (
    project === undefined ||
    project.length === 0 ||
    region === undefined ||
    region.length === 0 ||
    job === undefined ||
    job.length === 0
  ) {
    return new PublisherJobClient(null);
  }
  return new PublisherJobClient({ project, region, job });
}
