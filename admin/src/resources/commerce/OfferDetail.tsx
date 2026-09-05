import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useParams } from "react-router-dom";
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { CommerceHeader, NoPriceHere } from "./CommerceHeader";
import {
  useCommerceStatus,
  useCommerceWriter,
  useEntitlements,
  useOffer,
} from "./useCommerce";
import type { CommerceStatus, StoreProduct } from "./useCommerce";

// App Store Connect addresses an app by a numeric id we deliberately do not
// store: the mapping this console owns is product id to entitlement, and an
// app id would be a second copy of something Apple already knows. So the
// link opens the app list and the product id sits beside it to be matched.
const APP_STORE_CONNECT_URL = "https://appstoreconnect.apple.com/apps";

function canPublish(permissions: unknown): boolean {
  return permissions === "PUBLISHER" || permissions === "ADMIN";
}

function canSync(permissions: unknown): boolean {
  return permissions === "ADMIN";
}

function fieldRow(
  label: string,
  value: string,
): { label: string; value: string } {
  return { label, value };
}

function storeStateOf(product: StoreProduct): string {
  if (
    product.validationError !== null &&
    product.validationError !== undefined
  ) {
    return `${product.status} — ${product.validationError}`;
  }
  return product.storeStatus === null || product.storeStatus === undefined
    ? product.status
    : `${product.status} / ${product.storeStatus}`;
}

function belongsHere(
  product: StoreProduct,
  status: CommerceStatus | null,
): boolean {
  return (
    status !== null && product.storeEnvironment === status.storeEnvironment
  );
}

/**
 * One offer: what it grants, and what sells it (docs/17 §12.2).
 *
 * `Re-check` asks the store what it knows; it does not create an in-app
 * purchase and it cannot change a price. `Remove from sale` withdraws the
 * listing and leaves every existing owner's access standing, because access
 * is a grant that was already made rather than a product that is still
 * listed.
 */
