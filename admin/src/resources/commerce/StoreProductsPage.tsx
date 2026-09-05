import Alert from "@mui/material/Alert";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";
import { Title } from "react-admin";
import { LoadingState } from "../../components/LoadingState";
import { StatusChip } from "../../components/StatusChip";
import { CommerceHeader, NoPriceHere } from "./CommerceHeader";
import { useCommerceStatus, useOffers } from "./useCommerce";
import type { StoreProduct } from "./useCommerce";

interface MappedProduct extends StoreProduct {
  offerCode: string;
}

/**
 * Every store listing this deployment knows about (docs/17 §12.2).
 *
 * A listing is identified by its provider, its store, its bundle and its
 * product id together. The same product id in Sandbox and in Production are
 * two different products, and a row from the other store is shown greyed
 * rather than hidden — an operator who mapped one there should be able to
 * see that they did.
 */
export function StoreProductsPage() {
  const { status } = useCommerceStatus();
  const { offers, error } = useOffers();

  if (error !== null) {
    return <Alert severity="error">{error}</Alert>;
  }

  const products: MappedProduct[] =
    offers === null
      ? []
      : offers.flatMap((offer) =>
          offer.products.map((product) => ({
            ...product,
            offerCode: offer.code,
          })),
        );

  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Store products" />
      <CardContent>
        <Stack spacing={2}>
          <CommerceHeader title="Store products" status={status} />
          <NoPriceHere />

          {offers === null ? (
            <LoadingState label="Loading the store products…" />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Product id</TableCell>
                  <TableCell>Offer</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Store</TableCell>
                  <TableCell>Bundle</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Validation</TableCell>
                  <TableCell>Last checked</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {products.map((product) => {
                  const foreign =
                    status !== null &&
                    product.storeEnvironment !== status.storeEnvironment;
                  return (
                    <TableRow
                      key={product.id}
                      hover
                      sx={foreign ? { opacity: 0.55 } : undefined}
                    >
                      <TableCell>
                        <code>{product.productId}</code>
                      </TableCell>
                      <TableCell>
                        <code>{product.offerCode}</code>
                      </TableCell>
                      <TableCell>{product.provider}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          variant="outlined"
                          color={
                            product.storeEnvironment === "PRODUCTION"
                              ? "error"
                              : undefined
                          }
                          label={product.storeEnvironment}
                        />
                      </TableCell>
                      <TableCell>{product.bundleId}</TableCell>
                      <TableCell>{product.productType}</TableCell>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <StatusChip value={product.status} />
                          {product.validationError !== null &&
                            product.validationError !== undefined && (
                              <Typography variant="caption" color="error.main">
                                {product.validationError}
                              </Typography>
                            )}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        {product.lastValidatedAt === null ||
                        product.lastValidatedAt === undefined
                          ? "never"
                          : new Date(product.lastValidatedAt).toISOString()}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {products.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <Typography variant="body2" color="text.secondary">
                        No offer has been mapped to a store product yet. A
                        product is created in App Store Connect first; the
                        mapping is recorded on the offer.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
