import { expect, test, type Page } from "@playwright/test";
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
  for (;;) {
    try {
      return await page.evaluate(async () => {
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
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("Execution context was destroyed")) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

for (const path of ["/", "/apps"]) {
  test(`device reset from ${path} removes private image bytes and preserves another profile`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installAuthenticatedFixture(page);
    await page.goto(path);
    await page.getByRole("button", { name: "Settings", exact: true }).first().click();
    await seedImageHistory(page);
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await page
      .getByRole("button", { name: "Reset this profile's local data", exact: true })
      .click();
    await expect(
      page.getByText("This profile's local browser data was reset.", { exact: true }),
    ).toBeVisible();
    expect(await imageOwners(page)).toEqual([otherOwner]);
  });
}

test("successful account deletion also removes IndexedDB image history from Chat", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installAuthenticatedFixture(page);
  let deletionRequests = 0;
  await page.route("**/api/account", async (route) => {
    expect(route.request().method()).toBe("DELETE");
    expect(route.request().postDataJSON()).toEqual({ confirmation: "DELETE" });
    deletionRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).first().click();
  await seedImageHistory(page);
  await page.getByRole("tab", { name: "Data control", exact: true }).click();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "Delete your account permanently?" });
  await confirmation.getByRole("textbox", { name: "Type DELETE to confirm" }).fill("DELETE");
  await confirmation.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect.poll(() => imageOwners(page)).toEqual([otherOwner]);
  expect(deletionRequests).toBe(1);
  // Sign-out navigates after the success toast; persisted bytes must stay removed
  // across that navigation, irrespective of the transient toast lifetime.
  await expect(confirmation).toBeHidden();
  expect(await imageOwners(page)).toEqual([otherOwner]);
});
