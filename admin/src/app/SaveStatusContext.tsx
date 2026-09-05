import { createContext, useCallback, useContext, useEffect } from "react";
import { useMemo, useRef, useState } from "react";
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
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  const report = useCallback((state: SaveState, message?: string) => {
    setStatus({
      state,
      at: Date.now(),
      message: message ?? null,
      path: pathRef.current,
    });
  }, []);

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
