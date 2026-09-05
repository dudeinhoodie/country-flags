import {
  ArrayField,
  Datagrid,
  FunctionField,
  NumberField,
  Show,
  SimpleShowLayout,
  TextField,
} from "react-admin";
import { routes } from "../../app/routes";
import { PublishedPageHeader } from "../../components/PublishedPageHeader";
import type { components } from "../../api/generated/admin-api";

type DeckDetail = components["schemas"]["AdminDeckDetail"];

export function DeckShow() {
  return (
    <>
      <PublishedPageHeader
        title="Published deck"
        description="The deck as the active release serves it, resolved cards and all."
        draftHref={routes.draftDecks}
        draftLabel="Open the deck builder"
      />
      <Show title={false}>
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
    </>
  );
}
