import type { DataProvider } from "react-admin";

function notImplemented(method: string): () => Promise<never> {
  return () =>
    Promise.reject(
      new Error(
        `Admin data provider method "${method}" is not implemented yet; it arrives with the first resource screens.`,
      ),
    );
}

/**
 * No resources are registered yet, so nothing calls this in normal operation.
 * It exists to fail loudly if a future screen forgets to bring the real
 * DataProvider along.
 */
export const placeholderDataProvider = {
  getList: notImplemented("getList"),
  getOne: notImplemented("getOne"),
  getMany: notImplemented("getMany"),
  getManyReference: notImplemented("getManyReference"),
  create: notImplemented("create"),
  update: notImplemented("update"),
  updateMany: notImplemented("updateMany"),
  delete: notImplemented("delete"),
  deleteMany: notImplemented("deleteMany"),
} as unknown as DataProvider;
