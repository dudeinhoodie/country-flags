import { HttpStatus } from "@nestjs/common";

import { ApiException } from "../../common/http/api.exception";

export interface GitHubConfig {
  token: string;
  owner: string;
  repository: string;
  baseBranch: string;
  publishWorkflow: string;
}

export interface CommittedFile {
  path: string;
  content: Buffer;
}

export interface PullRequestResult {
  number: number;
  url: string;
}

export interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  url: string;
  createdAt: string;
}

function githubUnavailable(): never {
  throw new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    "GITHUB_NOT_CONFIGURED",
    "This deployment has no GitHub credential, so it cannot open a pull request. Download the export and open one by hand.",
  );
}

/**
 * The console's whole reach into the repository: a branch, a commit, a
 * draft pull request, and — if the credential allows it — a dispatch of the
 * existing publish workflow. It never writes to the base branch, because
 * review is the single merge point between the console and the refresh bot
 * (ADR-014 §4).
 *
 * When no credential is configured every call refuses with a message that
 * names the way out, rather than failing as a 500: a deployment without a
 * GitHub App is a normal state, not a broken one.
 */
export class GitHubClient {
  constructor(private readonly config: GitHubConfig | null) {}

  get isConfigured(): boolean {
    return this.config !== null;
  }

  private requireConfig(): GitHubConfig {
    if (this.config === null) {
      githubUnavailable();
    }
    return this.config;
  }

  private async call<T>(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<T> {
    const config = this.requireConfig();
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repository}${path}`,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new ApiException(
        HttpStatus.BAD_GATEWAY,
        "GITHUB_REQUEST_FAILED",
        `GitHub refused ${init.method} ${path}`,
        // The response body can carry a token in an error echo, so only the
        // status and a truncated reason travel outward.
        { status: response.status, reason: detail.slice(0, 200) },
      );
    }
    return (await response.json()) as T;
  }

  async headCommitOf(branch: string): Promise<string> {
    const reference = await this.call<{ object: { sha: string } }>(
      `/git/ref/heads/${branch}`,
      { method: "GET" },
    );
    return reference.object.sha;
  }

  /**
   * Commits the files as one tree on a fresh branch. A tree write keeps the
   * commit atomic: a proposal is one reviewable state, never a sequence of
   * half-applied file writes.
   */
  async commitFiles(
    branch: string,
    message: string,
    files: CommittedFile[],
  ): Promise<string> {
    const config = this.requireConfig();
    const baseSha = await this.headCommitOf(config.baseBranch);
    const baseCommit = await this.call<{ tree: { sha: string } }>(
      `/git/commits/${baseSha}`,
      { method: "GET" },
    );

    const blobs = await Promise.all(
      files.map(async (file) => {
        const blob = await this.call<{ sha: string }>("/git/blobs", {
          method: "POST",
          body: {
            content: file.content.toString("base64"),
            encoding: "base64",
          },
        });
        return { path: file.path, sha: blob.sha };
      }),
    );

    const tree = await this.call<{ sha: string }>("/git/trees", {
      method: "POST",
      body: {
        base_tree: baseCommit.tree.sha,
        tree: blobs.map((blob) => ({
          path: blob.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        })),
      },
    });

    const commit = await this.call<{ sha: string }>("/git/commits", {
      method: "POST",
      body: { message, tree: tree.sha, parents: [baseSha] },
    });

    await this.call("/git/refs", {
      method: "POST",
      body: { ref: `refs/heads/${branch}`, sha: commit.sha },
    });
    return commit.sha;
  }

  async openDraftPullRequest(
    branch: string,
    title: string,
    body: string,
  ): Promise<PullRequestResult> {
    const config = this.requireConfig();
    const pull = await this.call<{ number: number; html_url: string }>(
      "/pulls",
      {
        method: "POST",
        body: {
          title,
          head: branch,
          base: config.baseBranch,
          body,
          draft: true,
        },
      },
    );
    return { number: pull.number, url: pull.html_url };
  }

  async dispatchPublish(
    contentVersion: string,
    minimumClientVersion: string,
  ): Promise<void> {
    const config = this.requireConfig();
    await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repository}/actions/workflows/${config.publishWorkflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: config.baseBranch,
          inputs: {
            content_version: contentVersion,
            minimum_client_version: minimumClientVersion,
          },
        }),
      },
    ).then((response) => {
      if (!response.ok) {
        throw new ApiException(
          HttpStatus.BAD_GATEWAY,
          "GITHUB_DISPATCH_FAILED",
          "GitHub refused to start the publish workflow",
          { status: response.status },
        );
      }
    });
  }

  async latestPublishRun(): Promise<WorkflowRun | null> {
    const config = this.requireConfig();
    const runs = await this.call<{
      workflow_runs: {
        id: number;
        status: string;
        conclusion: string | null;
        html_url: string;
        created_at: string;
      }[];
    }>(`/actions/workflows/${config.publishWorkflow}/runs?per_page=1`, {
      method: "GET",
    });
    const run = runs.workflow_runs[0];
    if (run === undefined) {
      return null;
    }
    return {
      id: run.id,
      status: run.status,
      conclusion: run.conclusion,
      url: run.html_url,
      createdAt: run.created_at,
    };
  }
}

export function createGitHubClient(
  env: NodeJS.ProcessEnv = process.env,
): GitHubClient {
  const token = env.ADMIN_GITHUB_TOKEN?.trim();
  const owner = env.ADMIN_GITHUB_OWNER?.trim();
  const repository = env.ADMIN_GITHUB_REPOSITORY?.trim();
  if (
    token === undefined ||
    token.length === 0 ||
    owner === undefined ||
    owner.length === 0 ||
    repository === undefined ||
    repository.length === 0
  ) {
    return new GitHubClient(null);
  }
  return new GitHubClient({
    token,
    owner,
    repository,
    baseBranch: env.ADMIN_GITHUB_BASE_BRANCH?.trim() ?? "master",
    publishWorkflow:
      env.ADMIN_GITHUB_PUBLISH_WORKFLOW?.trim() ?? "publish-content-dev.yml",
  });
}
