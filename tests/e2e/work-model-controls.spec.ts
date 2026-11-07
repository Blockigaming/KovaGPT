import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { workModelOptions } from "../../src/lib/work-model-policy.mjs";
import { KOVA_HOSTED_TEXT_MODELS } from "../../src/lib/ai/model-catalog.server";
import { sidebarLayoutKey } from "../../src/lib/sidebar-layout.mjs";
import { revealSidebar } from "./current-ui";

const roles = {
  DEFAULT_CHAT: "kova-argon-4.6",
  ADVANCED_REASONING: "kova-neon-4.6",
  PREMIUM_REASONING: "kova-xenon-5",
};
const capabilities = Object.values(roles).map((model) => ({
  model,
  reasoningEfforts: [],
  maxOutputTokens: 8192,
}));
async function workFixture(
  page: Parameters<typeof fixture>[0],
  tier: "free" | "plus" | "pro",
  preserveStorageOnReload = false,
  saved = false,
) {
  const commands: unknown[] = [];
  await fixture(page, "dark", true, saved, tier, { preserveStorageOnReload });
  await page.route("**/api/work/sync**", (route) =>
    route.fulfill({
      json: { savedRecords: [], recentItems: [], nextCursor: 0, currentVersion: 0, hasMore: false },
    }),
  );
  await page.route("**/api/work/execution**", (route) => {
    if (route.request().method() !== "GET") {
      commands.push(route.request().postDataJSON());
      return route.fulfill({ status: 503, json: { error: "fixture_does_not_execute" } });
    }
    return route.fulfill({
      json: {
        readiness: {
          available: tier !== "free",
          reason: tier === "free" ? "Work requires Plus or Pro." : null,
          modelOptions: workModelOptions({
            capabilities,
            models: KOVA_HOSTED_TEXT_MODELS,
            roles,
            plan: tier,
          }),
        },
        runs: [],
        nextCursor: null,
      },
    });
  });
  return commands;
}

for (const selected of [true, false]) {
  test(`saved sidebar ${selected ? "keeps its Work shortcut visible" : "can open Work under More"}`, async ({
    page,
  }) => {
    const commands = await workFixture(page, "free", true);
    await page.goto("/");
    await waitForKovaHydration(page);
    const shortcuts = selected ? ["library", "work", "projects"] : ["library", "projects"];
    const key = sidebarLayoutKey(owner);
    await page.evaluate(
      ({ key, shortcuts }) => localStorage.setItem(key!, JSON.stringify({ shortcuts })),
      { key, shortcuts },
    );
    await page.reload();
    await waitForKovaHydration(page);
    await revealSidebar(page);
    const navigation = page.getByRole("navigation", { name: "KovaGPT features", exact: true });
    if (!selected) await navigation.locator("summary").click();
    const work = navigation.getByRole("link", { name: "Work", exact: true });
    await expect(work).toBeVisible();
    await expect(work).toHaveCount(1);
    await work.click();
    await expect(page).toHaveURL((url) => url.pathname === "/work");
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Work", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key!)!).shortcuts, key),
    ).toEqual(shortcuts);
    expect(commands).toEqual([]);
  });
}

for (const tier of ["free", "plus", "pro"] as const) {
  test(`Work opens ${tier} planning without automatically dispatching a task`, async ({ page }) => {
    const commands = await workFixture(page, tier);
    await page.goto("/work?run=retired-bookmark");
    await waitForKovaHydration(page);
    await expect(page).toHaveURL(/\/work\?run=retired-bookmark$/);
    await expect(
      page.getByRole("main").getByRole("heading", { name: "Work", exact: true }),
    ).toBeVisible();
    const panel = page.getByRole("region", { name: "Work execution", exact: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("combobox", { name: "Work model mode", exact: true }),
    ).toContainText("Kova Argon 4.6");
    await expect(panel.getByRole("status")).toContainText(
      tier === "free" ? "Work requires Plus or Pro." : "A connected runner is available.",
    );
    await panel.getByRole("textbox", { name: "Objective", exact: true }).fill("Synthetic task");
    await expect(panel.getByRole("button", { name: "Start work", exact: true })).toBeDisabled();
    expect(commands).toEqual([]);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });
}

test("chat opens a Work review without sending or clearing its composer draft", async ({
  page,
}) => {
  const commands = await workFixture(page, "plus", false, true);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.locator("[data-chat-transcript]")).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await composer.fill("Review this synthetic launch request");
  await page.getByRole("button", { name: "Prepare or manage Work", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Work from this chat", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Objective", exact: true })).toHaveValue(
    "Review this synthetic launch request",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(composer).toHaveValue("Review this synthetic launch request");
  expect(commands).toEqual([]);
});

test("Work requires sign-in before mounting private plans or execution", async ({ page }) => {
  await fixture(page, "dark", false);
  const executionRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/work/execution")
      executionRequests.push(request.url());
  });
  await page.goto("/work");
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Email address", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Planning sessions", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Work execution", exact: true })).toHaveCount(0);
  expect(executionRequests).toEqual([]);
});
