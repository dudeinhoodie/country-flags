import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientProvider } from "../src/api/ApiClientContext";
import { createAdminApiClient } from "../src/api/client";
import { RuntimeConfigProvider } from "../src/config/RuntimeConfigContext";
import { EntitlementsPage } from "../src/resources/commerce/EntitlementsPage";
import { OfferDetail } from "../src/resources/commerce/OfferDetail";
import { OffersPage } from "../src/resources/commerce/OffersPage";
import { StoreSyncPage } from "../src/resources/commerce/StoreSyncPage";
import type { RuntimeConfig } from "../src/config/runtime-config";

const session = vi.hoisted(() => ({ permissions: "PUBLISHER" }));

vi.mock("react-admin", () => ({
  Title: () => null,
  usePermissions: () => ({ permissions: session.permissions }),
}));

const config: RuntimeConfig = {
  environment: "dev",
  apiBasePath: "/api",
  googleClientId: "",
  appVersion: "abc1234",
};

const OFFER_ID = "0f8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d10";
const PRODUCT_ID = "1a8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d11";
const TRANSACTION_ID = "2b8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d12";

const status = {
  storeEnvironment: "SANDBOX",
  activeOfferCount: 1,
  offersWithoutValidatedProduct: 0,
  lastReconciliationAt: "2026-09-04T12:20:00Z",
  lastReconciliationError: null,
};

const product = {
  id: PRODUCT_ID,
  provider: "APPLE_APP_STORE",
  storeEnvironment: "SANDBOX",
  bundleId: "app.countryflags.mobile.dev",
  productId: "app.countryflags.deck.european_coats.lifetime.v1",
  productType: "NON_CONSUMABLE",
  status: "VALIDATED",
  storeStatus: "Ready to submit",
  lastValidatedAt: "2026-09-04T12:20:00Z",
  validationError: null,
};

const offer = {
  id: OFFER_ID,
  code: "EUROPEAN_COATS_LIFETIME",
  kind: "ONE_TIME",
  status: "DRAFT",
  sortOrder: null,
  notes: null,
  grants: ["entitlement.european_coats"],
  localizations: {},
  products: [product],
};

type FetchInput = Request | string;

