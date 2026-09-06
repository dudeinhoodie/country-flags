import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AdminFeature, RuntimeConfig } from "./runtime-config";

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

/**
 * Whether this deployment turns a flag on.
 *
 * Unlike the config itself this is lenient about being asked outside a
 * provider, because the answer is well defined without one: a screen mounted
 * with no deployment behind it has no flags turned on. A feature that fails
 * closed is the safe direction for every flag the console has.
 */
export function useFeature(name: AdminFeature): boolean {
  return useContext(RuntimeConfigContext)?.features[name] === true;
}
