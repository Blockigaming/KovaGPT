import { expect, test, type Page } from "@playwright/test";
import { openCurrentSettings, chooseSettingsSection } from "./current-ui";
import { coreFixture } from "./core-app-fixture";
import { installAuthenticatedFixture } from "./authenticated-fixture";

const owner = "22222222-2222-4222-8222-222222222222";
const otherOwner = "33333333-3333-4333-8333-333333333333";

async function seedImageHistory(page: Page) {
  await page.evaluate(
    async ({ owner, otherOwner }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("kovagpt-image-history", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("images", { keyPath: ["userKey", "id"] });
          store.createIndex("userKey", "userKey", { unique: false });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = database.transaction("images", "readwrite");
        for (const userKey of [owner, otherOwner]) {
          transaction.objectStore("images").put({
            userKey,
            id: "private-image",
            prompt: "private prompt",
            createdAt: 1,
            image: new Blob(["image bytes"], { type: "image/png" }),
          });
        }
        await new Promise<void>((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    },
    { owner, otherOwner },
  );
}

async function imageOwners(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("kovagpt-image-history", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const request = database.transaction("images", "readonly").objectStore("images").getAll();
      const rows = await new Promise<Array<{ userKey: string }>>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return rows.map((row) => row.userKey).sort();
    } finally {
      database.close();
    }
  });
}

for (const path of ["/", "/apps"]) {
  test(`device reset from ${path} removes private image bytes and preserves another profile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await coreFixture(page);
    await page.goto(path);
    await openCurrentSettings(page);
    await seedImageHistory(page);
    await chooseSettingsSection(page, "Storage");
    await page
      .getByRole("button", { name: "Reset this profile's local data", exact: true })
      .click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Reset this profile's local data?",
    });
    await confirmation.getByRole("button", { name: "Reset local data", exact: true }).click();
    await expect(confirmation).toBeHidden();
    await expect.poll(() => imageOwners(page)).toEqual([otherOwner]);
    expect(await imageOwners(page)).toEqual([otherOwner]);
  });
}

test("scheduling and recovering account deletion preserve IndexedDB image history", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAuthenticatedFixture(page);
  // Keep this account-data test on a defined returning-user navigation state.
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  const active = { state: "active", scheduledAt: null, recoverUntil: null };
  const scheduled = {
    state: "scheduled",
    scheduledAt: "2026-10-20T12:00:00.000Z",
    recoverUntil: "2026-11-19T12:00:00.000Z",
  };
  const mutations: string[] = [];
  await page.route("**/api/account", async (route) => {
    const request = route.request();
    expect(request.headers()["x-kova-expected-user"]).toBe(owner);
    if (request.method() === "GET") {
      await route.fulfill({ json: active });
      return;
    }
    mutations.push(request.method());
    if (request.method() === "DELETE") {
      expect(request.postDataJSON()).toEqual({ confirmation: "DELETE" });
      await route.fulfill({ status: 202, json: scheduled });
      return;
    }
    expect(request.method()).toBe("PATCH");
    expect(request.postDataJSON()).toEqual({ action: "recover" });
    await route.fulfill({ json: active });
  });
  await page.goto("/");
  await openCurrentSettings(page);
  await seedImageHistory(page);
  await chooseSettingsSection(page, "Data control");
  const pausedExit = await page.addStyleTag({
    content:
      '[role="alertdialog"][data-state="closed"] { animation-duration: 60s !important; animation-play-state: paused !important; }',
  });
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Schedule account deletion?" });
  await expect(confirmation).toContainText("recoverable for 30 days");
  await confirmation.getByRole("textbox", { name: "Type DELETE to confirm" }).fill("DELETE");
  await confirmation.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  await expect(confirmation).toHaveAttribute("data-state", "closed");
  await expect(
    confirmation.getByRole("button", { name: "Schedule deletion", exact: true }),
  ).toBeDisabled();
  expect(mutations).toEqual(["DELETE"]);
  await pausedExit.evaluate((style) => style.remove());
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole("button", { name: "Recover account", exact: true })).toBeVisible();
  expect(await imageOwners(page)).toEqual([owner, otherOwner]);

  await page.getByRole("button", { name: "Recover account", exact: true }).click();
  const recovery = page.getByRole("alertdialog", { name: "Recover your account?" });
  await expect(recovery).toBeVisible();
  expect(mutations).toEqual(["DELETE"]);
  await recovery.getByRole("button", { name: "Recover account", exact: true }).click();
  await expect(recovery).toBeHidden();
  await expect(page.getByRole("button", { name: "Schedule deletion", exact: true })).toBeVisible();
  expect(mutations).toEqual(["DELETE", "PATCH"]);
  expect(await imageOwners(page)).toEqual([owner, otherOwner]);
});

test("only verified final account deletion removes IndexedDB image history from Chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAuthenticatedFixture(page);
  await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
  let deletionRequests = 0;
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { state: "active", scheduledAt: null, recoverUntil: null } });
      return;
    }
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().postDataJSON()).toEqual({ confirmation: "DELETE" });
    deletionRequests += 1;
    await route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await openCurrentSettings(page);
  await seedImageHistory(page);
  await chooseSettingsSection(page, "Data control");
  await page.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Schedule account deletion?" });
  await confirmation.getByRole("textbox", { name: "Type DELETE to confirm" }).fill("DELETE");
  // Observe the same origin's durable database from a page without application
  // navigation. Signing out destroys the deleting page's evaluation context.
  const storagePage = await page.context().newPage();
  await storagePage.route("**/__device-storage-probe", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Storage probe</title>",
    }),
  );
  await storagePage.goto(new URL("/__device-storage-probe", page.url()).href);
  try {
    await confirmation.getByRole("button", { name: "Schedule deletion", exact: true }).click();
    await expect.poll(() => imageOwners(storagePage)).toEqual([otherOwner]);
    expect(deletionRequests).toBe(1);
    await expect(confirmation).toBeHidden();
    expect(await imageOwners(storagePage)).toEqual([otherOwner]);
  } finally {
    await storagePage.close();
  }
});
