import {
  Datagrid,
  FunctionField,
  List,
  NumberField,
  TextField,
} from "react-admin";
import { routes } from "../../app/routes";
import { PublishedPageHeader } from "../../components/PublishedPageHeader";
import { StatusChip } from "../../components/StatusChip";
import type { components } from "../../api/generated/admin-api";

type DeckRow = components["schemas"]["AdminDeckSummary"];

/** The decks the active release serves, read-only (§4.1). */
export function DeckList() {
  return (
    <>
      <PublishedPageHeader
        title="Decks"
        description="The decks clients can open today. Building and changing a deck happens in a draft; this is the published result."
        draftHref={routes.draftDecks}
        draftLabel="Open the deck builder"
      />
      <List title={false} exporter={false} perPage={25}>
        <Datagrid
          rowClick={(id) => routes.publishedDeck(String(id))}
          bulkActionButtons={false}
        >
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
    </>
  );
}
