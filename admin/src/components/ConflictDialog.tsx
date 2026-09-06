import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import type { DraftConflict } from "../api/draft-conflict";
import { relativeTime } from "./relative-time";

/** One field this editor changed and has not managed to write down. */
export interface UnsavedChange {
  label: string;
  value: string;
}

/**
 * A save refused because somebody else got there first (§9).
 *
 * The refusal is not an error to dismiss: the values on screen are still the
 * only copy of this editor's work, so the dialog puts them somewhere they can
 * be taken from before it offers to throw them away. Reload is deliberate and
 * named; there is no path here that quietly overwrites the other revision.
 */
export function ConflictDialog({
  conflict,
  changes,
  viewerId,
  onReload,
  onClose,
}: {
  conflict: DraftConflict;
  /** What this editor changed, in words, for the copy-out. */
  changes: readonly UnsavedChange[];
  /** Who is reading, when the console knows — the winner may be them. */
  viewerId: string | null;
  /** Re-reads the draft and reseeds the form from it. */
  onReload: () => void;
  onClose: () => void;
}) {
  const who =
    conflict.updatedByAdminUserId === null
      ? "This draft was saved elsewhere"
      : viewerId !== null && conflict.updatedByAdminUserId === viewerId
        ? "You saved this draft somewhere else"
        : "Another editor saved this draft";
  const [copied, setCopied] = useState(false);
  const text = changes
    .map((change) => `${change.label}: ${change.value}`)
    .join("\n");

  function copy(): void {
    // A console served over plain HTTP has no working clipboard API, which
    // is why the values are also on screen to select: the copy button is a
    // convenience, never the only way out.
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
      })
      .catch(() => {
        setCopied(false);
      });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="draft-conflict-title"
    >
      <DialogTitle id="draft-conflict-title">
        This draft moved while you were editing
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            {who}
            {conflict.updatedAt === null
              ? ""
              : ` ${relativeTime(conflict.updatedAt)}`}
            . It is now at revision{" "}
            {conflict.currentRevision === null
              ? "a newer one"
              : String(conflict.currentRevision)}
            , and this screen was written against revision{" "}
            {conflict.expectedRevision === null
              ? "an older one"
              : String(conflict.expectedRevision)}
            . Nothing was saved, and nothing was overwritten.
          </DialogContentText>
          {changes.length === 0 ? (
            <Alert severity="info">
              This screen holds no field changes of its own to carry over.
            </Alert>
          ) : (
            <Stack spacing={1}>
              <Typography variant="subtitle2" component="h3">
                What you changed
              </Typography>
              <TextField
                label="Your unsaved values"
                value={text}
                multiline
                minRows={Math.min(changes.length, 8)}
                slotProps={{ htmlInput: { readOnly: true } }}
                helperText="Copy these, reload, and put them back on the fresh revision."
                fullWidth
                size="small"
              />
              {copied && (
                <Typography
                  variant="caption"
                  role="status"
                  color="success.main"
                >
                  Copied to the clipboard.
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Keep editing</Button>
        {changes.length > 0 && (
          <Button onClick={copy}>Copy my unsaved values</Button>
        )}
        <Button variant="contained" onClick={onReload}>
          Reload the draft
        </Button>
      </DialogActions>
    </Dialog>
  );
}
