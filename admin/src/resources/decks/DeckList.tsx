import {
  Datagrid,
  FunctionField,
  List,
  NumberField,
  TextField,
} from "react-admin";
import { StatusChip } from "../../components/StatusChip";
import type { components } from "../../api/generated/admin-api";

type DeckRow = components["schemas"]["AdminDeckSummary"];

export function DeckList() {
  return (
    <List title="Decks" exporter={false} perPage={25}>
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <TextField source="code" sortable={false} />
        <TextField source="nameRu" label="Name (ru)" sortable={false} />
        <TextField source="nameEn" label="Name (en)" sortable={false} />
        <TextField source="kind" sortable={false} />
        <NumberField source="cardCount" sortable={false} />
        <FunctionField
          label="Status"
          render={(record: DeckRow) => <StatusChip value={record.status} />}
        />
      </Datagrid>
    </List>
  );
}
