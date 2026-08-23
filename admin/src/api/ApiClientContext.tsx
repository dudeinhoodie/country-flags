import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { AdminApiClient } from "./client";

const ApiClientContext = createContext<AdminApiClient | undefined>(undefined);

export function ApiClientProvider({
  client,
  children,
}: {
  client: AdminApiClient;
  children: ReactNode;
}) {
  return (
    <ApiClientContext.Provider value={client}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useAdminApiClient(): AdminApiClient {
  const client = useContext(ApiClientContext);
  if (client === undefined) {
    throw new Error("useAdminApiClient must be used inside ApiClientProvider");
  }
  return client;
}
