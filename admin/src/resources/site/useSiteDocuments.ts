import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import type { components } from "../../api/generated/admin-api";

export type SiteStatus = components["schemas"]["AdminSiteStatus"];
export type SiteDocumentSummary =
  components["schemas"]["AdminSiteDocumentSummary"];
export type SiteDocumentDetail =
  components["schemas"]["AdminSiteDocumentDetail"];
export type SiteDocumentVersion =
  components["schemas"]["AdminSiteDocumentVersion"];
export type SiteDocumentVersionDetail =
  components["schemas"]["AdminSiteDocumentVersionDetail"];

/** What the server said, kept whole so a conflict can show its details. */
export class SiteApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "SiteApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function toSiteApiError(
  status: number,
  error: unknown,
  fallback: string,
): SiteApiError {
  const envelope = error as
    | {
        error?: {
          code?: string;
          message?: string;
          details?: Record<string, unknown>;
        };
      }
    | undefined;
  return new SiteApiError(
    status,
    envelope?.error?.code ?? "UNKNOWN",
    envelope?.error?.message ?? fallback,
    envelope?.error?.details ?? {},
  );
}

/**
 * One read, one reload. Every read on these screens has the same shape —
 * loading, loaded, failed, read again — so it is written once rather than
 * per endpoint (the commerce hooks are the same idea, spelled out).
 */
function useLoadable<T>(
  load: (signal: { cancelled: boolean }) => Promise<T>,
  dependencies: readonly unknown[],
): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal).then(
      (loaded) => {
        if (!signal.cancelled) {
          setError(null);
          setData(loaded);
        }
      },
      (cause: unknown) => {
        if (!signal.cancelled) {
          setError(cause instanceof Error ? cause.message : "Loading failed");
        }
      },
    );
    return () => {
      signal.cancelled = true;
    };
    // The caller's dependencies decide when to read again; `load` itself
    // is a fresh closure every render and must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { data, error, reload };
}

export function useSiteStatus(): {
  status: SiteStatus | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const { data, error, reload } = useLoadable(async () => {
    const { data, response, error } = await client.GET(
      "/v1/admin/site/status",
      {},
    );
    if (data === undefined) {
      throw toSiteApiError(
        response.status,
        error,
        "The site status is unavailable",
      );
    }
    return data;
  }, [client]);
  return { status: data, error, reload };
}

