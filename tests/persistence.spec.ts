import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DATABASE_NAME = "freeform-artifacts";
const DATABASE_VERSION = 3;
const WORKSPACE_STORE = "workspaces";
const FALLBACK_PREFIX = "freeform-artifacts.workspace.";
const DELETED_PREFIX = "freeform-artifacts.deleted-view.";
const DELETED_INDEX_KEY = "freeform-artifacts.deleted-views.v1";

interface PersistedWorkspace {
  revision: number;
  templateId: string;
  title: string;
}

async function waitForCanvas(page: Page) {
  await page.getByTestId("canvas-stage").waitFor({ state: "visible" });
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__?.templateId ?? "")).not.toBe("");
}

async function renameActiveView(page: Page, title: string) {
  await page.getByTestId("canvas-title").dblclick();
  await page.getByTestId("canvas-title-input").fill(title);
  await page.getByTestId("canvas-title-input").press("Enter");
}

async function readIndexedWorkspace(page: Page, workspaceId: string) {
  return page.evaluate(async ({ databaseName, databaseVersion, storeName, id }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<PersistedWorkspace | null>((resolve, reject) => {
        const request = database.transaction(storeName, "readonly").objectStore(storeName).get(id);
        request.onsuccess = () => {
          const value = request.result as PersistedWorkspace | undefined;
          resolve(value ?? null);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, { databaseName: DATABASE_NAME, databaseVersion: DATABASE_VERSION, storeName: WORKSPACE_STORE, id: workspaceId });
}

async function readFallbackWorkspace(page: Page, workspaceId: string) {
  return page.evaluate(({ prefix, id }) => {
    const value = localStorage.getItem(`${prefix}${id}.v1`);
    return value ? JSON.parse(value) as PersistedWorkspace : null;
  }, { prefix: FALLBACK_PREFIX, id: workspaceId });
}

async function readStorageSnapshot(page: Page) {
  return page.evaluate(async ({
    databaseName,
    databaseVersion,
    deletedIndexKey,
    deletedPrefix,
    storeName,
  }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const records = await new Promise<PersistedWorkspace[]>((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as PersistedWorkspace[]);
      request.onerror = () => reject(request.error);
    });
    database.close();

    const tombstones = new Set<string>();
    try {
      const indexed = JSON.parse(localStorage.getItem(deletedIndexKey) ?? "[]") as unknown;
      if (Array.isArray(indexed)) {
        for (const id of indexed) if (typeof id === "string") tombstones.add(id);
      }
    } catch {
      // Per-view tombstones below remain sufficient for this assertion.
    }
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(deletedPrefix)) continue;
      tombstones.add(decodeURIComponent(key.slice(deletedPrefix.length)));
    }
    return {
      records,
      survivors: records.filter((workspace) => !tombstones.has(workspace.templateId)),
      tombstones: [...tombstones],
    };
  }, {
    databaseName: DATABASE_NAME,
    databaseVersion: DATABASE_VERSION,
    deletedIndexKey: DELETED_INDEX_KEY,
    deletedPrefix: DELETED_PREFIX,
    storeName: WORKSPACE_STORE,
  });
}

async function createContextWithDeletedViewEventsPaused(browserContext: BrowserContext) {
  await browserContext.addInitScript(({ deletedPrefix }) => {
    const control = window as Window & { __freeformPauseDeletedViewEvents?: boolean };
    control.__freeformPauseDeletedViewEvents = true;
    window.addEventListener("storage", (event) => {
      if (control.__freeformPauseDeletedViewEvents && event.key?.startsWith(deletedPrefix)) {
        event.stopImmediatePropagation();
      }
    }, true);
  }, { deletedPrefix: "freeform-artifacts.deleted-view" });
}

test("fallback revisions survive a stale sibling pagehide and resume in IndexedDB", async ({ page }) => {
  await page.goto("/");
  await waitForCanvas(page);
  await page.waitForTimeout(750);
  const staleSibling = await page.context().newPage();
  await staleSibling.goto("/?view=market-overview");
  await waitForCanvas(staleSibling);
  await staleSibling.waitForTimeout(750);

  // Load the writer after both tabs have finished any one-time runtime normalization.
  // The sibling remains on the preceding persisted revision once the fallback commit lands.
  await page.reload();
  await waitForCanvas(page);
  await page.waitForTimeout(750);

  const initial = await readIndexedWorkspace(staleSibling, "market-overview");
  expect(initial).not.toBeNull();
  const originalRevision = initial!.revision;

  await page.evaluate(() => {
    const prototype = IDBFactory.prototype as IDBFactory & { __freeformOriginalOpen?: IDBFactory["open"] };
    prototype.__freeformOriginalOpen = prototype.open;
    prototype.open = function unavailableOpen() {
      throw new DOMException("Temporarily unavailable", "InvalidStateError");
    } as IDBFactory["open"];
  });

  await renameActiveView(page, "Fallback revision");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status))
    .toBe("Saved in browser fallback");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.storageMode))
    .toBe("localstorage");

  const fallback = await readFallbackWorkspace(staleSibling, "market-overview");
  expect(fallback).toMatchObject({
    revision: originalRevision + 1,
    templateId: "market-overview",
    title: "Fallback revision",
  });

  await staleSibling.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false }));
  });
  expect(await readFallbackWorkspace(staleSibling, "market-overview")).toMatchObject({
    revision: fallback!.revision,
    title: "Fallback revision",
  });
  await staleSibling.close();

  await page.evaluate(() => {
    const prototype = IDBFactory.prototype as IDBFactory & { __freeformOriginalOpen?: IDBFactory["open"] };
    if (prototype.__freeformOriginalOpen) prototype.open = prototype.__freeformOriginalOpen;
    delete prototype.__freeformOriginalOpen;
  });
  await renameActiveView(page, "IndexedDB resumed");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
  await expect.poll(async () => page.evaluate(() => window.__FREEFORM_STATE__!.storageMode)).toBe("indexeddb");

  const resumed = await readIndexedWorkspace(page, "market-overview");
  expect(resumed).toMatchObject({
    revision: fallback!.revision + 1,
    title: "IndexedDB resumed",
  });

  await page.reload();
  await waitForCanvas(page);
  await expect(page.getByTestId("canvas-title")).toHaveText("IndexedDB resumed");
  const reloaded = await readIndexedWorkspace(page, "market-overview");
  expect(reloaded).toMatchObject({ title: "IndexedDB resumed" });
  expect(reloaded!.revision).toBeGreaterThanOrEqual(resumed!.revision);
});

