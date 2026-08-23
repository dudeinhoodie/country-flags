import {
  ArrayField,
  Datagrid,
  FunctionField,
  NumberField,
  Show,
  SimpleShowLayout,
  TextField,
} from "react-admin";
import type { components } from "../../api/generated/admin-api";

type DeckDetail = components["schemas"]["AdminDeckDetail"];

export function DeckShow() {
  return (
    <Show title="Deck">
      <SimpleShowLayout>
        <TextField source="code" />
        <TextField source="kind" />
        <TextField source="status" />
        <NumberField source="cardCount" />
        <ArrayField source="localizations" sortable={false}>
          <Datagrid bulkActionButtons={false} rowClick={false}>
            <TextField source="locale" sortable={false} />
            <TextField source="name" sortable={false} />
            <TextField source="description" sortable={false} />
          </Datagrid>
        </ArrayField>
        <FunctionField
          label="Rule spec"
          render={(record: DeckDetail) =>
            record.ruleSpec === null ? (
              "—"
            ) : (
              <pre style={{ margin: 0, fontSize: "0.8rem" }}>
                {JSON.stringify(record.ruleSpec, null, 2)}
              </pre>
            )
          }
        />
        <TextField source="contentVersion" />
      </SimpleShowLayout>
    </Show>
  );
}