export function useSiteDocuments(): {
  documents: SiteDocumentSummary[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const { data, error, reload } = useLoadable(async () => {
    const { data, response, error } = await client.GET(
      "/v1/admin/site/documents",
      {},
    );
    if (data === undefined) {
      throw toSiteApiError(
        response.status,
        error,
        "The documents could not be loaded",
      );
    }
    return data.items;
  }, [client]);
  return { documents: data, error, reload };
}

export function useSiteDocument(
  slug: string,
  locale: string,
): {
  document: SiteDocumentDetail | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const { data, error, reload } = useLoadable(async () => {
    const { data, response, error } = await client.GET(
      "/v1/admin/site/documents/{slug}/{locale}",
      { params: { path: { slug, locale } } },
    );
    if (data === undefined) {
      throw toSiteApiError(
        response.status,
        error,
        "The document could not be loaded",
      );
    }
    return data;
  }, [client, slug, locale]);
  return { document: data, error, reload };
}

export function useSiteDocumentVersions(
  slug: string,
  locale: string,
): {
  versions: SiteDocumentVersion[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const { data, error, reload } = useLoadable(async () => {
    const { data, response, error } = await client.GET(
      "/v1/admin/site/documents/{slug}/{locale}/versions",
      { params: { path: { slug, locale } } },
    );
    if (data === undefined) {
      throw toSiteApiError(
        response.status,
        error,
        "The versions could not be loaded",
      );
    }
    return data.items;
  }, [client, slug, locale]);
  return { versions: data, error, reload };
}

/**
 * Every write the console can make to a site document. The server enforces
 * the roles and the revision; a refusal is surfaced with its code so the
 * editor can tell a stale draft from a missing permission.
 */
export function useSiteDocumentWriter(): {
  create: (input: {
    slug: string;
    locale: string;
    title: string;
  }) => Promise<SiteDocumentDetail>;
  preview: (body: string) => Promise<string>;
  save: (
    slug: string,
    locale: string,
    revision: number,
    changes: { title?: string; body?: string },
  ) => Promise<SiteDocumentDetail>;
  publish: (
    slug: string,
    locale: string,
    revision: number,
    note: string,
  ) => Promise<SiteDocumentDetail>;
  unpublish: (slug: string, locale: string) => Promise<SiteDocumentDetail>;
  remove: (slug: string, locale: string) => Promise<void>;
  restore: (
    slug: string,
    locale: string,
    version: number,
    revision: number,
  ) => Promise<SiteDocumentDetail>;
} {
  const client = useAdminApiClient();

  const create = useCallback(
    async (input: {
      slug: string;
      locale: string;
      title: string;
    }): Promise<SiteDocumentDetail> => {
      const { data, response, error } = await client.POST(
        "/v1/admin/site/documents",
        {
          body: {
            slug: input.slug.trim(),
            locale: input.locale.trim(),
            title: input.title.trim(),
          },
        },
      );
      if (data === undefined) {
        throw toSiteApiError(
          response.status,
          error,
          "The document was not created",
        );
      }
      return data;
    },
    [client],
  );

  const preview = useCallback(
    async (body: string): Promise<string> => {
      const { data, response, error } = await client.POST(
        "/v1/admin/site/documents/preview",
        { body: { body } },
      );
      if (data === undefined) {
        throw toSiteApiError(
          response.status,
          error,
          "The preview could not be rendered",
        );
      }
      return data.html;
    },
    [client],
  );

  const save = useCallback(
    async (
      slug: string,
      locale: string,
      revision: number,
      changes: { title?: string; body?: string },
    ): Promise<SiteDocumentDetail> => {
      const { data, response, error } = await client.PATCH(
        "/v1/admin/site/documents/{slug}/{locale}",
        {
          params: { path: { slug, locale } },
          body: { revision, ...changes },
        },
      );
      if (data === undefined) {
        throw toSiteApiError(response.status, error, "The draft was not saved");
      }
      return data;
    },
    [client],
  );

  const publish = useCallback(
    async (
      slug: string,
      locale: string,
      revision: number,
      note: string,
    ): Promise<SiteDocumentDetail> => {
      const trimmed = note.trim();
      const { data, response, error } = await client.POST(
        "/v1/admin/site/documents/{slug}/{locale}/publish",
        {
          params: { path: { slug, locale } },
          body: { revision, ...(trimmed === "" ? {} : { note: trimmed }) },
        },
      );
      if (data === undefined) {
        throw toSiteApiError(
          response.status,
          error,
          "The document was not published",
        );
      }
      return data;
    },
    [client],
  );

  const unpublish = useCallback(
    async (slug: string, locale: string): Promise<SiteDocumentDetail> => {
      const { data, response, error } = await client.POST(
        "/v1/admin/site/documents/{slug}/{locale}/unpublish",
        { params: { path: { slug, locale } } },
      );
      if (data === undefined) {
        throw toSiteApiError(
          response.status,
          error,
          "The document is still published",
        );
      }
      return data;
    },
    [client],
  );

  const remove = useCallback(
    async (slug: string, locale: string): Promise<void> => {
      const { response, error } = await client.DELETE(
        "/v1/admin/site/documents/{slug}/{locale}",
        { params: { path: { slug, locale } } },
      );
      if (!response.ok) {
        throw toSiteApiError(
          response.status,
          error,
          "The document was not deleted",
        );
      }
    },
    [client],
  );

  const restore = useCallback(
    async (
      slug: string,
      locale: string,
      version: number,
      revision: number,
    ): Promise<SiteDocumentDetail> => {
      const { data, response, error } = await client.POST(
        "/v1/admin/site/documents/{slug}/{locale}/versions/{version}/restore",
        {
          params: { path: { slug, locale, version } },
          body: { revision },
        },
      );
      if (data === undefined) {
        throw toSiteApiError(
          response.status,
          error,
          "The version was not restored",
        );
      }
      return data;
    },
    [client],
  );

  return { create, preview, save, publish, unpublish, remove, restore };
}

/** Where a published document is read, when the deployment knows its site. */
export function sitePageUrl(
  status: SiteStatus | null,
  slug: string,
  locale: string,
): string | null {
  const siteUrl = status?.siteUrl ?? null;
  if (siteUrl === null) {
    return null;
  }
  return `${siteUrl.replace(/\/+$/, "")}/${slug}?lang=${encodeURIComponent(locale)}`;
}
