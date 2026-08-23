import { Datagrid, DateField, List, TextField } from "react-admin";

/**
 * The server orders the roster by email and ignores client sort; the
 * columns are marked unsortable so the UI does not promise otherwise.
 */
export function AccessList() {
  return (
    <List title="Access" exporter={false} perPage={25}>
      <Datagrid rowClick="edit" bulkActionButtons={false}>
        <TextField source="email" sortable={false} />
        <TextField source="displayName" sortable={false} />
        <TextField source="role" sortable={false} />
        <TextField source="status" sortable={false} />
        <DateField source="createdAt" showTime sortable={false} />
      </Datagrid>
    </List>
  );
}
