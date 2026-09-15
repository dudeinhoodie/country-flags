import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { RuntimeConfig } from "./runtime-config";

const RuntimeConfigContext = createContext<RuntimeConfig | undefined>(
  undefined,
);

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: ReactNode;
}) {
  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig(): RuntimeConfig {
  const config = useContext(RuntimeConfigContext);
  if (config === undefined) {
    throw new Error(
      "useRuntimeConfig must be used inside a RuntimeConfigProvider",
    );
  }
  return config;
}
