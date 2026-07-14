export const WORKSPACE_DATABASE_NAME = "freeform-artifacts";
export const WORKSPACE_DATABASE_VERSION = 3;
export const WORKSPACE_STORE = "workspaces";
export const ARTIFACT_PACKAGE_STORE = "artifact-packages";
export const RELAY_RECEIPT_STORE = "relay-receipts";

export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(WORKSPACE_DATABASE_NAME, WORKSPACE_DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE)) {
        database.createObjectStore(WORKSPACE_STORE, { keyPath: "templateId" });
      }
      if (!database.objectStoreNames.contains(ARTIFACT_PACKAGE_STORE)) {
        database.createObjectStore(ARTIFACT_PACKAGE_STORE, { keyPath: "artifactId" });
      }
      if (!database.objectStoreNames.contains(RELAY_RECEIPT_STORE)) {
        database.createObjectStore(RELAY_RECEIPT_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open the local workspace database"));
    request.onblocked = () => reject(new Error("The local workspace database is blocked by another tab"));
  });
}
