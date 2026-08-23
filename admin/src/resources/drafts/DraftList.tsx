import Button from "@mui/material/Button";
import {
  CreateButton,
  Datagrid,
  DateField,
  FunctionField,
  List,
  NumberField,
  TextField,
  TopToolbar,
  useNotify,
  useRefresh,
  useCreate,
} from "react-admin";
import { Link } from "react-router-dom";
import type { components } from "../../api/generated/admin-api";

type Draft = components["schemas"]["AdminDraftSummary"];

function ImportDraftButton() {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();
  return (
    <Button
      variant="contained"
      size="small"
      disabled={isPending}
      onClick={() => {
        void create(
          "drafts",
          { data: {} },
          {
            onSuccess: () => {
              notify("Draft imported from the editorial catalog", {
                type: "success",
              });
              refresh();
            },
            onError: (error) => {
              notify(
                error instanceof Error
                  ? error.message
                  : "The draft could not be imported",
                { type: "error" },
              );
            },
          },
        );
      }}
    >
      Import a draft
    </Button>
  );
}

function DraftListActions() {
  return (
    <TopToolbar>
      <ImportDraftButton />
    </TopToolbar>
  );
}

export function DraftList() {
  return (
    <List
      title="Drafts"
      actions={<DraftListActions />}
      exporter={false}
      perPage={25}
      empty={
        <div style={{ padding: "2rem" }}>
          <p>
            No drafts yet. Importing one copies the editorial catalog this
            deployment carries, together with the commit it belongs to.
          </p>
          <ImportDraftButton />
        </div>
      }
    >
      <Datagrid bulkActionButtons={false} rowClick={false}>
        <TextField source="status" sortable={false} />
        <NumberField source="revision" sortable={false} />
        <TextField
          source="baseContentVersion"
          label="Base version"
          sortable={false}
        />
        <TextField
          source="baseCatalogCommit"
          label="Catalog commit"
          sortable={false}
        />
        <DateField source="updatedAt" showTime sortable={false} />
        <FunctionField
          label=""
          render={(record: Draft) => (
            <Button
              component={Link}
              to={`/drafts/${record.id}`}
              size="small"
              variant="outlined"
            >
              Open
            </Button>
          )}
        />
      </Datagrid>
    </List>
  );
}

export { CreateButton };
