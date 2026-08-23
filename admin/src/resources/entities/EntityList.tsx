import {
  Datagrid,
  FunctionField,
  List,
  SearchInput,
  TextField,
} from "react-admin";
import { FlagThumbnail } from "../../components/FlagThumbnail";
import type { components } from "../../api/generated/admin-api";

type EntityRow = components["schemas"]["AdminEntitySummary"];

const filters = [<SearchInput key="q" source="q" alwaysOn />];

/**
 * The server orders by slug and owns the `q` search; columns stay
 * unsortable so the UI does not promise sorting nobody implemented.
 */
export function EntityList() {
  return (
    <List title="Countries" filters={filters} exporter={false} perPage={25}>
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <FunctionField
          label="Flag"
          render={(record: EntityRow) => <FlagThumbnail flag={record.flag} />}
        />
        <TextField source="nameRu" label="Name (ru)" sortable={false} />
        <TextField source="nameEn" label="Name (en)" sortable={false} />
        <TextField source="isoAlpha2" label="ISO2" sortable={false} />
        <TextField source="kind" sortable={false} />
        <TextField source="status" sortable={false} />
      </Datagrid>
    </List>
  );
}
