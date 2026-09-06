import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { useState } from "react";
import { useRuntimeConfig } from "../../config/RuntimeConfigContext";

/**
 * The last thing between an operator and a release.
 *
 * In dev it is a plain confirmation: a wrong publish there costs a rerun. In
 * production the version has to be typed out, because the difference between
 * the release meant and the one beside it in a list is one click, and the
 * cost of getting it wrong is what every client reads (docs/19 §4.2, §8.4).
 * Typing is the one interaction muscle memory cannot perform by accident.
 */
export function ConfirmReleaseDialog(props: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  /** The exact string production asks to have typed back. */
  phrase: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Nothing exists while it is closed, so the box below is empty every time
  // it opens rather than carrying the phrase of the release somebody was
  // looking at a moment ago. Clearing it from an effect would be the same
  // thing said less directly.
  if (!props.open) {
    return null;
  }
  return <ConfirmReleaseDialogBody {...props} />;
}

function ConfirmReleaseDialogBody({
  title,
  description,
  confirmLabel,
  phrase,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  phrase: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { environment } = useRuntimeConfig();
  const typed = environment === "prod";
  const [entered, setEntered] = useState("");

  const matches = !typed || entered.trim() === phrase;

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <DialogContentText>{description}</DialogContentText>
          {typed && (
            <>
              <Alert severity="error">
                This is production. Every installed app reads the result.
              </Alert>
              <TextField
                label={`Type ${phrase} to confirm`}
                size="small"
                autoFocus
                value={entered}
                onChange={(event) => {
                  setEntered(event.target.value);
                }}
                slotProps={{
                  htmlInput: { "aria-label": "confirmation phrase" },
                }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          color={typed ? "error" : "primary"}
          disabled={busy || !matches}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
