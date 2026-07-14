import { expect, test, type Page } from "@playwright/test";
import type { WorkspaceRecord } from "../src/workspaces/types";

const DATABASE_NAME = "freeform-artifacts";
const DATABASE_VERSION = 3;
const WORKSPACE_STORE = "workspaces";
const ARTIFACT_PACKAGE_STORE = "artifact-packages";
const RELAY_RECEIPT_STORE = "relay-receipts";

async function waitForCanvas(page: Page) {
  await page.goto("/");
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__?.templateId ?? ""))
    .not.toBe("");
  await page.waitForTimeout(750);
}

async function renameActiveWorkspace(page: Page, title: string) {
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill(title);
  await page.getByTestId("canvas-title-input").press("Enter");
}

async function holdWorkspaceWriteLock(page: Page, workspaceId: string) {
  const lockName = `freeform-artifacts.workspace-write:${encodeURIComponent(workspaceId)}`;
  await page.evaluate((name) => {
    const control = window as Window & {
      __freeformWorkspaceLockHeld?: boolean;
      __freeformReleaseWorkspaceLock?: () => void;
    };
    void navigator.locks.request(name, async () => {
      control.__freeformWorkspaceLockHeld = true;
      await new Promise<void>((resolve) => {
        control.__freeformReleaseWorkspaceLock = resolve;
      });
    });
  }, lockName);
  await expect.poll(() => page.evaluate(() => Boolean(
    (window as Window & { __freeformWorkspaceLockHeld?: boolean }).__freeformWorkspaceLockHeld,
  ))).toBe(true);
  return {
    name: lockName,
    release: () => page.evaluate(() => {
      const control = window as Window & { __freeformReleaseWorkspaceLock?: () => void };
      control.__freeformReleaseWorkspaceLock?.();
      delete control.__freeformReleaseWorkspaceLock;
      delete (control as Window & { __freeformWorkspaceLockHeld?: boolean }).__freeformWorkspaceLockHeld;
    }),
  };
}

async function pendingWorkspaceWriteLocks(page: Page, lockName: string) {
  return page.evaluate(async (name) => {
    const snapshot = await navigator.locks.query();
    return snapshot.pending?.filter((lock) => lock.name === name).length ?? 0;
  }, lockName);
}

async function readIndexedWorkspace(page: Page, workspaceId: string) {
  return page.evaluate(async ({ databaseName, databaseVersion, storeName, id }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<WorkspaceRecord | null>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = () => resolve((request.result as WorkspaceRecord | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    storeName: WORKSPACE_STORE,
    id: workspaceId,
  });
}

test("legacy workspace records receive one stable persisted incarnation", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async ({ databaseName, databaseVersion, storeName }) => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");
    const workspaceId = `legacy-${crypto.randomUUID()}`;
    const legacy = {
      ...source.workspace,
      templateId: workspaceId,
      revision: 0,
      updatedAt: new Date().toISOString(),
    } as Partial<WorkspaceRecord>;
    delete legacy.incarnationId;

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(legacy);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
    localStorage.setItem(`freeform-artifacts.workspace.${workspaceId}.v1`, JSON.stringify(legacy));

    const loaded = await storage.loadWorkspaceById(workspaceId);
    if (!loaded) throw new Error("Legacy workspace was not loaded");
    const persistedDatabase = await storage.openDatabase();
    const persisted = await new Promise<WorkspaceRecord>((resolve, reject) => {
      const request = persistedDatabase.transaction(storeName, "readonly").objectStore(storeName).get(workspaceId);
      request.onsuccess = () => resolve(request.result as WorkspaceRecord);
      request.onerror = () => reject(request.error);
    });
    persistedDatabase.close();
    const fallback = JSON.parse(
      localStorage.getItem(`freeform-artifacts.workspace.${workspaceId}.v1`) ?? "null",
    ) as WorkspaceRecord;
    return {
      expected: `legacy:${encodeURIComponent(workspaceId)}`,
      fallbackIncarnationId: fallback.incarnationId,
      loadedIncarnationId: loaded.workspace.incarnationId,
      persistedIncarnationId: persisted.incarnationId,
    };
  }, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION, storeName: WORKSPACE_STORE });

  expect(result.loadedIncarnationId).toBe(result.expected);
  expect(result.persistedIncarnationId).toBe(result.expected);
  expect(result.fallbackIncarnationId).toBe(result.expected);
});

