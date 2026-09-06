import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { Link } from "react-router-dom";
import { findingHref } from "../app/workspace-model";
import type { components } from "../api/generated/admin-api";

type Finding = components["schemas"]["AdminValidationFinding"];

/**
 * What validation found, as a list of places to go (§9).
 *
 * Every row is a link built from the finding's own target, so the click lands
 * on the object, its tab and the field the rule was about. A report that only
 * counted findings would leave the reader to search for them, which is the
 * work the console exists to save.
 *
 * Severity is an icon and a word as well as a colour: colour alone does not
 * carry a state (§11).
 */
export function FindingList({
  draftId,
  findings,
  emptyLabel = "Nothing was found here.",
}: {
  draftId: string;
  findings: readonly Finding[];
  emptyLabel?: string;
}) {
  if (findings.length === 0) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <CheckCircleOutlineIcon fontSize="small" color="success" />
        <Typography variant="body2" color="text.secondary">
          {emptyLabel}
        </Typography>
      </Stack>
    );
  }
  const blocking = findings.filter((finding) => finding.level === "blocking");
  const warnings = findings.filter((finding) => finding.level !== "blocking");
  return (
    <Stack spacing={1.5}>
      {blocking.length > 0 && (
        <Alert severity="error">
          <AlertTitle>
            {`${String(blocking.length)} ${blocking.length === 1 ? "issue stops" : "issues stop"} a release`}
          </AlertTitle>
          <Rows draftId={draftId} findings={blocking} />
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>
            {`${String(warnings.length)} ${warnings.length === 1 ? "warning" : "warnings"}`}
          </AlertTitle>
          <Rows draftId={draftId} findings={warnings} />
        </Alert>
      )}
    </Stack>
  );
}

function Rows({
  draftId,
  findings,
}: {
  draftId: string;
  findings: readonly Finding[];
}) {
  return (
    <Stack component="ul" spacing={0.75} sx={{ listStyle: "none", m: 0, p: 0 }}>
      {findings.map((finding, index) => {
        const href = findingHref(draftId, finding);
        const label = `${finding.message} — ${finding.subject} · ${finding.code}`;
        return (
          <Box
            component="li"
            key={`${finding.code}-${finding.subject}-${String(index)}`}
          >
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: "flex-start" }}
            >
              {finding.level === "blocking" ? (
                <ErrorOutlineIcon fontSize="small" color="error" />
              ) : (
                <WarningAmberOutlinedIcon fontSize="small" color="warning" />
              )}
              <Typography variant="body2" sx={{ minWidth: 0 }}>
                {href === null ? (
                  label
                ) : (
                  <Box
                    component={Link}
                    to={href}
                    sx={{ color: "inherit" }}
                    aria-label={`Open ${label}`}
                  >
                    {label}
                  </Box>
                )}
              </Typography>
            </Stack>
          </Box>
        );
      })}
    </Stack>
  );
}
