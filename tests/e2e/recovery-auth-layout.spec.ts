import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await info.attach(name, {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
}

async function mockRead(page: Page, name: string, result: unknown) {
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if ((functionNames.get(id) ?? "").split("_")[0] !== name) return route.fallback();
    return route.fulfill({ json: { result, context: {} } });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: onboarding Skip releases the composer despite failed persistence`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    await page.removeLocatorHandler(
      page.locator('[role="dialog"][data-state="open"]').filter({ hasText: "Welcome to KovaGPT" }),
    );
    await mockRead(page, "getOnboarding", { completed: false });
    let skipRequests = 0;
    await page.route("**/_serverFn/**", (route) => {
      const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
      if (!(functionNames.get(id) ?? "").startsWith("skipOnboarding_")) return route.fallback();
      skipRequests += 1;
      return route.fulfill({ status: 503, json: { error: "Synthetic persistence failure" } });
    });
    await page.goto("/");
    await waitForKovaHydration(page);
    const dialog = page.getByRole("dialog", { name: "Welcome to KovaGPT" });
    await expect(dialog).toBeVisible();
    await capture(page, info, `onboarding-${theme}`);
    await dialog.getByRole("button", { name: "Skip for now", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeFocused();
    await expect.poll(() => skipRequests).toBe(1);
  });

  test(`${theme}: password recovery cancel, stale completion and reopen reset state`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route(
      /\/(?:auth\/v1\/recover|api\/auth\/recovery\/request)(?:\?|$)/,
      async (route) => {
        requests += 1;
        if (requests === 1) await pending;
        await route.fulfill({ json: {} });
      },
    );
    await page.goto("/auth?email=review%40example.invalid&mode=sign-in");
    await waitForKovaHydration(page);
    const trigger = page.getByRole("button", { name: "Forgot password?", exact: true });
    const password = page.locator("#kova-auth-page-password");
    await expect(password).toHaveAttribute("aria-invalid", "false");
    await trigger.click();
    await expect(password).toHaveAttribute("aria-invalid", "false");
    const dialog = page.getByRole("dialog", { name: "Reset your password", exact: true });
    const email = dialog.getByRole("textbox", { name: "Email", exact: true });
    await expect(email).toBeFocused();
    await email.fill("synthetic@example.invalid");
    await dialog.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect.poll(() => requests).toBe(1);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    // Reopening restores the login address, not the cancelled recovery draft.
    // The earlier request must not replace that new dialog state when it settles.
    await expect(email).toHaveValue("review@example.invalid");
    const finished = page.waitForResponse(
      /\/(?:auth\/v1\/recover|api\/auth\/recovery\/request)(?:\?|$)/,
    );
    release();
    await finished;
    await expect(email).toHaveValue("review@example.invalid");
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
    await email.fill("synthetic@example.invalid");
    await dialog.getByRole("button", { name: "Send reset link", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(password).toHaveAttribute("aria-invalid", "false");
    await capture(page, info, `recovery-sent-${theme}`);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(email).toHaveValue("review@example.invalid");
    await expect(email).toBeFocused();
    await capture(page, info, `recovery-reopened-${theme}`);
  });

  test(`${theme}: Memory content and actions fit the viewport`, async ({ page }, info) => {
    await coreFixture(page, theme);
    const title = "Synthetic memory with a long title for phone layout review";
    await mockRead(page, "listMemoryCenter", [
      {
        id: "55555555-5555-4555-8555-555555555555",
        source: "conversation",
        title,
        category: "preferences",
        content: `Synthetic saved context. ${"LongUnbrokenMemoryContent".repeat(12)}`,
        updatedAt: "2026-10-16T10:00:00Z",
      },
    ]);
    await page.goto("/memory");
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await capture(page, info, `memory-${theme}`);
    const edit = page.getByRole("button", { name: `Edit ${title}`, exact: true });
    await edit.click();
    const content = page.getByRole("textbox", { name: `Memory content for ${title}`, exact: true });
    await expect(content).toBeFocused();
    await content.fill("Synthetic unsaved draft");
    await capture(page, info, `memory-edit-${theme}`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(content).toHaveCount(0);
    await expect(page.getByText("Synthetic unsaved draft", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `Delete ${title}`, exact: true }).click();
    const confirmation = page.getByRole("alertdialog", {
      name: "Delete this memory?",
      exact: true,
    });
    await expect(confirmation).toBeVisible();
    await capture(page, info, `memory-delete-cancel-${theme}`);
    await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(confirmation).toBeHidden();
  });

  test(`${theme}: legal reading gutters and checkout actions remain separate`, async ({
    page,
  }, info) => {
    await coreFixture(page, theme);
    for (const path of ["/terms", "/privacy"]) {
      await page.goto(path);
      await waitForKovaHydration(page);
      const hero = page.locator(".legal-hero");
      await expect(hero).toBeVisible();
      const heading = await hero.locator("h1").boundingBox();
      expect(heading!.x).toBeGreaterThanOrEqual(16);
      expect(heading!.x + heading!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16);
      const mobileToc = page.locator(".legal-toc-mobile");
      if (await mobileToc.isVisible()) await mobileToc.locator("summary").click();
      await expect(page.locator(".legal-toc-list").first()).toHaveCSS("list-style-type", "none");
      await capture(page, info, `${path.slice(1)}-${theme}`);
    }
    await page.goto("/checkout/return?session_id=cs_test_0123456789abcdef0123456789abcdef");
    await waitForKovaHydration(page);
    await expect(
      page.getByRole("heading", { name: "Subscription verification pending", exact: true }),
    ).toBeVisible();
    const check = await page
      .getByRole("button", { name: "Check again", exact: true })
      .boundingBox();
    const back = await page
      .getByRole("link", { name: "Back to KovaGPT", exact: true })
      .boundingBox();
    expect(back!.y).toBeGreaterThanOrEqual(check!.y + check!.height + 16);
    await capture(page, info, `checkout-pending-${theme}`);
  });
}