test("restore creates a new incarnation that invalidates every old write path", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async ({ packageStoreName, receiptStoreName }) => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");
    const workspaceId = `restore-cas-${crypto.randomUUID()}`;
    const created = await storage.saveWorkspace({
      ...source.workspace,
      templateId: workspaceId,
      revision: 0,
      incarnationId: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    });
    const deleted = await storage.deleteWorkspace(workspaceId, created.workspace);
    if (!deleted?.deletionId) throw new Error("Expected durable deletion generation");
    await storage.restoreWorkspace(deleted.workspace, 0, deleted.deletionId);
    const restored = await storage.loadWorkspaceById(workspaceId);
    if (!restored) throw new Error("Expected restored workspace");

    let staleSaveError = "";
    try {
      await storage.saveWorkspace({
        ...deleted.workspace,
        title: "Stale incarnation write",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      staleSaveError = error instanceof Error ? error.name : "unknown";
    }

    const deliveryId = crypto.randomUUID();
    const receiptId = storage.relayReceiptId("restore-cas-session", deliveryId);
    const artifactId = `restore-cas-artifact-${crypto.randomUUID()}`;
    let staleCommitError = "";
    try {
      await storage.commitWorkspaceWithArtifactPackages(
        deleted.workspace,
        [{ artifactId, moduleSource: "export const artifact = {};" }],
        {
          id: receiptId,
          sessionId: "restore-cas-session",
          deliveryId,
          targetViewId: workspaceId,
          targetViewIncarnationId: deleted.workspace.incarnationId,
          artifactIds: [artifactId],
          nodeIds: [],
          installedAt: new Date().toISOString(),
        },
        {
          expectedRevision: deleted.workspace.revision,
          expectedIncarnationId: deleted.workspace.incarnationId,
        },
      );
    } catch (error) {
      staleCommitError = error instanceof Error ? error.name : "unknown";
    }

    const database = await storage.openDatabase();
    const [artifact, receipt] = await Promise.all([
      new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(packageStoreName, "readonly")
          .objectStore(packageStoreName).get(artifactId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
      new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(receiptStoreName, "readonly")
          .objectStore(receiptStoreName).get(receiptId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
    ]);
    database.close();
    return {
      artifactExists: artifact !== undefined,
      oldIncarnationId: deleted.workspace.incarnationId,
      receiptExists: receipt !== undefined,
      restoredIncarnationId: restored.workspace.incarnationId,
      staleCommitError,
      staleSaveError,
    };
  }, { packageStoreName: ARTIFACT_PACKAGE_STORE, receiptStoreName: RELAY_RECEIPT_STORE });

  expect(result.restoredIncarnationId).not.toBe(result.oldIncarnationId);
  expect(result.staleSaveError).toBe("WorkspaceConflictError");
  expect(result.staleCommitError).toBe("WorkspaceConflictError");
  expect(result.artifactExists).toBe(false);
  expect(result.receiptExists).toBe(false);
});

test("a cross-tab revision conflict rolls back package, workspace, and receipt together", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const writer = await context.newPage();
    const staleInstaller = await context.newPage();
    await waitForCanvas(writer);
    await waitForCanvas(staleInstaller);

    const created = await writer.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `cross-tab-cas-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const staleWorkspace = await staleInstaller.evaluate(async (workspaceId) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const loaded = await storage.loadWorkspaceById(workspaceId);
      if (!loaded) throw new Error("Expected shared browser-profile workspace");
      return loaded.workspace;
    }, created.templateId);
    await writer.evaluate(async (workspaceId) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const current = await storage.loadWorkspaceById(workspaceId);
      if (!current) throw new Error("Expected current workspace");
      await storage.saveWorkspace({
        ...current.workspace,
        title: "Concurrent writer won",
        updatedAt: new Date().toISOString(),
      });
    }, created.templateId);

    const attempt = await staleInstaller.evaluate(async ({ workspace, packageStoreName, receiptStoreName }) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const artifactId = `cross-tab-artifact-${crypto.randomUUID()}`;
      const deliveryId = crypto.randomUUID();
      const receiptId = storage.relayReceiptId("cross-tab-cas-session", deliveryId);
      let errorName = "";
      try {
        await storage.commitWorkspaceWithArtifactPackages(
          { ...workspace, title: "Stale installer lost", updatedAt: new Date().toISOString() },
          [{ artifactId, moduleSource: "export const artifact = {};" }],
          {
            id: receiptId,
            sessionId: "cross-tab-cas-session",
            deliveryId,
            targetViewId: workspace.templateId,
            targetViewIncarnationId: workspace.incarnationId,
            artifactIds: [artifactId],
            nodeIds: [],
            installedAt: new Date().toISOString(),
          },
          {
            expectedRevision: workspace.revision,
            expectedIncarnationId: workspace.incarnationId,
          },
        );
      } catch (error) {
        errorName = error instanceof Error ? error.name : "unknown";
      }
      const database = await storage.openDatabase();
      const read = (storeName: string, key: string) => new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [workspaceAfter, artifact, receipt] = await Promise.all([
        read("workspaces", workspace.templateId),
        read(packageStoreName, artifactId),
        read(receiptStoreName, receiptId),
      ]);
      database.close();
      return {
        artifactExists: artifact !== undefined,
        errorName,
        receiptExists: receipt !== undefined,
        workspaceTitle: (workspaceAfter as WorkspaceRecord).title,
      };
    }, {
      workspace: staleWorkspace,
      packageStoreName: ARTIFACT_PACKAGE_STORE,
      receiptStoreName: RELAY_RECEIPT_STORE,
    });

    expect(attempt.errorName).toBe("WorkspaceConflictError");
    expect(attempt.workspaceTitle).toBe("Concurrent writer won");
    expect(attempt.artifactExists).toBe(false);
    expect(attempt.receiptExists).toBe(false);
  } finally {
    await context.close();
  }
});

test("a deletion queued first holds the cross-tab lock through relay commit", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const lockOwner = await context.newPage();
    await waitForCanvas(lockOwner);
    const workspace = await lockOwner.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `delete-lock-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        title: "Delete lock target",
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const deleter = await context.newPage();
    await waitForCanvas(deleter);
    const installer = await context.newPage();
    await waitForCanvas(installer);
    const heldLock = await holdWorkspaceWriteLock(lockOwner, workspace.templateId);

    const deletion = deleter.evaluate(async (currentWorkspace) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return Boolean(await storage.deleteWorkspace(currentWorkspace.templateId, currentWorkspace));
    }, workspace);
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(1);

    const artifactId = `delete-lock-artifact-${crypto.randomUUID()}`;
    const deliveryId = crypto.randomUUID();
    const receiptId = `delete-lock-session:${deliveryId}`;
    const installation = installer.evaluate(async ({ currentWorkspace, id, delivery, receipt }) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      try {
        await storage.commitWorkspaceWithArtifactPackages(
          { ...currentWorkspace, title: "Must not install", updatedAt: new Date().toISOString() },
          [{ artifactId: id, moduleSource: "export const artifact = {};" }],
          {
            id: receipt,
            sessionId: "delete-lock-session",
            deliveryId: delivery,
            targetViewId: currentWorkspace.templateId,
            targetViewIncarnationId: currentWorkspace.incarnationId,
            artifactIds: [id],
            nodeIds: [],
            installedAt: new Date().toISOString(),
          },
          {
            expectedRevision: currentWorkspace.revision,
            expectedIncarnationId: currentWorkspace.incarnationId,
          },
        );
        return "committed";
      } catch (error) {
        return error instanceof Error ? error.name : "unknown";
      }
    }, { currentWorkspace: workspace, id: artifactId, delivery: deliveryId, receipt: receiptId });
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(2);

    await heldLock.release();
    expect(await deletion).toBe(true);
    expect(await installation).toBe("WorkspaceDeletedError");

    const committed = await installer.evaluate(async ({ packageStoreName, receiptStoreName, id, receipt }) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const database = await storage.openDatabase();
      try {
        const read = (storeName: string, key: string) => new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const [artifact, relayReceipt] = await Promise.all([
          read(packageStoreName, id),
          read(receiptStoreName, receipt),
        ]);
        return { artifact: artifact !== undefined, receipt: relayReceipt !== undefined };
      } finally {
        database.close();
      }
    }, { packageStoreName: ARTIFACT_PACKAGE_STORE, receiptStoreName: RELAY_RECEIPT_STORE, id: artifactId, receipt: receiptId });
    expect(committed).toEqual({ artifact: false, receipt: false });
    expect(await readIndexedWorkspace(installer, workspace.templateId)).toBeNull();
  } finally {
    await context.close();
  }
});

