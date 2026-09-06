import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { draftWriteError, messageOf } from "../../api/draft-conflict";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";
import type { components } from "../../api/generated/admin-api";

export type DraftAsset = components["schemas"]["AdminDraftAsset"];
export type AssetUploadResult =
  components["schemas"]["AdminDraftAssetUploadResult"];
export type AssetLocalizations =
  components["schemas"]["AdminAssetLocalizations"];
export type AssetPatch = components["schemas"]["AdminDraftAssetPatchRequest"];
type DraftDetail = components["schemas"]["AdminDraftDetail"];

export interface AssetUploadFields {
  entityContentKey: string;
  assetType: string;
  variant: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  replacementReason: string;
  validFrom: string;
  validTo: string;
  localizations: AssetLocalizations;
}

/**
 * The draft and its assets are read together. Every asset mutation carries
 * the draft's revision in If-Match — a drawing lives in its own table, but
 * changing one moves the draft it belongs to — so the revision has to be on
 * screen beside the rows it applies to.
 */
export function useDraftWithAssets(draftId: string): {
  draft: DraftDetail | null;
  assets: DraftAsset[] | null;
  error: string | null;
  reload: () => void;
} {
  const client = useAdminApiClient();
  const [draft, setDraft] = useState<DraftDetail | null>(null);
  const [assets, setAssets] = useState<DraftAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      client.GET("/v1/admin/content/drafts/{draftId}", {
        params: { path: { draftId } },
      }),
      client.GET("/v1/admin/content/drafts/{draftId}/assets", {
        params: { path: { draftId } },
      }),
    ])
      .then(([draftResult, assetsResult]) => {
        if (cancelled) {
          return;
        }
        if (draftResult.data === undefined || assetsResult.data === undefined) {
          setError(
            messageOf(
              draftResult.error ?? assetsResult.error,
              "The draft assets could not be loaded",
            ),
          );
          return;
        }
        setError(null);
        setDraft(draftResult.data);
        setAssets(assetsResult.data.items);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "The draft assets failed to load",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  return { draft, assets, error, reload };
}

export function useAssetWriter(draftId: string): {
  upload: (
    revision: number,
    file: File,
    fields: AssetUploadFields,
  ) => Promise<AssetUploadResult>;
  patch: (
    revision: number,
    assetId: string,
    changes: AssetPatch,
  ) => Promise<void>;
  remove: (assetId: string) => Promise<void>;
} {
  const client = useAdminApiClient();
  const config = useRuntimeConfig();

  /**
   * The upload goes through fetch rather than the typed client: the
   * generated client models a JSON body and this endpoint takes multipart.
   * Same origin behind the console's proxy, so the session cookie travels.
   *
   * It carries `If-Match` like every other editorial write. An upload moves
   * the draft it lands in, so a console holding a stale revision has to be
   * refused here too: the one mutation that skipped the check would be the
   * one that silently overwrote a colleague (§9).
   */
  const upload = useCallback(
    async (revision: number, file: File, fields: AssetUploadFields) => {
      const body = new FormData();
      body.set("file", file);
      for (const [key, value] of Object.entries(fields)) {
        if (key === "localizations") {
          continue;
        }
        if (typeof value === "string" && value.trim().length > 0) {
          body.set(key, value.trim());
        }
      }
      // A form field carries text, so the symbol's words travel as JSON in
      // one, exactly as the contract describes.
      if (Object.keys(fields.localizations).length > 0) {
        body.set("localizations", JSON.stringify(fields.localizations));
      }
      const response = await fetch(
        `${config.apiBasePath}/v1/admin/content/drafts/${draftId}/assets`,
        {
          method: "POST",
          credentials: "include",
          headers: { "If-Match": String(revision) },
          body,
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok) {
        throw draftWriteError(payload, "The upload was refused");
      }
      // The answer carries the stored drawing, how far processing has got and
      // the draft's new revision, so the caller never has to re-read the draft
      // to find out what it may write next.
      return payload as AssetUploadResult;
    },
    [config.apiBasePath, draftId],
  );

  const patch = useCallback(
    async (revision: number, assetId: string, changes: AssetPatch) => {
      const { data, error } = await client.PATCH(
        "/v1/admin/content/drafts/{draftId}/assets/{assetId}",
        {
          params: {
            path: { draftId, assetId },
            header: { "If-Match": String(revision) },
          },
          body: changes,
        },
      );
      if (data === undefined) {
        throw draftWriteError(error, "The asset could not be changed");
      }
    },
    [client, draftId],
  );

  // Removal takes no `If-Match`: the contract does not offer one on this
  // route, and inventing a header the server ignores would be a guarantee
  // this console cannot keep.
  const remove = useCallback(
    async (assetId: string) => {
      const { response, error } = await client.DELETE(
        "/v1/admin/content/drafts/{draftId}/assets/{assetId}",
        { params: { path: { draftId, assetId } } },
      );
      if (!response.ok) {
        throw draftWriteError(error, "The asset could not be removed");
      }
    },
    [client, draftId],
  );

  return { upload, patch, remove };
}
