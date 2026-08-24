import { createGitHubClient, GitHubClient } from "./github-client";

function envelopeOf(thrown: unknown): { code: string; message: string } {
  const response = (thrown as { getResponse?: () => unknown }).getResponse?.();
  const envelope = (response as { error?: { code: string; message: string } })
    ?.error;
  if (envelope === undefined) {
    throw thrown;
  }
  return envelope;
}

describe("createGitHubClient", () => {
  const complete = {
    ADMIN_GITHUB_TOKEN: "token",
    ADMIN_GITHUB_OWNER: "dudeinhoodie",
    ADMIN_GITHUB_REPOSITORY: "country-flags",
  };

  it("is configured only when the whole credential is present", () => {
    expect(createGitHubClient(complete).isConfigured).toBe(true);
    expect(createGitHubClient({}).isConfigured).toBe(false);
    expect(
      createGitHubClient({ ...complete, ADMIN_GITHUB_TOKEN: "  " })
        .isConfigured,
    ).toBe(false);
    expect(
      createGitHubClient({ ...complete, ADMIN_GITHUB_OWNER: undefined })
        .isConfigured,
    ).toBe(false);
  });

  it("names the way out instead of failing as a server error", async () => {
    const client = new GitHubClient(null);
    try {
      await client.openDraftPullRequest("branch", "title", "body");
      throw new Error("expected the call to refuse");
    } catch (thrown) {
      const envelope = envelopeOf(thrown);
      expect(envelope.code).toBe("GITHUB_NOT_CONFIGURED");
      expect(envelope.message).toMatch(/by hand/);
    }
  });
});