test("ending a relay install aborts its pending cross-tab lock request", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const lockOwner = await context.newPage();
    await waitForCanvas(lockOwner);
    const workspace = await lockOwner.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `abort-lock-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        title: "Abort lock target",
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const installer = await context.newPage();
    await waitForCanvas(installer);
    const heldLock = await holdWorkspaceWriteLock(lockOwner, workspace.templateId);
    const artifactId = `abort-lock-artifact-${crypto.randomUUID()}`;
    const deliveryId = crypto.randomUUID();
    const receiptId = `abort-lock-session:${deliveryId}`;

    await installer.evaluate(({ currentWorkspace, id, delivery, receipt }) => {
      const control = window as Window & {
        __freeformAbortPendingInstall?: () => void;
        __freeformPendingInstallResult?: Promise<string>;
      };
      const controller = new AbortController();
      control.__freeformAbortPendingInstall = () => controller.abort();
      control.__freeformPendingInstallResult = (async () => {
        const moduleUrl = "/src/workspaces/storage.ts";
        const storage = await import(/* @vite-ignore */ moduleUrl) as
          typeof import("../src/workspaces/storage");
        try {
          await storage.commitWorkspaceWithArtifactPackages(
            { ...currentWorkspace, title: "Must abort", updatedAt: new Date().toISOString() },
            [{ artifactId: id, moduleSource: "export const artifact = {};" }],
            {
              id: receipt,
              sessionId: "abort-lock-session",
              deliveryId: delivery,
              targetViewId: currentWorkspace.templateId,
              targetViewIncarnationId: currentWorkspace.incarnationId,
              artifactIds: [id],
              nodeIds: [],
              installedAt: new Date().toISOString(),
            },
            {
              expectedRevision: currentWorkspace.revision,
              expectedIncarnationId: currentWorkspace.incarnationId,
              signal: controller.signal,
            },
          );
          return "committed";
        } catch (error) {
          return error instanceof Error ? error.name : "unknown";
        }
      })();
    }, { currentWorkspace: workspace, id: artifactId, delivery: deliveryId, receipt: receiptId });
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(1);
    await installer.evaluate(() => {
      (window as Window & { __freeformAbortPendingInstall?: () => void }).__freeformAbortPendingInstall?.();
    });
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(0);
    await expect.poll(() => installer.evaluate(async () => {
      const result = (window as Window & { __freeformPendingInstallResult?: Promise<string> })
        .__freeformPendingInstallResult;
      return result ? await result : "pending";
    })).toBe("AbortError");
    await heldLock.release();

    const committed = await installer.evaluate(async ({ packageStoreName, receiptStoreName, id, receipt }) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const database = await storage.openDatabase();
      try {
        const read = (storeName: string, key: string) => new Promise<unknown>((resolve, reject) => {
          const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const [artifact, relayReceipt] = await Promise.all([
          read(packageStoreName, id),
          read(receiptStoreName, receipt),
        ]);
        return { artifact: artifact !== undefined, receipt: relayReceipt !== undefined };
      } finally {
        database.close();
      }
    }, { packageStoreName: ARTIFACT_PACKAGE_STORE, receiptStoreName: RELAY_RECEIPT_STORE, id: artifactId, receipt: receiptId });
    expect(committed).toEqual({ artifact: false, receipt: false });
    expect(await readIndexedWorkspace(installer, workspace.templateId)).toMatchObject({
      incarnationId: workspace.incarnationId,
      revision: workspace.revision,
    });
  } finally {
    await context.close();
  }
});

test("an abort after transaction writes are staged rolls back package, workspace, and receipt", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async ({ packageStoreName, receiptStoreName, workspaceStoreName }) => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");
    const workspaceId = `abort-rollback-${crypto.randomUUID()}`;
    const created = (await storage.saveWorkspace({
      ...source.workspace,
      templateId: workspaceId,
      revision: 0,
      incarnationId: crypto.randomUUID(),
      title: "Before aborted transaction",
      updatedAt: new Date().toISOString(),
    })).workspace;
    const artifactId = `abort-artifact-${crypto.randomUUID()}`;
    const deliveryId = crypto.randomUUID();
    const receiptId = storage.relayReceiptId("abort-rollback-session", deliveryId);
    const controller = new AbortController();
    const nativePut = IDBObjectStore.prototype.put;
    let writesStaged = false;
    IDBObjectStore.prototype.put = function stagedPut(
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      const request = key === undefined
        ? nativePut.call(this, value)
        : nativePut.call(this, value, key);
      const candidate = value as Partial<WorkspaceRecord>;
      if (!writesStaged && this.name === workspaceStoreName &&
        candidate.templateId === workspaceId && candidate.revision === created.revision + 1) {
        writesStaged = true;
        queueMicrotask(() => controller.abort());
      }
      return request;
    } as IDBObjectStore["put"];

    let errorName = "";
    try {
      await storage.commitWorkspaceWithArtifactPackages(
        {
          ...created,
          title: "Must roll back",
          updatedAt: new Date().toISOString(),
        },
        [{ artifactId, moduleSource: "export const artifact = {};" }],
        {
          id: receiptId,
          sessionId: "abort-rollback-session",
          deliveryId,
          targetViewId: workspaceId,
          targetViewIncarnationId: created.incarnationId,
          artifactIds: [artifactId],
          nodeIds: [],
          installedAt: new Date().toISOString(),
        },
        {
          expectedRevision: created.revision,
          expectedIncarnationId: created.incarnationId,
          signal: controller.signal,
        },
      );
    } catch (error) {
      errorName = error instanceof Error ? error.name : "unknown";
    } finally {
      IDBObjectStore.prototype.put = nativePut;
    }

    const database = await storage.openDatabase();
    const transaction = database.transaction(
      [workspaceStoreName, packageStoreName, receiptStoreName],
      "readonly",
    );
    const read = (storeName: string, key: string) => new Promise<unknown>((resolve, reject) => {
      const request = transaction.objectStore(storeName).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [workspaceAfter, artifactAfter, receiptAfter] = await Promise.all([
      read(workspaceStoreName, workspaceId),
      read(packageStoreName, artifactId),
      read(receiptStoreName, receiptId),
    ]);
    database.close();
    return {
      artifactExists: artifactAfter !== undefined,
      errorName,
      receiptExists: receiptAfter !== undefined,
      signalAborted: controller.signal.aborted,
      workspaceRevision: (workspaceAfter as WorkspaceRecord).revision,
      workspaceTitle: (workspaceAfter as WorkspaceRecord).title,
      writesStaged,
      expectedRevision: created.revision,
    };
  }, {
    packageStoreName: ARTIFACT_PACKAGE_STORE,
    receiptStoreName: RELAY_RECEIPT_STORE,
    workspaceStoreName: WORKSPACE_STORE,
  });

  expect(result.writesStaged).toBe(true);
  expect(result.signalAborted).toBe(true);
  expect(result.errorName).toBe("AbortError");
  expect(result.workspaceTitle).toBe("Before aborted transaction");
  expect(result.workspaceRevision).toBe(result.expectedRevision);
  expect(result.artifactExists).toBe(false);
  expect(result.receiptExists).toBe(false);
});

test("recovery mirrors serialize across tabs and cannot regress after a newer write", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await waitForCanvas(first);
    await waitForCanvas(second);

    const created = await first.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `recovery-lock-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        title: "Recovery lock source",
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const lockName = `freeform-artifacts.workspace-write:${encodeURIComponent(created.templateId)}`;
    const acquireLock = () => first.evaluate(async (name) => {
      const control = window as Window & { __freeformReleaseRecoveryLock?: () => void };
      await new Promise<void>((acquired) => {
        void navigator.locks.request(name, { mode: "exclusive" }, async () => {
          acquired();
          await new Promise<void>((release) => {
            control.__freeformReleaseRecoveryLock = release;
          });
        });
      });
    }, lockName);
    const releaseLock = () => first.evaluate(() => {
      const control = window as Window & { __freeformReleaseRecoveryLock?: () => void };
      control.__freeformReleaseRecoveryLock?.();
      delete control.__freeformReleaseRecoveryLock;
    });
    const pendingLocks = () => second.evaluate(async (name) => {
      const snapshot = await navigator.locks.query();
      return (snapshot.pending ?? []).filter((lock) => lock.name === name).length;
    }, lockName);

    await acquireLock();
    let indexedSaveSettled = false;
    const indexedSave = first.evaluate(async (candidate) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return (await storage.saveWorkspace({
        ...candidate,
        title: "Indexed commit waiting for mirror",
        updatedAt: new Date().toISOString(),
      })).workspace;
    }, created).then((workspace) => {
      indexedSaveSettled = true;
      return workspace;
    });
    await expect.poll(async () => (await readIndexedWorkspace(second, created.templateId))?.revision)
      .toBe(created.revision + 1);
    await expect.poll(pendingLocks).toBe(1);
    expect(indexedSaveSettled).toBe(false);
    const mirrorWhileLocked = await second.evaluate((workspaceId) => {
      const value = localStorage.getItem(`freeform-artifacts.workspace.${workspaceId}.v1`);
      return value ? JSON.parse(value) as WorkspaceRecord : null;
    }, created.templateId);
    expect(mirrorWhileLocked?.revision).toBe(created.revision);
    await releaseLock();
    const older = await indexedSave;

    const newer = await second.evaluate(async (candidate) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return (await storage.saveWorkspace({
        ...candidate,
        title: "Newest recovery mirror",
        updatedAt: new Date().toISOString(),
      })).workspace;
    }, older);
    await second.evaluate((candidate) => {
      localStorage.setItem(
        `freeform-artifacts.workspace.${candidate.templateId}.v1`,
        JSON.stringify(candidate),
      );
    }, older);

    await acquireLock();
    const newerMirror = first.evaluate(async (candidate) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return storage.writeWorkspaceRecovery(candidate);
    }, newer);
    await expect.poll(pendingLocks).toBe(1);
    const staleMirror = second.evaluate(async (candidate) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return storage.writeWorkspaceRecovery(candidate);
    }, older);
    await expect.poll(pendingLocks).toBe(2);
    await releaseLock();
    await Promise.all([newerMirror, staleMirror]);

    const finalMirror = await first.evaluate((workspaceId) => {
      const value = localStorage.getItem(`freeform-artifacts.workspace.${workspaceId}.v1`);
      return value ? JSON.parse(value) as WorkspaceRecord : null;
    }, created.templateId);
    expect(finalMirror).toMatchObject({
      incarnationId: newer.incarnationId,
      revision: newer.revision,
      title: "Newest recovery mirror",
    });

    const staleAfterWinner = {
      ...older,
      title: "Stale pagehide after winner",
      updatedAt: new Date(Date.parse(newer.updatedAt) + 1_000).toISOString(),
    };
    await Promise.all([first, second].map((page) => page.evaluate(async (candidate) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return storage.writeWorkspaceEmergencyRecovery(candidate);
    }, staleAfterWinner)));
    const journalBeforeCleanup = await first.evaluate((workspaceId) => {
      const recoveryPrefix = "freeform-artifacts.workspace-recovery.";
      const canonical = JSON.parse(
        localStorage.getItem(`freeform-artifacts.workspace.${workspaceId}.v1`) ?? "null",
      ) as WorkspaceRecord | null;
      const recoveryKeys: string[] = [];
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(recoveryPrefix)) continue;
        const envelope = JSON.parse(localStorage.getItem(key) ?? "null") as
          { workspace?: WorkspaceRecord } | null;
        if (envelope?.workspace?.templateId === workspaceId) recoveryKeys.push(key);
      }
      return { canonical, recoveryKeys };
    }, created.templateId);
    expect(journalBeforeCleanup.canonical).toMatchObject({
      revision: newer.revision,
      title: "Newest recovery mirror",
    });
    expect(journalBeforeCleanup.recoveryKeys).toHaveLength(2);

    const loadedAfterStaleJournals = await second.evaluate(async (workspaceId) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      return (await storage.loadWorkspaceById(workspaceId))?.workspace ?? null;
    }, created.templateId);
    expect(loadedAfterStaleJournals).toMatchObject({
      incarnationId: newer.incarnationId,
      revision: newer.revision,
      title: "Newest recovery mirror",
    });
    await expect.poll(async () => first.evaluate((workspaceId) => {
      const recoveryPrefix = "freeform-artifacts.workspace-recovery.";
      let count = 0;
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (!key?.startsWith(recoveryPrefix)) continue;
        const envelope = JSON.parse(localStorage.getItem(key) ?? "null") as
          { workspace?: WorkspaceRecord } | null;
        if (envelope?.workspace?.templateId === workspaceId) count += 1;
      }
      return count;
    }, created.templateId)).toBe(0);
  } finally {
    await context.close();
  }
});

