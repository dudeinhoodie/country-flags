import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import { ReleasesPage } from "../src/resources/releases/ReleasesPage";
import type { AdminEnvironment } from "../src/config/runtime-config";
import type { RuntimeConfig } from "../src/config/runtime-config";

const session = vi.hoisted(() => ({ permissions: "PUBLISHER" }));

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: session.permissions }),
}));

function configFor(environment: AdminEnvironment): RuntimeConfig {
  return {
    environment,
    apiBasePath: "/api",
    googleClientId: "",
    appVersion: "abc1234",
    features: {},
  };
}

const RUN_ID = "6f2f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d20";

const releases = {
  activeVersion: "2026.09.01",
  releases: [
    {
      version: "2026.09.01",
      status: "PUBLISHED",
      isActive: true,
      publishedAt: "2026-09-01T09:00:00Z",
      retiredAt: null,
    },
    {
      version: "2026.08.20",
      status: "RETIRED",
      isActive: false,
      publishedAt: "2026-08-20T09:00:00Z",
      retiredAt: "2026-09-01T09:00:00Z",
    },
  ],
};

interface RunState {
  activeVersion: string | null;
  executorConfigured: boolean;
  current: Record<string, unknown> | null;
  last: Record<string, unknown> | null;
}

const idle: RunState = {
  activeVersion: "2026.09.01",
  executorConfigured: true,
  current: null,
  last: null,
};

type FetchInput = Request | string;

function stubApi(state: RunState = idle): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: FetchInput) => {
    const url = typeof input === "string" ? input : input.url;
    const method = typeof input === "string" ? "GET" : input.method;
    if (url.endsWith("/content/releases/runs") && method === "GET") {
      return Promise.resolve(Response.json(state));
    }
    if (url.endsWith("/content/releases") && method === "GET") {
      return Promise.resolve(Response.json(releases));
    }
    if (url.endsWith("/content/status")) {
      return Promise.resolve(
        Response.json({
          activeVersion: "2026.09.01",
          schemaVersion: 1,
          publishedAt: "2026-09-01T09:00:00Z",
          minimumClientVersion: "0.1.0",
          entityCount: 278,
          deckCount: 7,
        }),
      );
    }
    if (method === "POST") {
      return Promise.resolve(
        Response.json(
          {
            id: RUN_ID,
            kind: url.endsWith("/rollback") ? "ROLLBACK" : "PUBLISH",
            status: "QUEUED",
            contentVersion: "2026.08.20",
            minimumClientVersion: null,
            previousVersion: "2026.09.01",
            stage: null,
            failure: null,
            executionName: null,
            requestedByAdminUserId: "7f2f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d21",
            createdAt: "2026-09-06T10:00:00Z",
            startedAt: null,
            finishedAt: null,
          },
          { status: 202 },
        ),
      );
    }
    return Promise.resolve(Response.json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestsTo(fetchMock: ReturnType<typeof vi.fn>): Request[] {
  return fetchMock.mock.calls
    .map((call) => (call as [FetchInput])[0])
    .filter((input): input is Request => input instanceof Request);
}

function renderAt(environment: AdminEnvironment): void {
  const config = configFor(environment);
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={createAdminApiClient(config.apiBasePath)}>
        <MemoryRouter initialEntries={["/releases"]}>
          <Routes>
            <Route path="/releases" element={<ReleasesPage />} />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

describe("the releases screen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    session.permissions = "PUBLISHER";
  });

  it("says what is live and what may be returned to", async () => {
    stubApi();
    renderAt("dev");

    // The live version is said more than once on purpose — in the header,
    // in the publish copy and in the table — so this asks that it is there
    // rather than that it is there exactly once.
    expect((await screen.findAllByText("2026.09.01")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("live")).toBeVisible();
    expect(screen.getByText("2026.08.20")).toBeVisible();
  });

  /// The lever this whole screen exists for: until now a rollback meant a
  /// CLI and a database URL, at the moment nobody wants to look for either.
  it("queues a rollback to a release this deployment published", async () => {
    const fetchMock = stubApi();
    renderAt("dev");

    fireEvent.mouseDown(await screen.findByLabelText("Return to"));
    fireEvent.click(
      await screen.findByRole("option", { name: /2026\.08\.20/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));
    // The confirmation, then the run.
    fireEvent.click(await screen.findByRole("button", { name: "Roll back" }));

    const sent = await vi.waitFor(() => {
      const request = requestsTo(fetchMock).find(
        (candidate) =>
          candidate.method === "POST" && candidate.url.endsWith("/rollback"),
      );
      if (request === undefined) {
        throw new Error("No rollback was requested");
      }
      return request;
    });
    expect(await sent.json()).toEqual({ toVersion: "2026.08.20" });
  });

  /// Production asks for the version to be typed out. The difference between
  /// the release meant and the one beside it in a list is one click, and the
  /// cost of getting it wrong is what every client reads.
  it("refuses to act in production until the version is typed back", async () => {
    stubApi();
    renderAt("prod");

    fireEvent.mouseDown(await screen.findByLabelText("Return to"));
    fireEvent.click(
      await screen.findByRole("option", { name: /2026\.08\.20/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    const confirm = await screen.findByRole("button", { name: "Roll back" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("confirmation phrase"), {
      target: { value: "2026.08.20" },
    });
    expect(confirm).toBeEnabled();
  });

  /// A deployment with no job is a normal state, not a broken one — but a
  /// run queued into nothing looks exactly like a slow one unless it says so.
  it("says when nothing is draining the queue", async () => {
    stubApi({ ...idle, executorConfigured: false });
    renderAt("dev");

    expect(await screen.findByText(/no publisher job/i)).toBeVisible();
  });

  /// Watching a release is not the same permission as starting one.
  it("shows a viewer the state without the levers", async () => {
    session.permissions = "VIEWER";
    stubApi();
    renderAt("dev");

    expect(await screen.findByText("Published releases")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Roll back" })).toBeNull();
  });
});
