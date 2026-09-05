import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { Title, usePermissions } from "react-admin";
import { useNavigate } from "react-router-dom";
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { CommerceHeader, NoPriceHere } from "./CommerceHeader";
import {
  useCommerceStatus,
  useCommerceWriter,
  useEntitlements,
  useOffers,
} from "./useCommerce";
import type { CommerceOffer, CommerceStatus } from "./useCommerce";

const CODE_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function canDraft(permissions: unknown): boolean {
  return (
    permissions === "EDITOR" ||
    permissions === "PUBLISHER" ||
    permissions === "ADMIN"
  );
}

/** Whether this offer can be sold in the store the console is looking at. */
export function sellableHere(
  offer: CommerceOffer,
  status: CommerceStatus | null,
): boolean {
  if (status === null) {
    return false;
  }
  return offer.products.some(
    (product) =>
      product.storeEnvironment === status.storeEnvironment &&
      (product.status === "VALIDATED" || product.status === "ACTIVE"),
  );
}

/**
 * What is for sale, in our terms rather than a store's (docs/17 §12.2).
 *
 * An offer is not a deck: it grants entitlement keys, one for a single deck
 * and several for a bundle, and a store product is what sells it. There is
 * no price column here and there never will be.
 */
export function OffersPage() {
  const navigate = useNavigate();
  const { permissions } = usePermissions<string>();
  const { status } = useCommerceStatus();
  const { offers, error, reload } = useOffers();
  const { entitlements } = useEntitlements();
  const { createOffer } = useCommerceWriter();
  const [code, setCode] = useState("");
  const [grant, setGrant] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editable = canDraft(permissions);
  const codeProblem =
    code.trim() === "" || CODE_PATTERN.test(code.trim())
      ? null
      : "A code looks like EUROPEAN_COATS_LIFETIME";

  function draft(): void {
    setSaving(true);
    setActionError(null);
    createOffer(code, [grant])
      .then((offer) => {
        setCode("");
        setGrant("");
        reload();
        void navigate(`/commerce/offers/${offer.id}`);
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error ? cause.message : "The offer was not created",
        );
      })
      .finally(() => {
        setSaving(false);
      });
  }

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }

  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Offers" />
      <CardContent>
        <Stack spacing={2}>
          <CommerceHeader title="Offers" status={status} />
          <NoPriceHere />

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
          {!editable && (
            <Alert severity="info">
              You are reading the offers. Drafting one needs the EDITOR role,
              and putting one on sale needs PUBLISHER.
            </Alert>
          )}

          {offers === null ? (
            <LoadingState label="Loading the offers…" />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Grants</TableCell>
                  <TableCell>Sellable here</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {offers.map((offer) => (
                  <TableRow key={offer.id} hover>
                    <TableCell>
                      <code>{offer.code}</code>
                    </TableCell>
                    <TableCell>
                      {offer.kind === "ONE_TIME"
                        ? "One-time purchase"
                        : offer.kind}
                    </TableCell>
                    <TableCell>
                      <StatusChip value={offer.status} />
                    </TableCell>
                    <TableCell>{offer.grants.join(", ")}</TableCell>
                    <TableCell>
                      {sellableHere(offer, status) ? "Yes" : "Not yet"}
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        onClick={() => {
                          void navigate(`/commerce/offers/${offer.id}`);
                        }}
                      >
                        {editable ? "Open" : "View"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {offers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography variant="body2" color="text.secondary">
                        Nothing is for sale yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <TextField
              size="small"
              label="New offer code"
              value={code}
              disabled={!editable || saving}
              error={codeProblem !== null}
              helperText={codeProblem ?? "For example EUROPEAN_COATS_LIFETIME"}
              sx={{ minWidth: 320 }}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
              }}
            />
            <TextField
              select
              size="small"
              label="Grants"
              value={grant}
              disabled={!editable || saving || entitlements === null}
              helperText="More keys can be added later; they may never be taken away once sold"
              sx={{ minWidth: 320 }}
              onChange={(event) => {
                setGrant(event.target.value);
              }}
            >
              {(entitlements ?? []).map((entitlement) => (
                <MenuItem key={entitlement.key} value={entitlement.key}>
                  {entitlement.key}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              disabled={
                !editable ||
                saving ||
                codeProblem !== null ||
                code.trim() === "" ||
                grant === ""
              }
              onClick={draft}
            >
              Draft offer
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