test("pagehide invalidates queued autosaves before they can erase the latest journal", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const lockOwner = await context.newPage();
    await waitForCanvas(lockOwner);
    const workspace = await lockOwner.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `queued-pagehide-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        title: "Queued recovery base",
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const editor = await context.newPage();
    await editor.goto(`/?view=${encodeURIComponent(workspace.templateId)}`);
    await editor.getByTestId("canvas-stage").waitFor({ state: "visible" });
    await expect.poll(() => editor.evaluate(() => window.__FREEFORM_STATE__?.templateId ?? ""))
      .toBe(workspace.templateId);
    await editor.waitForTimeout(750);
    const heldLock = await holdWorkspaceWriteLock(lockOwner, workspace.templateId);

    await renameActiveWorkspace(editor, "In-flight save A");
    await expect.poll(async () => (await readIndexedWorkspace(editor, workspace.templateId))?.title)
      .toBe("In-flight save A");
    const inFlightCommitted = await readIndexedWorkspace(editor, workspace.templateId);
    if (!inFlightCommitted) throw new Error("Expected in-flight IndexedDB commit");
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(1);

    await renameActiveWorkspace(editor, "Queued save B");
    await editor.waitForTimeout(550);
    await renameActiveWorkspace(editor, "Latest pagehide edit C");
    await editor.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
    });
    await heldLock.release();
    await expect.poll(() => pendingWorkspaceWriteLocks(lockOwner, heldLock.name)).toBe(0);
    await editor.waitForTimeout(650);
    expect(await readIndexedWorkspace(editor, workspace.templateId)).toMatchObject({
      title: "In-flight save A",
      revision: inFlightCommitted.revision,
    });

    await editor.reload();
    await editor.getByTestId("canvas-stage").waitFor({ state: "visible" });
    await expect(editor.getByTestId("canvas-title")).toHaveText("Latest pagehide edit C");
    await expect.poll(async () => (await readIndexedWorkspace(editor, workspace.templateId))?.title)
      .toBe("Latest pagehide edit C");
  } finally {
    await context.close();
  }
});

test("emergency recovery advances only across its own matching in-flight commit", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");

    const createIsolated = async (prefix: string) => (await storage.saveWorkspace({
      ...source.workspace,
      templateId: `${prefix}-${crypto.randomUUID()}`,
      revision: 0,
      incarnationId: crypto.randomUUID(),
      title: "Emergency base",
      updatedAt: new Date().toISOString(),
    })).workspace;
    const saveWinner = async (base: WorkspaceRecord, title: string) => storage.saveWorkspace({
      ...base,
      title,
      updatedAt: new Date(Date.parse(base.updatedAt) + 1_000).toISOString(),
    }).then((saved) => saved.workspace);

    const matchingBase = await createIsolated("emergency-matching");
    const matchingWinner = await saveWinner(matchingBase, "In-flight commit A");
    const matchingDirty = {
      ...matchingBase,
      title: "Dirty edit B after A started",
      updatedAt: new Date(Date.parse(matchingWinner.updatedAt) + 1_000).toISOString(),
    };
    storage.writeWorkspaceEmergencyRecovery(matchingDirty, {
      commitId: matchingWinner.commitId,
      revision: matchingWinner.revision,
      updatedAt: matchingWinner.updatedAt,
    });
    const recovered = await storage.loadWorkspaceById(matchingBase.templateId);

    const staleBase = await createIsolated("emergency-stale");
    const otherTabWinner = await saveWinner(staleBase, "Other tab winner");
    const staleDirty = {
      ...staleBase,
      title: "Stale later pagehide",
      updatedAt: new Date(Date.parse(otherTabWinner.updatedAt) + 2_000).toISOString(),
    };
    storage.writeWorkspaceEmergencyRecovery(staleDirty, {
      commitId: crypto.randomUUID(),
      revision: otherTabWinner.revision,
      updatedAt: otherTabWinner.updatedAt,
    });
    const preserved = await storage.loadWorkspaceById(staleBase.templateId);

    const fallbackBase = await createIsolated("emergency-fallback");
    const fallbackCommitAt = new Date(Date.parse(fallbackBase.updatedAt) + 1_000).toISOString();
    const fallbackCommitId = crypto.randomUUID();
    const fallbackDirty = {
      ...fallbackBase,
      title: "Fallback dirty edit B",
      updatedAt: new Date(Date.parse(fallbackCommitAt) + 1_000).toISOString(),
    };
    storage.writeWorkspaceEmergencyRecovery(fallbackDirty, {
      commitId: fallbackCommitId,
      revision: fallbackBase.revision + 1,
      updatedAt: fallbackCommitAt,
    });
    const prototype = IDBFactory.prototype as IDBFactory & {
      __freeformOriginalOpen?: IDBFactory["open"];
    };
    prototype.__freeformOriginalOpen = prototype.open;
    prototype.open = function unavailableOpen() {
      throw new DOMException("Temporarily unavailable", "InvalidStateError");
    } as IDBFactory["open"];
    let fallbackWinner: WorkspaceRecord;
    let fallbackRecovered: Awaited<ReturnType<typeof storage.loadWorkspaceById>>;
    try {
      fallbackWinner = (await storage.saveWorkspace(
        {
          ...fallbackBase,
          title: "Fallback in-flight commit A",
          updatedAt: fallbackCommitAt,
        },
        { commitId: fallbackCommitId },
      )).workspace;
      fallbackRecovered = await storage.loadWorkspaceById(fallbackBase.templateId);
    } finally {
      if (prototype.__freeformOriginalOpen) prototype.open = prototype.__freeformOriginalOpen;
      delete prototype.__freeformOriginalOpen;
    }
    return {
      fallbackRecoveredRevision: fallbackRecovered?.workspace.revision,
      fallbackRecoveredTitle: fallbackRecovered?.workspace.title,
      fallbackWinnerRevision: fallbackWinner.revision,
      matchingWinnerRevision: matchingWinner.revision,
      otherTabWinnerRevision: otherTabWinner.revision,
      preservedRevision: preserved?.workspace.revision,
      preservedTitle: preserved?.workspace.title,
      recoveredRevision: recovered?.workspace.revision,
      recoveredTitle: recovered?.workspace.title,
    };
  });

  expect(result.recoveredTitle).toBe("Dirty edit B after A started");
  expect(result.recoveredRevision).toBe(result.matchingWinnerRevision + 1);
  expect(result.preservedTitle).toBe("Other tab winner");
  expect(result.preservedRevision).toBe(result.otherTabWinnerRevision);
  expect(result.fallbackRecoveredTitle).toBe("Fallback dirty edit B");
  expect(result.fallbackRecoveredRevision).toBe(result.fallbackWinnerRevision + 1);
});

test("an ambiguous v1 in-flight journal cannot become the fallback baseline", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");
    const base = (await storage.saveWorkspace({
      ...source.workspace,
      templateId: `legacy-v1-recovery-${crypto.randomUUID()}`,
      revision: 0,
      incarnationId: crypto.randomUUID(),
      title: "Legacy recovery base",
      updatedAt: new Date().toISOString(),
    })).workspace;
    const winner = (await storage.saveWorkspace({
      ...base,
      title: "Indexed winner",
      updatedAt: new Date(Date.parse(base.updatedAt) + 1_000).toISOString(),
    })).workspace;
    const ambiguous = {
      ...base,
      title: "Ambiguous legacy dirty state",
      updatedAt: new Date(Date.parse(winner.updatedAt) + 1_000).toISOString(),
    };
    localStorage.setItem(
      `freeform-artifacts.workspace-recovery.${encodeURIComponent(base.templateId)}.legacy.v1`,
      JSON.stringify({
        version: 1,
        workspace: ambiguous,
        expectedCommit: { revision: winner.revision, updatedAt: winner.updatedAt },
      }),
    );
    const fallbackKey = `freeform-artifacts.workspace.${base.templateId}.v1`;
    localStorage.removeItem(fallbackKey);
    const prototype = IDBFactory.prototype as IDBFactory & {
      __freeformOriginalOpen?: IDBFactory["open"];
    };
    prototype.__freeformOriginalOpen = prototype.open;
    prototype.open = function unavailableOpen() {
      throw new DOMException("Temporarily unavailable", "InvalidStateError");
    } as IDBFactory["open"];
    let whileUnavailable: Awaited<ReturnType<typeof storage.loadWorkspaceById>>;
    try {
      whileUnavailable = await storage.loadWorkspaceById(base.templateId);
    } finally {
      if (prototype.__freeformOriginalOpen) prototype.open = prototype.__freeformOriginalOpen;
      delete prototype.__freeformOriginalOpen;
    }
    const canonicalWhileUnavailable = localStorage.getItem(fallbackKey);
    const afterRecovery = await storage.loadWorkspaceById(base.templateId);
    return {
      canonicalWhileUnavailable,
      recoveredRevision: afterRecovery?.workspace.revision,
      recoveredTitle: afterRecovery?.workspace.title,
      unavailableWorkspace: whileUnavailable?.workspace ?? null,
      winnerRevision: winner.revision,
    };
  });

  expect(result.unavailableWorkspace).toBeNull();
  expect(result.canonicalWhileUnavailable).toBeNull();
  expect(result.recoveredTitle).toBe("Indexed winner");
  expect(result.recoveredRevision).toBe(result.winnerRevision);
});

test("localStorage fallback CAS is serialized across pages when IndexedDB fails", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await waitForCanvas(first);
    await waitForCanvas(second);

    const created = await first.evaluate(async () => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const source = await storage.loadWorkspaceById("market-overview");
      if (!source) throw new Error("Expected seeded workspace");
      return (await storage.saveWorkspace({
        ...source.workspace,
        templateId: `fallback-lock-${crypto.randomUUID()}`,
        revision: 0,
        incarnationId: crypto.randomUUID(),
        title: "Fallback lock source",
        updatedAt: new Date().toISOString(),
      })).workspace;
    });
    const staleCopy = await second.evaluate(async (workspaceId) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as
        typeof import("../src/workspaces/storage");
      const loaded = await storage.loadWorkspaceById(workspaceId);
      if (!loaded) throw new Error("Expected shared workspace");
      return loaded.workspace;
    }, created.templateId);

    for (const page of [first, second]) {
      await page.evaluate(() => {
        IDBFactory.prototype.open = function unavailableOpen() {
          throw new DOMException("Temporarily unavailable", "InvalidStateError");
        } as IDBFactory["open"];
      });
    }

    const lockName = `freeform-artifacts.workspace-write:${encodeURIComponent(created.templateId)}`;
    await first.evaluate(async (name) => {
      const control = window as Window & { __freeformReleaseWorkspaceLock?: () => void };
      await new Promise<void>((acquired) => {
        void navigator.locks.request(name, { mode: "exclusive" }, async () => {
          acquired();
          await new Promise<void>((release) => {
            control.__freeformReleaseWorkspaceLock = release;
          });
        });
      });
    }, lockName);

    const saveFallback = (page: Page, workspace: WorkspaceRecord, title: string) =>
      page.evaluate(async ({ candidate, nextTitle }) => {
        const moduleUrl = "/src/workspaces/storage.ts";
        const storage = await import(/* @vite-ignore */ moduleUrl) as
          typeof import("../src/workspaces/storage");
        try {
          const result = await storage.saveWorkspace({
            ...candidate,
            title: nextTitle,
            updatedAt: new Date().toISOString(),
          });
          return { errorName: "", revision: result.workspace.revision, title: result.workspace.title };
        } catch (error) {
          return {
            errorName: error instanceof Error ? error.name : "unknown",
            revision: -1,
            title: "",
          };
        }
      }, { candidate: workspace, nextTitle: title });

    const firstAttempt = saveFallback(first, created, "First fallback writer");
    await expect.poll(async () => second.evaluate(async (name) => {
      const snapshot = await navigator.locks.query();
      return (snapshot.pending ?? []).filter((lock) => lock.name === name).length;
    }, lockName)).toBe(1);
    const secondAttempt = saveFallback(second, staleCopy, "Second fallback writer");
    await expect.poll(async () => second.evaluate(async (name) => {
      const snapshot = await navigator.locks.query();
      return (snapshot.pending ?? []).filter((lock) => lock.name === name).length;
    }, lockName)).toBe(2);

    await first.evaluate(() => {
      const control = window as Window & { __freeformReleaseWorkspaceLock?: () => void };
      control.__freeformReleaseWorkspaceLock?.();
      delete control.__freeformReleaseWorkspaceLock;
    });
    const attempts = await Promise.all([firstAttempt, secondAttempt]);
    expect(attempts.filter((attempt) => !attempt.errorName)).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.errorName === "WorkspaceConflictError")).toHaveLength(1);

    const winner = attempts.find((attempt) => !attempt.errorName)!;
    const fallback = await second.evaluate((workspaceId) => {
      const raw = localStorage.getItem(`freeform-artifacts.workspace.${workspaceId}.v1`);
      return raw ? JSON.parse(raw) as WorkspaceRecord : null;
    }, created.templateId);
    expect(fallback).toMatchObject({
      incarnationId: created.incarnationId,
      revision: created.revision + 1,
      title: winner.title,
    });
  } finally {
    await context.close();
  }
});

test("localStorage fallback fails closed when cross-page locks are unavailable", async ({ page }) => {
  await waitForCanvas(page);
  const result = await page.evaluate(async () => {
    const moduleUrl = "/src/workspaces/storage.ts";
    const storage = await import(/* @vite-ignore */ moduleUrl) as
      typeof import("../src/workspaces/storage");
    const source = await storage.loadWorkspaceById("market-overview");
    if (!source) throw new Error("Expected seeded workspace");
    const created = (await storage.saveWorkspace({
      ...source.workspace,
      templateId: `fallback-no-lock-${crypto.randomUUID()}`,
      revision: 0,
      incarnationId: crypto.randomUUID(),
      title: "Before unsupported fallback",
      updatedAt: new Date().toISOString(),
    })).workspace;
    IDBFactory.prototype.open = function unavailableOpen() {
      throw new DOMException("Temporarily unavailable", "InvalidStateError");
    } as IDBFactory["open"];
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });

    let errorName = "";
    let errorMessage = "";
    try {
      await storage.saveWorkspace({
        ...created,
        title: "Unsafe overwrite",
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      errorName = error instanceof Error ? error.name : "unknown";
      errorMessage = error instanceof Error ? error.message : "unknown";
    }
    const raw = localStorage.getItem(`freeform-artifacts.workspace.${created.templateId}.v1`);
    return {
      created,
      errorMessage,
      errorName,
      fallback: raw ? JSON.parse(raw) as WorkspaceRecord : null,
    };
  });

  expect(result.errorName).toBe("WorkspaceFallbackLockUnavailableError");
  expect(result.errorMessage).toContain("requires Web Locks support");
  expect(result.fallback).toMatchObject({
    incarnationId: result.created.incarnationId,
    revision: result.created.revision,
    title: "Before unsupported fallback",
  });
});
