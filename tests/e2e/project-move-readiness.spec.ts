import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";
import { revealSidebar } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

test("moving a chat waits for writable device history", async ({ page }) => {
  await coreFixture(page, "dark");
  await page.addInitScript(() => {
    const manager = navigator.locks;
    const request = manager.request;
    const ready = new Promise<void>((resolve) =>
      window.addEventListener("kova-test-history-ready", () => resolve(), { once: true }),
    );
    manager.request = ((...args: unknown[]) => {
      if (String(args[0]).startsWith("kova-chat-history:")) {
        const callback = args.at(-1) as (lock: Lock | null) => unknown;
        args[args.length - 1] = async (lock: Lock | null) => {
          await ready;
          return callback(lock);
        };
      }
      return Reflect.apply(request, manager, args);
    }) as typeof manager.request;
  });
  const copies: string[] = [];
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (!functionNames.get(id)?.startsWith("importChatToProject_")) return route.fallback();
    copies.push(route.request().postData() ?? "");
    return route.fulfill({
      json: { result: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, context: {} },
    });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await revealSidebar(page);
  await page.getByRole("button", { name: "Options for Composer review chat", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to project", exact: true }).click();
  const choice = page.getByRole("menuitem", { name: "Review project", exact: true });
  await choice.scrollIntoViewIfNeeded();
  await choice.click();
  const dialog = page.getByRole("dialog", { name: "Move to project", exact: true });
  const move = dialog.getByRole("button", { name: "Move to project", exact: true });
  await expect(move).toBeDisabled();
  await expect(dialog).toContainText("Chat history is not ready for moving chats.");
  expect(copies).toHaveLength(0);
  await page.evaluate(() => window.dispatchEvent(new Event("kova-test-history-ready")));
  await expect(move).toBeEnabled();
  await move.click();
  await expect(page.getByRole("dialog", { name: "Chat moved", exact: true })).toBeVisible();
  expect(copies).toHaveLength(1);
});
