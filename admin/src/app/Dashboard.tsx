import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { Title } from "react-admin";
import { useRuntimeConfig } from "../config/RuntimeConfigContext";

export function Dashboard() {
  const config = useRuntimeConfig();
  return (
    <Card sx={{ mt: 2 }}>
      <Title title="Country Flags Admin" />
      <CardContent>
        <Stack spacing={1}>
          <Typography variant="h5" component="h2">
            Catalog administration
          </Typography>
          <Typography color="text.secondary">
            Draft editing, validation and release proposals appear here as the
            corresponding screens land.
          </Typography>
          <Typography variant="body2">
            Environment: {config.environment}
          </Typography>
          <Typography variant="body2">
            API base path: {config.apiBasePath}
          </Typography>
          <Typography variant="body2">Build: {config.appVersion}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
