import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useState } from "react";
import { useAdminApiClient } from "../../api/ApiClientContext";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";
import type { components } from "../../api/generated/admin-api";

type DraftAsset = components["schemas"]["AdminDraftAsset"];

const ASSET_TYPES = [
  { id: "FLAG", label: "Flag" },
  { id: "COAT_OF_ARMS", label: "Coat of arms" },
] as const;

interface UploadForm {
  entityContentKey: string;
  assetType: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
  attribution: string;
  replacementReason: string;
}

const EMPTY_FORM: UploadForm = {
  entityContentKey: "",
  assetType: "FLAG",
  sourceUrl: "",
  licenseName: "",
  licenseUrl: "",
  attribution: "",
  replacementReason: "",
};

function messageOf(payload: unknown, fallback: string): string {
  const envelope = payload as { error?: { message?: string } } | undefined;
  return envelope?.error?.message ?? fallback;
}

/**
 * Uploads go through fetch directly rather than the typed client: the
 * generated client models a JSON body, and this endpoint takes multipart.
 * The API is same-origin behind the console's proxy, so the session cookie
 * still travels.
 */
export function DraftAssets({
  draftId,
  editable,
}: {
  draftId: string;
  editable: boolean;
}) {
  const client = useAdminApiClient();
  const config = useRuntimeConfig();
  const [assets, setAssets] = useState<DraftAsset[] | null>(null);
  const [form, setForm] = useState<UploadForm>(EMPTY_FORM);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/v1/admin/content/drafts/{draftId}/assets", {
        params: { path: { draftId } },
      })
      .then(({ data, error: apiError }) => {
        if (cancelled) {
          return;
        }
        if (data === undefined) {
          setError(messageOf(apiError, "The draft assets could not be loaded"));
        } else {
          setAssets(data.items);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("The draft assets could not be loaded");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, draftId, reloadToken]);

  const reload = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  function upload(): void {
    if (file === null) {
      setError("Choose a file first");
      return;
    }
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    for (const [key, value] of Object.entries(form) as [
      keyof UploadForm,
      string,
    ][]) {
      if (value.trim().length > 0) {
        body.set(key, value.trim());
      }
    }
    fetch(`${config.apiBasePath}/v1/admin/content/drafts/${draftId}/assets`, {
      method: "POST",
      credentials: "include",
      body,
    })
      .then(async (response) => {
        setBusy(false);
        if (!response.ok) {
          const payload: unknown = await response.json();
          setError(messageOf(payload, "The upload was refused"));
          return;
        }
        setFile(null);
        setForm(EMPTY_FORM);
        reload();
      })
      .catch(() => {
        setBusy(false);
        setError("The upload could not be sent");
      });
  }

  function remove(assetId: string): void {
    setBusy(true);
    client
      .DELETE("/v1/admin/content/drafts/{draftId}/assets/{assetId}", {
        params: { path: { draftId, assetId } },
      })
      .then(({ response }) => {
        setBusy(false);
        if (!response.ok) {
          setError("The asset could not be removed");
          return;
        }
        reload();
      })
      .catch(() => {
        setBusy(false);
        setError("The asset could not be removed");
      });
  }

  return (
    <Stack spacing={2}>
      <Typography variant="h6" component="h3">
        Replacement assets
      </Typography>
      {error !== null && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Preview</TableCell>
            <TableCell>Entity</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>License</TableCell>
            <TableCell>Reason</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {(assets ?? []).map((asset) => (
            <TableRow key={asset.id} hover>
              <TableCell>
                <Box
                  component="img"
                  alt=""
                  src={`${config.apiBasePath}/v1/admin/content/drafts/${draftId}/assets/${asset.id}/preview`}
                  sx={{
                    height: 28,
                    border: "1px solid",
                    borderColor: "divider",
                  }}
                />
              </TableCell>
              <TableCell>
                <code>{asset.entityContentKey}</code>
              </TableCell>
              <TableCell>{asset.assetType}</TableCell>
              <TableCell>{asset.licenseName ?? "—"}</TableCell>
              <TableCell>{asset.replacementReason ?? "—"}</TableCell>
              <TableCell align="right">
                {editable && (
                  <Button
                    size="small"
                    color="error"
                    disabled={busy}
                    onClick={() => remove(asset.id)}
                  >
                    Remove
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
          {assets !== null && assets.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <Typography variant="body2" color="text.secondary">
                  No replacements in this draft. The catalog keeps publishing
                  the upstream drawings.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {editable && (
        <Stack spacing={2} sx={{ maxWidth: 640 }}>
          <Typography variant="subtitle2">Upload a replacement</Typography>
          <Button component="label" variant="outlined" size="small">
            {file === null ? "Choose an SVG or PNG" : file.name}
            <input
              type="file"
              hidden
              accept="image/svg+xml,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Button>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Entity key"
              size="small"
              helperText="For example country.france"
              value={form.entityContentKey}
              onChange={(event) =>
                setForm({ ...form, entityContentKey: event.target.value })
              }
              sx={{ flex: 1 }}
            />
            <TextField
              select
              label="Asset type"
              size="small"
              value={form.assetType}
              onChange={(event) =>
                setForm({ ...form, assetType: event.target.value })
              }
              sx={{ minWidth: 180 }}
            >
              {ASSET_TYPES.map((type) => (
                <MenuItem key={type.id} value={type.id}>
                  {type.label}
                </MenuItem>
              ))}
            </TextField>
          </Stack>
          <TextField
            label="Source URL"
            size="small"
            value={form.sourceUrl}
            onChange={(event) =>
              setForm({ ...form, sourceUrl: event.target.value })
            }
          />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="License"
              size="small"
              value={form.licenseName}
              onChange={(event) =>
                setForm({ ...form, licenseName: event.target.value })
              }
              sx={{ flex: 1 }}
            />
            <TextField
              label="Attribution"
              size="small"
              value={form.attribution}
              onChange={(event) =>
                setForm({ ...form, attribution: event.target.value })
              }
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField
            label="Why replace the upstream drawing?"
            size="small"
            multiline
            minRows={2}
            value={form.replacementReason}
            onChange={(event) =>
              setForm({ ...form, replacementReason: event.target.value })
            }
            helperText="Travels into the proposal and the audit trail."
          />
          <Box>
            <Button variant="contained" disabled={busy} onClick={upload}>
              Upload
            </Button>
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
