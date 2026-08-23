import { Datagrid, List, NumberField, TextField } from "react-admin";

export function DeckList() {
  return (
    <List title="Decks" exporter={false} perPage={25}>
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <TextField source="code" sortable={false} />
        <TextField source="nameRu" label="Name (ru)" sortable={false} />
        <TextField source="nameEn" label="Name (en)" sortable={false} />
        <TextField source="kind" sortable={false} />
        <NumberField source="cardCount" sortable={false} />
        <TextField source="status" sortable={false} />
      </Datagrid>
    </List>
  );
}
