import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  ArrayField,
  BooleanField,
  Datagrid,
  FunctionField,
  Labeled,
  Show,
  SimpleShowLayout,
  TextField,
} from "react-admin";
import { routes } from "../../app/routes";
import { FlagThumbnail } from "../../components/FlagThumbnail";
import { PublishedPageHeader } from "../../components/PublishedPageHeader";
import type { components } from "../../api/generated/admin-api";

type EntityDetail = components["schemas"]["AdminEntityDetail"];
type Asset = components["schemas"]["AdminAsset"];

function AssetProvenance({ asset }: { asset: Asset }) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {asset.type} · {asset.variant} · license: {asset.licenseName}
        {asset.attribution === null ? "" : ` · ${asset.attribution}`}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        source:{" "}
        <Link href={asset.source.url} target="_blank" rel="noreferrer">
          {asset.source.name}
        </Link>
      </Typography>
    </Stack>
  );
}

export function EntityShow() {
  return (
    <>
      <PublishedPageHeader
        title="Published country"
        description="The record the active release serves, exactly as clients receive it."
        draftHref={routes.draftEntities}
      />
      <Show title={false}>
        <SimpleShowLayout>
          <TextField source="contentKey" />
          <TextField source="slug" />
          <TextField source="kind" />
          <TextField source="status" />
          <TextField source="recognitionStatus" />
          <TextField source="isoAlpha2" label="ISO alpha-2" emptyText="—" />
          <TextField source="isoAlpha3" label="ISO alpha-3" emptyText="—" />
          <BooleanField source="includeInCountryCatalog" />
          <FunctionField
            label="Flag"
            render={(record: EntityDetail) => (
              <Stack spacing={1}>
                <FlagThumbnail flag={record.flag} height={48} />
                {record.flag !== null && (
                  <AssetProvenance asset={record.flag} />
                )}
              </Stack>
            )}
          />
          <ArrayField source="names" sortable={false}>
            <Datagrid bulkActionButtons={false} rowClick={false}>
              <TextField source="locale" sortable={false} />
              <TextField source="nameType" sortable={false} />
              <TextField source="value" sortable={false} />
              <BooleanField source="isPrimary" sortable={false} />
            </Datagrid>
          </ArrayField>
          <Labeled label="Content version">
            <TextField source="contentVersion" />
          </Labeled>
        </SimpleShowLayout>
      </Show>
    </>
  );
}
