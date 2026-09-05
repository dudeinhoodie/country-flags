import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import EditNoteOutlinedIcon from "@mui/icons-material/EditNoteOutlined";
import {
  Datagrid,
  DateField,
  FunctionField,
  List,
  NumberField,
  TextField,
  useNotify,
  useRefresh,
  useCreate,
} from "react-admin";
import { Link } from "react-router-dom";
import { routes } from "../../app/routes";
import { PageHeader } from "../../components/PageHeader";
import { EmptyState } from "../../components/StateViews";
import { StatusChip } from "../../components/StatusChip";
import type { components } from "../../api/generated/admin-api";

type Draft = components["schemas"]["AdminDraftSummary"];

/**
 * Starting a draft copies the release the deployment is serving.
 *
 * The wording is the editorial one the spec insists on (§5): an editor is
 * creating a place to work, not importing a file. `Import` described the
 * mechanism and told nobody what they were about to get.
 */
function CreateDraftButton({ variant }: { variant?: "contained" | "text" }) {
  const [create, { isPending }] = useCreate();
  const notify = useNotify();
  const refresh = useRefresh();
  return (
    <Button
      variant={variant ?? "contained"}
      size="small"
      disabled={isPending}
      onClick={() => {
        void create(
          "drafts",
          { data: {} },
          {
            onSuccess: () => {
              notify("Draft created from the current release", {
                type: "success",
              });
              refresh();
            },
            onError: (error) => {
              notify(
                error instanceof Error
                  ? error.message
                  : "The draft could not be created",
                { type: "error" },
              );
            },
          },
        );
      }}
    >
      Create draft from current release
    </Button>
  );
}

export function DraftList() {
  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Drafts"
        description="Every draft this deployment holds. The one selected in the top bar is what the Draft workspace edits."
        surface="draft"
        actions={<CreateDraftButton />}
      />
      <List
        title={false}
        actions={false}
        exporter={false}
        perPage={25}
        empty={
          <EmptyState
            title="No drafts yet"
            description="Creating one copies the editorial catalog this deployment carries, together with the commit it belongs to."
            icon={<EditNoteOutlinedIcon sx={{ fontSize: 40 }} />}
            action={<CreateDraftButton />}
          />
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
                to={routes.draftOverview(record.id)}
                size="small"
                variant="outlined"
              >
                Open
              </Button>
            )}
          />
        </Datagrid>
      </List>
    </Box>
  );
}
