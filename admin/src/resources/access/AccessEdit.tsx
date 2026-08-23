import Alert from "@mui/material/Alert";
import {
  Edit,
  SaveButton,
  SelectInput,
  SimpleForm,
  TextInput,
  Toolbar,
  useGetIdentity,
  useRecordContext,
} from "react-admin";

const ROLE_CHOICES = ["VIEWER", "EDITOR", "PUBLISHER", "ADMIN"].map((id) => ({
  id,
  name: id,
}));

const STATUS_CHOICES = ["ACTIVE", "DISABLED"].map((id) => ({ id, name: id }));

function AccessEditForm() {
  const record = useRecordContext<{ id: string }>();
  const { identity } = useGetIdentity();
  // The backend refuses self-changes with 403; disabling the form just
  // spares the admin a pointless round-trip.
  const isSelf = record !== undefined && identity?.id === record.id;
  return (
    <SimpleForm
      toolbar={
        <Toolbar>
          <SaveButton disabled={isSelf} />
        </Toolbar>
      }
    >
      {isSelf && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You cannot change your own role or status — ask another administrator.
        </Alert>
      )}
      <TextInput source="email" disabled fullWidth />
      <SelectInput source="role" choices={ROLE_CHOICES} disabled={isSelf} />
      <SelectInput source="status" choices={STATUS_CHOICES} disabled={isSelf} />
    </SimpleForm>
  );
}

/**
 * Pessimistic mutation: a role change revokes the target's sessions on the
 * server, so the UI must only show success after the server confirmed.
 */
export function AccessEdit() {
  return (
    <Edit mutationMode="pessimistic" redirect="list">
      <AccessEditForm />
    </Edit>
  );
}
