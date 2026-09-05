import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
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
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { CommerceHeader } from "./CommerceHeader";
import {
  useCommerceStatus,
  useCommerceWriter,
  useEntitlements,
} from "./useCommerce";

const KEY_PATTERN = /^entitlement\.[a-z0-9_]+(?:\.[a-z0-9_]+)*$/;

function canDeclare(permissions: unknown): boolean {
  return permissions === "PUBLISHER" || permissions === "ADMIN";
}

function keyProblem(key: string): string | null {
  const trimmed = key.trim();
  if (trimmed === "") {
    return null;
  }
  if (!KEY_PATTERN.test(trimmed)) {
    return "A key looks like entitlement.european_coats";
  }
  return null;
}

/**
 * The rights that open a deck, and the decks each one opens (docs/17 §12.2).
 *
 * A key is a business boundary rather than a publishing detail: deck ids and
 * content versions change with every release, and what somebody bought must
 * not. That is why nothing here renames one.
 */
export function EntitlementsPage() {
  const { permissions } = usePermissions<string>();
  const { status } = useCommerceStatus();
  const { entitlements, error, reload } = useEntitlements();
  const { createEntitlement } = useCommerceWriter();
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const editable = canDeclare(permissions);
  const problem = keyProblem(key);

  function declare(): void {
    setSaving(true);
    setActionError(null);
    createEntitlement(key, description)
      .then(() => {
        setKey("");
        setDescription("");
        reload();
      })
      .catch((cause: unknown) => {
        setActionError(
          cause instanceof Error
            ? cause.message
            : "The entitlement was not created",
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
      <Title title="Entitlements" />
      <CardContent>
        <Stack spacing={2}>
          <CommerceHeader title="Entitlements" status={status} />
          <Typography variant="body2" color="text.secondary">
            A key is never renamed once anything has been sold against it. It
            lives in its own <code>entitlement.</code> namespace so it cannot be
            confused with the editorial <code>deck.</code> key beside it.
          </Typography>

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
              You are reading the entitlements. Declaring one needs the
              PUBLISHER role.
            </Alert>
          )}

          {entitlements === null ? (
            <LoadingState label="Loading the entitlements…" />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Key</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Decks it opens</TableCell>
                  <TableCell>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {entitlements.map((entitlement) => (
                  <TableRow key={entitlement.key} hover>
                    <TableCell>
                      <code>{entitlement.key}</code>
                    </TableCell>
                    <TableCell>
                      <StatusChip value={entitlement.status} />
                    </TableCell>
                    <TableCell>
                      {entitlement.deckCodes.length === 0
                        ? "—"
                        : entitlement.deckCodes.join(", ")}
                    </TableCell>
                    <TableCell>{entitlement.description ?? "—"}</TableCell>
                  </TableRow>
                ))}
                {entitlements.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <Typography variant="body2" color="text.secondary">
                        No entitlement has been declared yet, so every deck is
                        free.
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
              label="New entitlement key"
              value={key}
              disabled={!editable || saving}
              error={problem !== null}
              helperText={problem ?? "For example entitlement.european_coats"}
              sx={{ minWidth: 320 }}
              onChange={(event) => {
                setKey(event.target.value);
              }}
            />
            <TextField
              size="small"
              label="Internal note"
              value={description}
              disabled={!editable || saving}
              helperText="Never shown to a customer and never localized"
              sx={{ minWidth: 320 }}
              onChange={(event) => {
                setDescription(event.target.value);
              }}
            />
            <Button
              variant="contained"
              disabled={
                !editable || saving || problem !== null || key.trim() === ""
              }
              onClick={declare}
            >
              Declare
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