export function OfferDetail() {
  const { offerId } = useParams();
  const { permissions } = usePermissions<string>();
  const { status } = useCommerceStatus();
  const { offer, error, reload } = useOffer(offerId ?? "");
  const { entitlements } = useEntitlements();
  const {
    setOfferStatus,
    setOfferGrants,
    mapProduct,
    setProductStatus,
    startStoreSync,
  } = useCommerceWriter();

  const [bundleId, setBundleId] = useState("");
  const [productId, setProductId] = useState("");
  const [grant, setGrant] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const publisher = canPublish(permissions);
  const syncing = canSync(permissions);

  function run(work: Promise<unknown>, done: string): void {
    setBusy(true);
    setActionError(null);
    work
      .then(() => {
        setNotice(done);
        reload();
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error ? cause.message : "The change was refused",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  }

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }
  if (offer === null) {
    return <LoadingState label="Loading the offer…" />;
  }

  const here = offer.products.filter((product) => belongsHere(product, status));
  const elsewhere = offer.products.filter(
    (product) => !belongsHere(product, status),
  );
  const primary = here[0];
  const facts = [
    fieldRow(
      "Type",
      offer.kind === "ONE_TIME" ? "One-time purchase" : offer.kind,
    ),
    fieldRow("Grants", offer.grants.join(", ")),
    fieldRow("Store product", primary?.productId ?? "not mapped in this store"),
    fieldRow("Bundle", primary?.bundleId ?? "—"),
    fieldRow("Store type", primary?.productType ?? "—"),
    fieldRow(
      "Store state",
      primary === undefined ? "—" : storeStateOf(primary),
    ),
    fieldRow(
      "Last sync",
      primary?.lastValidatedAt === null ||
        primary?.lastValidatedAt === undefined
        ? "never"
        : new Date(primary.lastValidatedAt).toISOString(),
    ),
  ];

  return (
    <Card sx={{ mt: 2 }}>
      <Title title={`Offer ${offer.code}`} />
      <CardContent>
        <Stack spacing={2}>
          <CommerceHeader title={offer.code} status={status} />
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <StatusChip value={offer.status} />
            {here.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                nothing in this store sells it yet
              </Typography>
            )}
          </Stack>

          {actionError !== null && (
            <Alert
              severity="error"
              onClose={() => {
                setActionError(null);
              }}
            >
              {actionError}
            </Alert>
          )}
          {notice !== null && (
            <Alert
              severity="success"
              onClose={() => {
                setNotice(null);
              }}
            >
              {notice}
            </Alert>
          )}
          {elsewhere.length > 0 && (
            <Alert severity="warning">
              This offer also has {String(elsewhere.length)} listing(s) in
              another store. They belong to a different deployment: the same
              product id in Sandbox and in Production are two different
              products.
            </Alert>
          )}

          <Stack spacing={0.5}>
            {facts.map((fact) => (
              <Typography key={fact.label} variant="body2">
                <Typography component="span" color="text.secondary">
                  {fact.label}:{" "}
                </Typography>
                {fact.value}
              </Typography>
            ))}
          </Stack>
          <NoPriceHere />

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
            <Button
              size="small"
              variant="outlined"
              href={APP_STORE_CONNECT_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open in App Store Connect
            </Button>
            <Button
              size="small"
              variant="outlined"
              disabled={!syncing || busy}
              title={
                syncing
                  ? "Asks the store what it knows about the mapped products"
                  : "Running a store sync needs the ADMIN role"
              }
              onClick={() => {
                run(startStoreSync(), "A read-only store sync was queued");
              }}
            >
              Re-check
            </Button>
            <Button
              size="small"
              color="warning"
              variant="outlined"
              disabled={!publisher || busy || primary === undefined}
              onClick={() => {
                if (primary !== undefined) {
                  run(
                    setProductStatus(primary.id, "RETIRED"),
                    "The listing was withdrawn; everyone who bought it keeps access",
                  );
                }
              }}
            >
              Remove from sale
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!publisher || busy || offer.status !== "DRAFT"}
              onClick={() => {
                run(setOfferStatus(offer.id, "ACTIVE"), "The offer is on sale");
              }}
            >
              Activate
            </Button>
            <Button
              size="small"
              color="warning"
              disabled={!publisher || busy || offer.status !== "ACTIVE"}
              onClick={() => {
                run(
                  setOfferStatus(offer.id, "RETIRED"),
                  "The offer was retired; existing owners keep their access",
                );
              }}
            >
              Retire
            </Button>
          </Stack>

          <Divider />

          <Typography variant="subtitle2">Map a store product</Typography>
          <Typography variant="body2" color="text.secondary">
            The product is created in App Store Connect, not here. This records
            which product sells this offer, in{" "}
            <strong>{status?.storeEnvironment ?? "this store"}</strong>; the
            server refuses a product that belongs to another one.
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <TextField
              size="small"
              label="Bundle id"
              value={bundleId}
              disabled={!publisher || busy}
              sx={{ minWidth: 280 }}
              onChange={(event) => {
                setBundleId(event.target.value);
              }}
            />
            <TextField
              size="small"
              label="Product id"
              value={productId}
              disabled={!publisher || busy}
              helperText="Immutable once activated"
              sx={{ minWidth: 360 }}
              onChange={(event) => {
                setProductId(event.target.value);
              }}
            />
            <Button
              variant="contained"
              disabled={
                !publisher ||
                busy ||
                status === null ||
                bundleId.trim() === "" ||
                productId.trim() === ""
              }
              onClick={() => {
                if (status !== null) {
                  run(
                    mapProduct(offer.id, {
                      provider: "APPLE_APP_STORE",
                      storeEnvironment: status.storeEnvironment as
                        | "LOCAL_TEST"
                        | "SANDBOX"
                        | "PRODUCTION",
                      bundleId,
                      productId,
                    }),
                    "The mapping was recorded",
                  );
                }
              }}
            >
              Map product
            </Button>
          </Stack>

          <Divider />

          <Typography variant="subtitle2">Add an entitlement</Typography>
          <Typography variant="body2" color="text.secondary">
            The grants of an offer that has been on sale may grow and never
            shrink: a different set of rights is a different product.
          </Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <TextField
              select
              size="small"
              label="Entitlement"
              value={grant}
              disabled={busy || entitlements === null}
              sx={{ minWidth: 320 }}
              onChange={(event) => {
                setGrant(event.target.value);
              }}
            >
              {(entitlements ?? [])
                .filter(
                  (entitlement) => !offer.grants.includes(entitlement.key),
                )
                .map((entitlement) => (
                  <MenuItem key={entitlement.key} value={entitlement.key}>
                    {entitlement.key}
                  </MenuItem>
                ))}
            </TextField>
            <Button
              variant="outlined"
              disabled={busy || grant === ""}
              onClick={() => {
                run(
                  setOfferGrants(offer.id, [...offer.grants, grant]),
                  "The offer now grants one more right",
                );
                setGrant("");
              }}
            >
              Add grant
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
