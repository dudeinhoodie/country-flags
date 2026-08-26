import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  TextField,
} from "react-admin";
import { RoleChip, StatusChip } from "../../components/StatusChip";

interface AccessRow {
  role: string;
  status: string;
}

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
        <FunctionField
          label="Role"
          render={(record: AccessRow) => <RoleChip value={record.role} />}
        />
        <FunctionField
          label="Status"
          render={(record: AccessRow) => <StatusChip value={record.status} />}
        />
        <DateField source="createdAt" showTime sortable={false} />
      </Datagrid>
    </List>
  );
}