function stubApi(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn((input: FetchInput) => {
    const url = typeof input === "string" ? input : input.url;
    const method = typeof input === "string" ? "GET" : input.method;
    if (url.endsWith("/commerce/status")) {
      return Promise.resolve(Response.json(status));
    }
    if (url.endsWith("/commerce/entitlements")) {
      return Promise.resolve(
        Response.json({
          items: [
            {
              key: "entitlement.european_coats",
              status: "ACTIVE",
              description: null,
              deckCodes: ["EUROPEAN_COATS"],
            },
            {
              key: "entitlement.african_flags",
              status: "ACTIVE",
              description: null,
              deckCodes: [],
            },
          ],
          total: 2,
        }),
      );
    }
    if (url.endsWith("/commerce/offers") && method === "GET") {
      return Promise.resolve(Response.json({ items: [offer], total: 1 }));
    }
    if (url.endsWith(`/commerce/offers/${OFFER_ID}`) && method === "GET") {
      return Promise.resolve(Response.json(offer));
    }
    if (url.endsWith(`/commerce/transactions/${TRANSACTION_ID}`)) {
      return Promise.resolve(
        Response.json({
          id: TRANSACTION_ID,
          provider: "APPLE_APP_STORE",
          storeEnvironment: "SANDBOX",
          maskedTransactionId: "****5678",
          productId: product.productId,
          claimState: "CLAIMED",
          ownershipType: "PURCHASED",
          purchasedAt: "2026-09-04T12:20:00Z",
          revokedAt: null,
          revocationReason: null,
          grantedEntitlementKeys: ["entitlement.european_coats"],
        }),
      );
    }
    if (url.endsWith("/commerce/store-sync-runs") && method === "POST") {
      return Promise.resolve(
        Response.json(
          {
            id: "3c8f1f76-1f0a-4a2e-9a5e-2b8f4f1c9d13",
            status: "QUEUED",
            startedAt: "2026-09-05T10:00:00Z",
            finishedAt: null,
            checkedProductCount: null,
            failureMessage: null,
          },
          { status: 202 },
        ),
      );
    }
    if (method === "PATCH") {
      return Promise.resolve(Response.json(offer));
    }
    if (method === "POST") {
      return Promise.resolve(Response.json(product, { status: 201 }));
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

async function sentBy(
  fetchMock: ReturnType<typeof vi.fn>,
  method: string,
): Promise<Request> {
  return vi.waitFor(() => {
    const sent = requestsTo(fetchMock).find(
      (request) => request.method === method,
    );
    if (sent === undefined) {
      throw new Error(`No ${method} was sent`);
    }
    return sent;
  });
}

function renderAt(path: string, element: React.ReactNode): void {
  render(
    <RuntimeConfigProvider config={config}>
      <ApiClientProvider client={createAdminApiClient(config.apiBasePath)}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/commerce/offers" element={element} />
            <Route path="/commerce/offers/:offerId" element={element} />
            <Route path="/commerce/entitlements" element={element} />
            <Route path="/commerce/sync" element={element} />
          </Routes>
        </MemoryRouter>
      </ApiClientProvider>
    </RuntimeConfigProvider>,
  );
}

describe("the commerce section", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    session.permissions = "PUBLISHER";
  });

  /// Two badges on every screen: which deployment, and which store answers
  /// it. Mapping a Sandbox product while looking at production is the
  /// mistake this section exists to prevent.
  it("says which store it is looking at, and never what anything costs", async () => {
    stubApi();
    renderAt("/commerce/offers", <OffersPage />);

    expect(await screen.findByText("store SANDBOX")).toBeInTheDocument();
    expect(screen.getByText("DEV")).toBeInTheDocument();
    expect(await screen.findByText("EUROPEAN_COATS_LIFETIME")).toBeVisible();
    expect(screen.queryByLabelText(/price/i)).toBeNull();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("lets a VIEWER read the offers and draft nothing", async () => {
    session.permissions = "VIEWER";
    stubApi();
    renderAt("/commerce/offers", <OffersPage />);

    expect(await screen.findByText("EUROPEAN_COATS_LIFETIME")).toBeVisible();
    expect(screen.getByRole("button", { name: "Draft offer" })).toBeDisabled();
    expect(
      screen.getByText(/Drafting one needs the EDITOR role/),
    ).toBeInTheDocument();
  });

  it("maps a product into the store the console is actually looking at", async () => {
    const fetchMock = stubApi();
    renderAt(`/commerce/offers/${OFFER_ID}`, <OfferDetail />);

    fireEvent.change(await screen.findByLabelText("Bundle id"), {
      target: { value: "app.countryflags.mobile.dev" },
    });
    fireEvent.change(screen.getByLabelText("Product id"), {
      target: { value: "app.countryflags.deck.african_flags.lifetime.v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Map product" }));

    const sent = await sentBy(fetchMock, "POST");
    expect(sent.url).toContain(`/commerce/offers/${OFFER_ID}/products`);
    const body = (await sent.json()) as Record<string, unknown>;
    // The environment is taken from the server's answer, never typed in.
    expect(body.storeEnvironment).toBe("SANDBOX");
    expect(body.provider).toBe("APPLE_APP_STORE");
    expect(body).not.toHaveProperty("price");
  });

  /// Withdrawing a listing is not the same as taking access away: §2.4 says
  /// an owner keeps what they bought when a product leaves the store.
  it("removes a listing from sale without touching what anyone owns", async () => {
    const fetchMock = stubApi();
    renderAt(`/commerce/offers/${OFFER_ID}`, <OfferDetail />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove from sale" }),
    );

    const sent = await sentBy(fetchMock, "PATCH");
    expect(sent.url).toContain(`/commerce/products/${PRODUCT_ID}`);
    expect(await sent.json()).toEqual({ status: "RETIRED" });
  });

  it("offers a re-check only to an ADMIN, because the key is a job's", async () => {
    stubApi();
    renderAt(`/commerce/offers/${OFFER_ID}`, <OfferDetail />);

    expect(
      await screen.findByRole("button", { name: "Re-check" }),
    ).toBeDisabled();
  });

  it("shows a support agent a masked identifier and no receipt", async () => {
    session.permissions = "ADMIN";
    const fetchMock = stubApi();
    renderAt("/commerce/sync", <StoreSyncPage />);

    fireEvent.change(await screen.findByLabelText("Transaction record id"), {
      target: { value: TRANSACTION_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("****5678")).toBeInTheDocument();
    expect(screen.getByText("entitlement.european_coats")).toBeInTheDocument();
    // Nothing on the page is the store's own identifier.
    expect(screen.queryByText(/2000000/)).toBeNull();
    expect(requestsTo(fetchMock).some((r) => r.method === "DELETE")).toBe(
      false,
    );
  });

  it("declares an entitlement in its own namespace and refuses anything else", async () => {
    const fetchMock = stubApi();
    renderAt("/commerce/entitlements", <EntitlementsPage />);

    const key = await screen.findByLabelText("New entitlement key");
    fireEvent.change(key, { target: { value: "deck.european_coats" } });
    expect(
      screen.getByText("A key looks like entitlement.european_coats"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Declare" })).toBeDisabled();

    fireEvent.change(key, { target: { value: "entitlement.state_flags" } });
    fireEvent.click(screen.getByRole("button", { name: "Declare" }));

    const sent = await sentBy(fetchMock, "POST");
    expect(sent.url).toContain("/commerce/entitlements");
    expect(await sent.json()).toEqual({ key: "entitlement.state_flags" });
  });
});
