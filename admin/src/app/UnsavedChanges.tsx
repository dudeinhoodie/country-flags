import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import { createContext, useCallback, useContext, useEffect } from "react";
import { useRef } from "react";
import type { ReactNode } from "react";
import { useBlocker } from "react-router-dom";

/**
 * Nothing typed is lost by walking away from it (§9).
 *
 * The shell owns the guard rather than each editor: leaving is done through
 * the menu, the draft selector, the search box and the browser's own back
 * button, none of which an editor can see. Screens report whether they hold
 * unwritten changes; this asks the question when someone tries to leave.
 *
 * The answer lives in a ref rather than in state because navigation is
 * decided synchronously, inside the `navigate()` call: an editor that saved
 * and then redirected would still be marked dirty in the render that has not
 * happened yet, and would be asked to confirm leaving a form it just wrote.
 */

type ReportDirty = (dirty: boolean, within: string) => void;

/** What the shell is holding on behalf of the screen inside it. */
export interface UnsavedState {
  dirty: boolean;
  /** The editor's own address; everything under it is still this screen. */
  within: string;
}

/**
 * Whether leaving here has to be confirmed.
 *
 * Moving between the tabs of one editor is not leaving it: the tab is a route
 * segment, and a form that asked to be confirmed on every tab would make its
 * own addressing unusable. The segment boundary is the whole test —
 * `country.india` is a prefix of `country.indonesia`, and a bare `startsWith`
 * would walk from one country to the other in silence.
 */
export function shouldConfirmLeaving(
  held: UnsavedState,
  from: string,
  to: string,
): boolean {
  if (!held.dirty || from === to) {
    return false;
  }
  if (held.within === "") {
    return true;
  }
  return !(to === held.within || to.startsWith(`${held.within}/`));
}

const UnsavedChangesContext = createContext<ReportDirty | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const held = useRef({ dirty: false, within: "" });

  const report = useCallback<ReportDirty>((dirty, within) => {
    held.current = { dirty, within };
  }, []);

  // A stable predicate reading a live ref: react-router only re-subscribes
  // when the function's identity changes, and the answer must be current
  // rather than as of the last render.
  const blocker = useBlocker(
    useCallback(
      ({
        currentLocation,
        nextLocation,
      }: {
        currentLocation: { pathname: string };
        nextLocation: { pathname: string };
      }) =>
        shouldConfirmLeaving(
          held.current,
          currentLocation.pathname,
          nextLocation.pathname,
        ),
      [],
    ),
  );

  // Closing the tab is the one exit the router never sees. The browser shows
  // its own wording here; the listener is what makes it appear at all.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!held.current.dirty) {
        return;
      }
      // `preventDefault` is what a current browser reads. The console does
      // not also set the deprecated `returnValue`: the browsers that needed
      // it are older than the ones this admin is served to.
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  return (
    <UnsavedChangesContext.Provider value={report}>
      {children}
      <Dialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        aria-labelledby="unsaved-changes-title"
      >
        <DialogTitle id="unsaved-changes-title">
          Leave without saving?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            This screen holds changes that have not been written to the draft.
            Leaving now throws them away.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => blocker.reset?.()} autoFocus>
            Keep editing
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => {
              held.current = { dirty: false, within: "" };
              blocker.proceed?.();
            }}
          >
            Discard changes and leave
          </Button>
        </DialogActions>
      </Dialog>
    </UnsavedChangesContext.Provider>
  );
}

const noReport: ReportDirty = () => undefined;

export interface UnsavedChangesHandle {
  /**
   * Says the screen may be left without a question — for the moment after a
   * successful save, when the editor navigates itself.
   */
  allowLeaving: () => void;
}

/**
 * Tells the shell whether this screen holds unwritten changes.
 *
 * `within` is the editor's own address: everything under it is still this
 * screen, tabs included. Mounted outside the shell — as an editor's own tests
 * do — this is a no-op, so a screen never depends on the guard to render.
 */
export function useUnsavedChanges(
  dirty: boolean,
  within = "",
): UnsavedChangesHandle {
  const report = useContext(UnsavedChangesContext) ?? noReport;

  // No dependency list. `allowLeaving` writes the ref behind React's back for
  // the moment between a successful save and the redirect it triggers, and a
  // list would leave that disarmed for good whenever the form is dirty on
  // both sides of the save — which it is if the editor typed while the write
  // was in flight. Re-asserting the truth after every commit is what makes
  // the shortcut safe: it lasts exactly as long as the navigation.
  useEffect(() => {
    report(dirty, within);
  });

  // Leaving the screen leaves its unsaved state behind with it; the next one
  // answers for itself.
  useEffect(
    () => () => {
      report(false, "");
    },
    [report],
  );

  return {
    allowLeaving: useCallback(() => {
      report(false, "");
    }, [report]),
  };
}
