import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

export type CommerceStatus = components["schemas"]["AdminCommerceStatus"];
export type Entitlement = components["schemas"]["AdminEntitlement"];
export type CommerceOffer = components["schemas"]["AdminCommerceOffer"];
export type StoreProduct = components["schemas"]["AdminStoreProduct"];
export type StoreSyncRun = components["schemas"]["AdminStoreSyncRun"];
export type StoreTransaction = components["schemas"]["AdminStoreTransaction"];

function messageOf(error: unknown, fallback: string): string {
  const envelope = error as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

/**
 * The store this deployment talks to, and whether the storefront is whole.
 *
 * Every commerce screen shows the answer, because mapping a Sandbox product
 * while looking at production is the mistake this section exists to prevent
 * (docs/17 §12.2).
 */
export function useCommerceStatus(): {
  status: CommerceStatus | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [status, setStatus] = useState<CommerceStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/commerce/status", {})
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The storefront status is unavailable"));
        } else {
          setError(null);
          setStatus(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The storefront status failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  // Re-reading is a token bump rather than a second fetch path: one place
  // owns the request, and the caller cannot start an unmanaged one.
  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { status, error, reload };
}

export function useEntitlements(): {
  entitlements: Entitlement[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [entitlements, setEntitlements] = useState<Entitlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/commerce/entitlements", {})
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The entitlements could not be loaded"));
        } else {
          setError(null);
          setEntitlements(data.items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The entitlements failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { entitlements, error, reload };
}

export function useOffers(): {
  offers: CommerceOffer[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [offers, setOffers] = useState<CommerceOffer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/commerce/offers", {})
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The offers could not be loaded"));
        } else {
          setError(null);
          setOffers(data.items);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The offers failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { offers, error, reload };
}

export function useOffer(offerId: string): {
  offer: CommerceOffer | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [offer, setOffer] = useState<CommerceOffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/commerce/offers/{offerId}", {
        params: { path: { offerId } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The offer could not be loaded"));
        } else {
          setError(null);
          setOffer(data);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error ? cause.message : "The offer failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, offerId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { offer, error, reload };
}

/**
 * Every write the console is allowed to make.
 *
 * None of them creates an in-app purchase and none of them carries a price:
 * the store owns both, and the App Store Connect key belongs to a job rather
 * than to this browser (docs/17 §12.4). The server refuses what a role may
 * not do, so a failure here is shown rather than prevented.
 */
export function useCommerceWriter(): {
  createEntitlement: (key: string, description: string) => Promise<void>;
  createOffer: (code: string, grants: string[]) => Promise<CommerceOffer>;
  setOfferStatus: (
    offerId: string,
    status: "DRAFT" | "ACTIVE" | "RETIRED",
  ) => Promise<void>;
  setOfferGrants: (offerId: string, grants: string[]) => Promise<void>;
  mapProduct: (
    offerId: string,
    product: {
      provider: "APPLE_APP_STORE" | "GOOGLE_PLAY" | "WEB";
      storeEnvironment: "LOCAL_TEST" | "SANDBOX" | "PRODUCTION";
      bundleId: string;
      productId: string;
    },
  ) => Promise<void>;
  setProductStatus: (
    productId: string,
    status: "DRAFT" | "VALIDATED" | "ACTIVE" | "RETIRED" | "INVALID",
  ) => Promise<void>;
  startStoreSync: () => Promise<StoreSyncRun>;
  readTransaction: (transactionId: string) => Promise<StoreTransaction>;
} {
  const client = useAdminApiClient();

  const createEntitlement = useCallback(
    async (key: string, description: string): Promise<void> => {
      const trimmed = description.trim();
      const { data, error } = await client.POST(
        "/v1/admin/commerce/entitlements",
        {
          body: {
            key: key.trim(),
            ...(trimmed === "" ? {} : { description: trimmed }),
          },
        },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The entitlement was not created"));
      }
    },
    [client],
  );

  const createOffer = useCallback(
    async (code: string, grants: string[]): Promise<CommerceOffer> => {
      const { data, error } = await client.POST("/v1/admin/commerce/offers", {
        body: { code: code.trim(), grants },
      });
      if (data === undefined) {
        throw new Error(messageOf(error, "The offer was not created"));
      }
      return data;
    },
    [client],
  );

  const setOfferStatus = useCallback(
    async (
      offerId: string,
      status: "DRAFT" | "ACTIVE" | "RETIRED",
    ): Promise<void> => {
      const { data, error } = await client.PATCH(
        "/v1/admin/commerce/offers/{offerId}",
        { params: { path: { offerId } }, body: { status } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The offer did not change"));
      }
    },
    [client],
  );

  const setOfferGrants = useCallback(
    async (offerId: string, grants: string[]): Promise<void> => {
      const { data, error } = await client.PATCH(
        "/v1/admin/commerce/offers/{offerId}",
        { params: { path: { offerId } }, body: { grants } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The grants did not change"));
      }
    },
    [client],
  );

  const mapProduct = useCallback(
    async (
      offerId: string,
      product: {
        provider: "APPLE_APP_STORE" | "GOOGLE_PLAY" | "WEB";
        storeEnvironment: "LOCAL_TEST" | "SANDBOX" | "PRODUCTION";
        bundleId: string;
        productId: string;
      },
    ): Promise<void> => {
      const { data, error } = await client.POST(
        "/v1/admin/commerce/offers/{offerId}/products",
        {
          params: { path: { offerId } },
          body: {
            provider: product.provider,
            storeEnvironment: product.storeEnvironment,
            bundleId: product.bundleId.trim(),
            productId: product.productId.trim(),
          },
        },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The product was not mapped"));
      }
    },
    [client],
  );

  const setProductStatus = useCallback(
    async (
      productId: string,
      status: "DRAFT" | "VALIDATED" | "ACTIVE" | "RETIRED" | "INVALID",
    ): Promise<void> => {
      const { data, error } = await client.PATCH(
        "/v1/admin/commerce/products/{productId}",
        { params: { path: { productId } }, body: { status } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The product did not change"));
      }
    },
    [client],
  );

  const startStoreSync = useCallback(async (): Promise<StoreSyncRun> => {
    const { data, error } = await client.POST(
      "/v1/admin/commerce/store-sync-runs",
      {},
    );
    if (data === undefined) {
      throw new Error(messageOf(error, "The sync did not start"));
    }
    return data;
  }, [client]);

  const readTransaction = useCallback(
    async (transactionId: string): Promise<StoreTransaction> => {
      const { data, error } = await client.GET(
        "/v1/admin/commerce/transactions/{transactionId}",
        { params: { path: { transactionId: transactionId.trim() } } },
      );
      if (data === undefined) {
        throw new Error(messageOf(error, "The transaction could not be read"));
      }
      return data;
    },
    [client],
  );

  return {
    createEntitlement,
    createOffer,
    setOfferStatus,
    setOfferGrants,
    mapProduct,
    setProductStatus,
    startStoreSync,
    readTransaction,
  };
}
