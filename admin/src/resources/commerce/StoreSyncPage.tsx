import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { CommerceHeader } from "./CommerceHeader";
import { useCommerceStatus, useCommerceWriter } from "./useCommerce";
import type { StoreSyncRun, StoreTransaction } from "./useCommerce";

function canSync(permissions: unknown): boolean {
  return permissions === "ADMIN";
}

/**
 * The read-only conversation with the store, and the one diagnostic support
 * is allowed (docs/17 §12.2, §16).
 *
 * The sync is queued rather than performed: the App Store Connect key lives
 * in Secret Manager and belongs to a job, deliberately not to this browser.
 * The transaction lookup answers with masked identifiers and never with the
 * signed payload — what a support agent needs is whether a purchase landed
 * and what it opened.
 */
export function StoreSyncPage() {
  const { permissions } = usePermissions<string>();
  const { status, error, reload } = useCommerceStatus();
  const { startStoreSync, readTransaction } = useCommerceWriter();
  const [run, setRun] = useState<StoreSyncRun | null>(null);
  const [transactionId, setTransactionId] = useState("");
  const [transaction, setTransaction] = useState<StoreTransaction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const admin = canSync(permissions);

  function sync(): void {
    setBusy(true);
    setActionError(null);
    startStoreSync()
      .then((started) => {
        setRun(started);
        reload();
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error ? cause.message : "The sync did not start",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function lookUp(): void {
    setBusy(true);
    setActionError(null);
    setTransaction(null);
    readTransaction(transactionId)
      .then((found) => {
        setTransaction(found);
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error
            ? cause.message
            : "The transaction could not be read",
        );
      })
      .finally(() => {
        setBusy(false);
      });
  }

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Store sync" />
      <CardContent>
        <Stack spacing={2}>
          <CommerceHeader title="Store sync and diagnostics" status={status} />

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
          {!admin && (
            <Alert severity="info">
              You are reading the storefront's health. Running a sync and
              reading a transaction need the ADMIN role.
            </Alert>
          )}

          {status === null ? (
            <LoadingState label="Loading the storefront status…" />
          ) : (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Active offers:{" "}
                </Typography>
                {String(status.activeOfferCount)}
              </Typography>
              <Typography
                variant="body2"
                color={
                  status.offersWithoutValidatedProduct > 0
                    ? "error.main"
                    : undefined
                }
              >
                <Typography component="span" color="text.secondary">
                  Active offers nothing here can sell:{" "}
                </Typography>
                {String(status.offersWithoutValidatedProduct)}
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Last reconciliation:{" "}
                </Typography>
                {status.lastReconciliationAt === null ||
                status.lastReconciliationAt === undefined
                  ? "never"
                  : new Date(status.lastReconciliationAt).toISOString()}
              </Typography>
              {status.lastReconciliationError !== null &&
                status.lastReconciliationError !== undefined && (
                  <Alert severity="warning">
                    {status.lastReconciliationError}
                  </Alert>
                )}
            </Stack>
          )}

          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Button
              variant="contained"
              disabled={!admin || busy}
              onClick={sync}
            >
              Run a read-only sync
            </Button>
            {run !== null && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <StatusChip value={run.status} />
                <Typography variant="caption" color="text.secondary">
                  queued {new Date(run.startedAt).toISOString()}
                </Typography>
              </Stack>
            )}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            The sync asks App Store Connect what it knows about the mapped
            products. It never creates an in-app purchase and never changes a
            price: the key belongs to a job, not to this browser.
          </Typography>

          <Divider />

          <Typography variant="subtitle2">Transaction diagnostics</Typography>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <TextField
              size="small"
              label="Transaction record id"
              value={transactionId}
              disabled={!admin || busy}
              helperText="Our own id from a support ticket, not the store's"
              sx={{ minWidth: 360 }}
              onChange={(event) => {
                setTransactionId(event.target.value);
              }}
            />
            <Button
              variant="outlined"
              disabled={!admin || busy || transactionId.trim() === ""}
              onClick={lookUp}
            >
              Look up
            </Button>
          </Stack>
          {transaction !== null && (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Store transaction:{" "}
                </Typography>
                <code>{transaction.maskedTransactionId}</code>
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Product:{" "}
                </Typography>
                <code>{transaction.productId}</code>
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Store:{" "}
                </Typography>
                {transaction.storeEnvironment}
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Claim state:{" "}
                </Typography>
                {transaction.claimState}
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Purchased:{" "}
                </Typography>
                {new Date(transaction.purchasedAt).toISOString()}
              </Typography>
              <Typography variant="body2">
                <Typography component="span" color="text.secondary">
                  Granted:{" "}
                </Typography>
                {(transaction.grantedEntitlementKeys ?? []).join(", ") || "—"}
              </Typography>
              {transaction.revokedAt !== null &&
                transaction.revokedAt !== undefined && (
                  <Alert severity="warning">
                    Revoked {new Date(transaction.revokedAt).toISOString()}
                    {transaction.revocationReason === null ||
                    transaction.revocationReason === undefined
                      ? ""
                      : ` — ${transaction.revocationReason}`}
                  </Alert>
                )}
              <Typography variant="caption" color="text.secondary">
                The store's identifier is masked and the signed receipt is never
                returned: this screen has to be safe to put in a support ticket.
              </Typography>
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
