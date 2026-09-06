import { createContext, useCallback, useContext } from "react";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

/**
 * Whether the document on screen is written down.
 *
 * The shell owns it rather than each editor, because the answer belongs in
 * the top bar next to the draft (§4.2): an editor must never have to guess
 * whether what they typed survived. Screens report into it; the bar reads
 * it. The full dirty/clean guard and conflict recovery is #355 — this is
 * the state it will hang from.
 */
export type SaveState = "idle" | "unsaved" | "saving" | "saved" | "error";

export interface SaveStatus {
  state: SaveState;
  /** When the state was last set, for "saved 2 minutes ago". */
  at: number;
  /** What went wrong, when something did. */
  message: string | null;
}

const SaveStatusContext = createContext<SaveStatus | null>(null);
const SetSaveStatusContext = createContext<
  ((state: SaveState, message?: string) => void) | null
>(null);

const IDLE: SaveStatus = { state: "idle", at: 0, message: null };

export function SaveStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SaveStatus & { path: string }>({
    ...IDLE,
    path: "",
  });
  const { pathname } = useLocation();

  // The address is closed over rather than kept in a ref: a screen's own
  // effects run before the provider's, so a ref synced in an effect would
  // file the first report after any navigation under the address it just
  // left, and the reading would be thrown away as stale.
  //
  // Reporting the same thing twice is not a change. Screens re-assert their
  // state after every commit — a tab is a route segment now, and the status is
  // scoped to the address it was reported from — so an unconditional setState
  // here would be a render loop.
  const report = useCallback(
    (state: SaveState, message?: string) => {
      const text = message ?? null;
      setStatus((current) => {
        if (
          current.state === state &&
          current.message === text &&
          current.path === pathname
        ) {
          return current;
        }
        return {
          state,
          // The same state carried to another tab is the same event; only a
          // change of state restarts the clock behind "saved 2 minutes ago".
          at: current.state === state ? current.at : Date.now(),
          message: text,
          path: pathname,
        };
      });
    },
    [pathname],
  );

  // Leaving a screen leaves its save state behind with it: "saved" from the
  // previous document would be a lie on the next one. Which screen the
  // status belongs to is compared while reading rather than reset in an
  // effect, so no navigation costs a second render.
  const value = useMemo(
    () => (status.path === pathname ? status : IDLE),
    [status, pathname],
  );

  return (
    <SaveStatusContext.Provider value={value}>
      <SetSaveStatusContext.Provider value={report}>
        {children}
      </SetSaveStatusContext.Provider>
    </SaveStatusContext.Provider>
  );
}

export function useSaveStatus(): SaveStatus {
  return useContext(SaveStatusContext) ?? IDLE;
}

/** Reports what the current screen is doing with its document. */
export function useReportSaveStatus(): (
  state: SaveState,
  message?: string,
) => void {
  const report = useContext(SetSaveStatusContext);
  return useMemo(() => report ?? (() => undefined), [report]);
}
