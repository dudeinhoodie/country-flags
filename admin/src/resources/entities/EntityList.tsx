import {
  Datagrid,
  FunctionField,
  List,
  SearchInput,
  TextField,
} from "react-admin";
import { routes } from "../../app/routes";
import { FlagThumbnail } from "../../components/FlagThumbnail";
import { PublishedPageHeader } from "../../components/PublishedPageHeader";
import { StatusChip } from "../../components/StatusChip";
import type { components } from "../../api/generated/admin-api";

type EntityRow = components["schemas"]["AdminEntitySummary"];

const filters = [<SearchInput key="q" source="q" alwaysOn />];

/**
 * The countries the active release serves, read-only (§4.1).
 *
 * The server orders by slug and owns the `q` search; columns stay
 * unsortable so the UI does not promise sorting nobody implemented.
 */
export function EntityList() {
  return (
    <>
      <PublishedPageHeader
        title="Countries & regions"
        description="What the apps are being served right now. Nothing on this screen can be changed: edits happen in a draft and reach clients when it is published."
        draftHref={routes.draftEntities}
      />
      <List title={false} filters={filters} exporter={false} perPage={25}>
        <Datagrid
          rowClick={(id) => routes.publishedEntity(String(id))}
          bulkActionButtons={false}
        >
          <FunctionField
            label="Flag"
            render={(record: EntityRow) => (
              <FlagThumbnail flag={record.flag} height={26} />
            )}
          />
          <TextField source="nameRu" label="Name (ru)" sortable={false} />
          <TextField source="nameEn" label="Name (en)" sortable={false} />
          <TextField source="isoAlpha2" label="ISO2" sortable={false} />
          <TextField source="kind" sortable={false} />
          <FunctionField
            label="Status"
            render={(record: EntityRow) => <StatusChip value={record.status} />}
          />
        </Datagrid>
      </List>
    </>
  );
}
