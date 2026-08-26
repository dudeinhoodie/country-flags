import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import {
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
import { StatusChip } from "../../components/StatusChip";
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
        <Stack
          spacing={2}
          sx={{ alignItems: "center", py: 10, textAlign: "center", flex: 1 }}
        >
          <EditNoteOutlinedIcon
            sx={{ fontSize: 44, color: "text.secondary" }}
          />
          <Typography variant="h6" component="p">
            No drafts yet
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 440 }}
          >
            Importing one copies the editorial catalog this deployment carries,
            together with the commit it belongs to.
          </Typography>
          <ImportDraftButton />
        </Stack>
      }
    >
      <Datagrid bulkActionButtons={false} rowClick={false}>
        <FunctionField
          label="Status"
          render={(record: Draft) => <StatusChip value={record.status} />}
        />
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