test("Undo after a stale active delete restores the latest committed revision", async ({ browser }) => {
  const context = await browser.newContext();
  await createContextWithDeletedViewEventsPaused(context);
  try {
    const writer = await context.newPage();
    await writer.goto("/");
    await waitForCanvas(writer);
    await writer.getByTestId("sidebar-toggle").click();
    await writer.getByTestId("create-view").click();
    await expect.poll(async () => writer.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .not.toBe("market-overview");
    const survivorId = await writer.evaluate(() => window.__FREEFORM_STATE__!.templateId);
    await expect.poll(async () => writer.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await writer.getByTestId("view-market-overview").click();
    await expect.poll(async () => writer.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");

    const staleDeleter = await context.newPage();
    await staleDeleter.goto("/?view=market-overview");
    await waitForCanvas(staleDeleter);
    await expect(staleDeleter.getByTestId("canvas-title")).toHaveText("Market overview");
    await staleDeleter.waitForTimeout(750);

    // Let the writer reload any one-time normalization committed while the stale tab mounted.
    // The stale tab is now the fixed older snapshot once the writer's next edit commits.
    await writer.reload();
    await waitForCanvas(writer);
    await renameActiveView(writer, "Latest committed title");
    await expect.poll(async () => (await readIndexedWorkspace(writer, "market-overview"))?.title)
      .toBe("Latest committed title");
    await expect(staleDeleter.getByTestId("canvas-title")).toHaveText("Market overview");

    await staleDeleter.getByTestId("sidebar-toggle").click();
    await staleDeleter.getByTestId("view-menu-market-overview").click();
    await staleDeleter.getByTestId("delete-view-market-overview").click();
    await expect(staleDeleter.getByTestId("view-undo-toast")).toBeVisible();
    await expect.poll(async () => staleDeleter.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe(survivorId);

    await staleDeleter.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect(staleDeleter.locator('[data-view-id="market-overview"]')).toHaveCount(1);
    await staleDeleter.getByTestId("view-market-overview").click();
    await expect.poll(async () => staleDeleter.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .toBe("market-overview");
    await expect(staleDeleter.getByTestId("canvas-title")).toHaveText("Latest committed title");
    expect(await readIndexedWorkspace(staleDeleter, "market-overview"))
      .toMatchObject({ title: "Latest committed title" });
  } finally {
    await context.close();
  }
});

test("a stale second Undo cannot overwrite a restored and edited view", async ({ browser }) => {
  const context = await browser.newContext();
  await createContextWithDeletedViewEventsPaused(context);
  await context.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...argumentsList: unknown[]) =>
      nativeSetTimeout(handler, timeout === 10_000 ? 60_000 : timeout, ...argumentsList)
    ) as typeof window.setTimeout;
  });
  try {
    const first = await context.newPage();
    await first.goto("/");
    await waitForCanvas(first);
    await first.getByTestId("sidebar-toggle").click();
    await first.getByTestId("create-view").click();
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .not.toBe("market-overview");
    const survivorId = await first.evaluate(() => window.__FREEFORM_STATE__!.templateId);
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await first.getByTestId("view-market-overview").click();
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");

    const second = await context.newPage();
    await second.goto("/?view=market-overview");
    await waitForCanvas(second);
    await second.getByTestId("sidebar-toggle").click();

    await first.getByTestId("view-menu-market-overview").click();
    await second.getByTestId("view-menu-market-overview").click();
    await Promise.all([
      first.getByTestId("delete-view-market-overview").evaluate((button: HTMLButtonElement) => button.click()),
      second.getByTestId("delete-view-market-overview").evaluate((button: HTMLButtonElement) => button.click()),
    ]);
    await expect(first.getByTestId("view-undo-toast")).toBeVisible();
    await expect(second.getByTestId("view-undo-toast")).toBeVisible();
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe(survivorId);
    await expect.poll(async () => second.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe(survivorId);

    await first.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect.poll(async () => first.evaluate(() => {
      if (document.querySelector('[data-view-id="market-overview"]')) return "restored";
      const message = document.querySelector('[data-testid="view-undo-toast"]')?.textContent ?? "";
      return message.includes("changed in another browser tab") ? "conflict" : "pending";
    }), { timeout: 15_000 }).not.toBe("pending");
    const firstWon = await first.locator('[data-view-id="market-overview"]').count() === 1;
    const restoredBy = firstWon ? first : second;
    const staleUndoOwner = firstWon ? second : first;
    if (!firstWon) {
      await second.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
      await expect(second.locator('[data-view-id="market-overview"]')).toHaveCount(1);
    }

    await restoredBy.getByTestId("view-market-overview").click();
    await expect.poll(async () => restoredBy.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");
    await renameActiveView(restoredBy, "Restored by current deletion owner");
    await expect.poll(async () => (await readIndexedWorkspace(restoredBy, "market-overview"))?.title)
      .toBe("Restored by current deletion owner");
    await expect.poll(async () => restoredBy.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");

    await staleUndoOwner.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect(staleUndoOwner.getByTestId("view-undo-toast"))
      .toContainText("This canvas changed in another browser tab");

    const restored = await readIndexedWorkspace(restoredBy, "market-overview");
    expect(restored).toMatchObject({ title: "Restored by current deletion owner" });
    expect(await restoredBy.evaluate((key) => localStorage.getItem(key), `${DELETED_PREFIX}market-overview`)).toBeNull();

    await staleUndoOwner.goto("/?view=market-overview");
    await waitForCanvas(staleUndoOwner);
    await expect(staleUndoOwner.getByTestId("canvas-title")).toHaveText("Restored by current deletion owner");
  } finally {
    await context.close();
  }
});

test("an old Undo cannot clear a newer deletion generation", async ({ browser }) => {
  const context = await browser.newContext();
  await createContextWithDeletedViewEventsPaused(context);
  await context.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...argumentsList: unknown[]) =>
      nativeSetTimeout(handler, timeout === 10_000 ? 60_000 : timeout, ...argumentsList)
    ) as typeof window.setTimeout;
  });
  try {
    const staleUndoOwner = await context.newPage();
    await staleUndoOwner.goto("/");
    await waitForCanvas(staleUndoOwner);
    await staleUndoOwner.getByTestId("sidebar-toggle").click();
    await staleUndoOwner.getByTestId("create-view").click();
    await expect.poll(async () => staleUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .not.toBe("market-overview");
    const survivorId = await staleUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.templateId);
    await expect.poll(async () => staleUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.status))
      .toBe("Saved locally");
    await staleUndoOwner.getByTestId("view-market-overview").click();
    await expect.poll(async () => staleUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .toBe("market-overview");

    const latestUndoOwner = await context.newPage();
    await latestUndoOwner.goto("/?view=market-overview");
    await waitForCanvas(latestUndoOwner);
    const firstDeletedSnapshot = await readIndexedWorkspace(latestUndoOwner, "market-overview");
    expect(firstDeletedSnapshot).not.toBeNull();

    await staleUndoOwner.getByTestId("view-menu-market-overview").click();
    await staleUndoOwner.getByTestId("delete-view-market-overview").click();
    await expect(staleUndoOwner.getByTestId("view-undo-toast")).toBeVisible();
    await expect.poll(async () => staleUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .toBe(survivorId);

    const tombstoneKey = `${DELETED_PREFIX}market-overview`;
    const firstDeletionId = await staleUndoOwner.evaluate((key) => localStorage.getItem(key), tombstoneKey);
    expect(firstDeletionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Use the production restore path in the other tab while keeping the first tab's
    // Undo closure alive. The Vite dev server exposes the same module instance used by
    // the app, so this is a legal first-generation restore rather than a storage rewrite.
    await latestUndoOwner.evaluate(async ({ deletionId, workspace }) => {
      const moduleUrl = "/src/workspaces/storage.ts";
      const storage = await import(/* @vite-ignore */ moduleUrl) as {
        restoreWorkspace: (candidate: unknown, index: number, expectedDeletionId: string) => Promise<unknown>;
      };
      await storage.restoreWorkspace(workspace, 0, deletionId);
    }, { deletionId: firstDeletionId!, workspace: firstDeletedSnapshot! });
    expect(await latestUndoOwner.evaluate((key) => localStorage.getItem(key), tombstoneKey)).toBeNull();

    await latestUndoOwner.goto("/?view=market-overview");
    await waitForCanvas(latestUndoOwner);
    await renameActiveView(latestUndoOwner, "Latest second-generation title");
    await expect.poll(async () => (await readIndexedWorkspace(latestUndoOwner, "market-overview"))?.title)
      .toBe("Latest second-generation title");
    await expect.poll(async () => latestUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.status))
      .toBe("Saved locally");

    await latestUndoOwner.getByTestId("sidebar-toggle").click();
    await latestUndoOwner.getByTestId("view-menu-market-overview").click();
    await latestUndoOwner.getByTestId("delete-view-market-overview").click();
    await expect(latestUndoOwner.getByTestId("view-undo-toast")).toBeVisible();
    await expect.poll(async () => latestUndoOwner.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .toBe(survivorId);

    const secondDeletionId = await latestUndoOwner.evaluate((key) => localStorage.getItem(key), tombstoneKey);
    expect(secondDeletionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(secondDeletionId).not.toBe(firstDeletionId);

    await staleUndoOwner.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect(staleUndoOwner.getByTestId("view-undo-toast"))
      .toContainText("This canvas changed in another browser tab");
    expect(await readIndexedWorkspace(staleUndoOwner, "market-overview")).toBeNull();
    expect(await staleUndoOwner.evaluate((key) => localStorage.getItem(key), tombstoneKey))
      .toBe(secondDeletionId);

    await latestUndoOwner.getByTestId("view-undo-toast").getByRole("button", { name: "Undo" }).click();
    await expect(latestUndoOwner.locator('[data-view-id="market-overview"]')).toHaveCount(1);
    expect(await latestUndoOwner.evaluate((key) => localStorage.getItem(key), tombstoneKey)).toBeNull();
    expect(await readIndexedWorkspace(latestUndoOwner, "market-overview"))
      .toMatchObject({ title: "Latest second-generation title" });
    await latestUndoOwner.getByTestId("view-market-overview").click();
    await expect(latestUndoOwner.getByTestId("canvas-title")).toHaveText("Latest second-generation title");
  } finally {
    await context.close();
  }
});

test("symmetric cross-view deletion recovers a non-tombstoned editable view", async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const first = await context.newPage();
    await first.goto("/");
    await waitForCanvas(first);
    await first.getByTestId("sidebar-toggle").click();
    await first.getByTestId("create-view").click();
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.templateId))
      .not.toBe("market-overview");
    const secondViewId = await first.evaluate(() => window.__FREEFORM_STATE__!.templateId);
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await first.getByTestId("view-market-overview").click();
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.templateId)).toBe("market-overview");

    const second = await context.newPage();
    await second.goto(`/?view=${encodeURIComponent(secondViewId)}`);
    await waitForCanvas(second);
    await second.getByTestId("sidebar-toggle").click();

    await first.getByTestId(`view-menu-${secondViewId}`).click();
    await second.getByTestId("view-menu-market-overview").click();
    await Promise.all([
      first.getByTestId(`delete-view-${secondViewId}`).evaluate((button: HTMLButtonElement) => button.click()),
      second.getByTestId("delete-view-market-overview").evaluate((button: HTMLButtonElement) => button.click()),
    ]);

    const deletedIds = ["market-overview", secondViewId];
    await expect.poll(async () => {
      const snapshot = await readStorageSnapshot(first);
      return deletedIds.every((id) => snapshot.tombstones.includes(id)) && snapshot.survivors.length > 0;
    }, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => {
      const activeId = await first.evaluate(() => window.__FREEFORM_STATE__?.templateId ?? "");
      return Boolean(activeId) && !deletedIds.includes(activeId);
    }, { timeout: 15_000 }).toBe(true);
    await expect.poll(async () => {
      const activeId = await second.evaluate(() => window.__FREEFORM_STATE__?.templateId ?? "");
      return Boolean(activeId) && !deletedIds.includes(activeId);
    }, { timeout: 15_000 }).toBe(true);

    const snapshot = await readStorageSnapshot(first);
    expect(snapshot.survivors.length).toBeGreaterThanOrEqual(1);
    const recoveredId = snapshot.survivors[0].templateId;
    expect(deletedIds).not.toContain(recoveredId);

    await second.close();
    await first.goto(`/?view=${encodeURIComponent(recoveredId)}`);
    await waitForCanvas(first);
    await renameActiveView(first, "Editable recovery view");
    await expect.poll(async () => (await readIndexedWorkspace(first, recoveredId))?.title)
      .toBe("Editable recovery view");
    await expect.poll(async () => first.evaluate(() => window.__FREEFORM_STATE__!.status)).toBe("Saved locally");
    await first.reload();
    await waitForCanvas(first);
    await expect(first.getByTestId("canvas-title")).toHaveText("Editable recovery view");
    expect(await readIndexedWorkspace(first, recoveredId)).toMatchObject({ title: "Editable recovery view" });
  } finally {
    await context.close();
  }
});
