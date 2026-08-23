import { useEffect, useState } from "react";
import { BlockingScreen } from "../components/BlockingScreen";
import {
  loadRuntimeConfig,
  RUNTIME_CONFIG_URL,
  RuntimeConfigError,
} from "../config/runtime-config";
import type { RuntimeConfig } from "../config/runtime-config";
import { AdminApp } from "./AdminApp";

type BootstrapState =
  | { status: "loading" }
  | { status: "blocked"; error: unknown }
  | { status: "ready"; config: RuntimeConfig };

export function Bootstrap() {
  const [state, setState] = useState<BootstrapState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadRuntimeConfig().then(
      (config) => {
        if (!cancelled) {
          setState({ status: "ready", config });
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: "blocked", error });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return null;
  }
  if (state.status === "blocked") {
    const error = state.error;
    return (
      <BlockingScreen
        title="The admin console cannot start"
        message={
          error instanceof Error
            ? error.message
            : `Loading ${RUNTIME_CONFIG_URL} failed`
        }
        problems={error instanceof RuntimeConfigError ? error.problems : []}
        hint="The runtime config is written by the container at startup; a broken config means a broken deployment, not a user mistake."
      />
    );
  }
  return <AdminApp config={state.config} />;
}
