import { expect, test, type Page } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { openCurrentSettings, chooseSettingsSection } from "./current-ui";
import { waitForKovaHydration } from "./hydration";

const origin = "http://127.0.0.1:4189";
const owner = "22222222-2222-4222-8222-222222222222";
const project = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Autumn product plan",
  description: "Synthetic project for local layout verification.",
  role: "owner",
  member_count: 2,
  chat_count: 3,
  file_count: 1,
  updated_at: "2026-10-16T10:00:00Z",
  created_at: "2026-10-01T10:00:00Z",
};
const items = ["Release notes", "Long filename that wraps naturally on a small phone screen"].map(
  (title, i) => ({
    id: `${i + 4}4444444-4444-4444-8444-444444444444`,
    user_id: owner,
    title,
    item_type: "document",
    source: "manual",
    content_text: "Synthetic review content.",
    content_excerpt: "Synthetic review content.",
    file_name: "Notes.txt",
    file_type: "text/plain",
    file_url: null,
    file_size: 1234,
    folder_id: null,
    metadata: {},
    created_at: "2026-10-16T10:00:00Z",
  }),
);

// Resolve the built server-function IDs so fixture values follow the actual
// application build without adding an adapter or review flag to production.
const functionNames = new Map<string, string>();
const assets = ".nitro/vite/services/ssr/assets";
for (const file of readdirSync(assets).filter((name) => name.startsWith("vendor-tanstack"))) {
  const source = readFileSync(join(assets, file), "utf8");
  for (const match of source.matchAll(/"([a-f0-9]{64})":\s*\{\s*functionName: "([^"]+)"/g)) {
    functionNames.set(match[1], match[2]);
  }
}

async function fixture(page: Page, theme: "light" | "dark") {
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort("blockedbyclient"),
    );
  await page.context().routeWebSocket("**/*", (socket) => socket.close());
  await installAuthenticatedFixture(page);
  await page.addInitScript((mode) => localStorage.setItem("kova-theme-mode", mode), theme);
  await page.route("**/api/**", (route) => route.fulfill({ json: {} }));
  await page.route("**/_serverFn/**", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const name = functionNames.get(id) ?? "";
    const result = name.startsWith("getMyPlanTier_")
      ? { ownerId: owner, tier: "free" }
      : name.startsWith("listProjects_")
        ? [project]
        : name.startsWith("getMyDailyUsage_")
          ? { chats: 3, images: 1, uploads: 2, resetsAt: "2026-10-17T00:00:00Z" }
          : name.startsWith("getSubscriptionSummary_")
            ? {
                effectiveTier: "free",
                tier: "free",
                hasBillingAccount: false,
                billingPortalAvailable: false,
                activeSubscriptionCount: 0,
              }
            : [];
    return route.fulfill({ json: { result, context: {} } });
  });
  await page.route("**/api/library/folders**", (route) => route.fulfill({ json: { folders: [] } }));
  await page.route("**/api/library/items**", (route) => {
    const data = route.request().postDataJSON();
    return route.fulfill({
      json:
        data?.operation === "list" ? { items, cursor: null, hasMore: false } : { item: items[0] },
    });
  });
}

async function fitsViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: Library metadata, selection, and Project focus`, async ({ page }, info) => {
    await fixture(page, theme);
    await page.goto("/library");
    await waitForKovaHydration(page);
    await expect(page.getByRole("button", { name: /^Release notes(?:\s|$)/ })).toBeVisible();
    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await expect(page.locator(".kova-file-metadata")).toHaveCount(2);
    const metadata = await page.locator(".kova-file-metadata").evaluateAll((nodes) =>
      nodes.map((node) => {
        const children = [...node.children].map((child) => child.getBoundingClientRect());
        return Math.abs(children[0].x - children[1].x);
      }),
    );
    expect(metadata.every((difference) => difference < 1)).toBe(true);
    const selection = page.getByRole("checkbox", { name: "Select Release notes", exact: true });
    await selection.check();
    await expect(selection).toBeVisible();
    await expect(selection).toBeChecked();
    await expect(selection).toHaveCSS("appearance", "none");
    await expect(selection).not.toHaveCSS("background-image", "none");
    await expect(page.getByRole("region", { name: "Selected Library actions" })).toBeVisible();
    await fitsViewport(page);
    await page.screenshot({
      path: info.outputPath(`library-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "List view", exact: true }).click();
    await expect(page.locator(".kova-file-row")).toHaveCount(2);
    await fitsViewport(page);

    await page.goto("/projects");
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`projects-${theme}.png`),
      fullPage: true,
      animations: "disabled",
    });
    const trigger = page
      .getByRole("button", { name: "New project", exact: true })
      .filter({ visible: true });
    await trigger.click();
    const input = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(input).toBeFocused();
    const geometry = await input.evaluate((node) => {
      const inputRect = node.getBoundingClientRect();
      const labelRow = node.previousElementSibling!.getBoundingClientRect();
      return { height: inputRect.height, gap: inputRect.top - labelRow.bottom };
    });
    await expect(input).toHaveCSS("min-height", "44px");
    expect(Math.round(geometry.height)).toBeGreaterThanOrEqual(44);
    expect(geometry.gap).toBeCloseTo(8, 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(trigger).toBeFocused();
  });

  test(`${theme}: Settings and Billing keep usable controls`, async ({ page }, info) => {
    await fixture(page, theme);
    await page.goto("/");
    await waitForKovaHydration(page);
    if (info.project.name === "phone")
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await page.screenshot({
      path: info.outputPath(`sidebar-${theme}.png`),
      animations: "disabled",
    });
    const dialog = await openCurrentSettings(page);
    await chooseSettingsSection(page, "General");
    const control = dialog.getByRole("switch", { name: "Live web search", exact: true });
    await expect(control).toBeVisible();
    const initial = await control.getAttribute("aria-checked");
    await control.click();
    await expect(control).toHaveAttribute("aria-checked", initial === "true" ? "false" : "true");
    const alignment = await control.evaluate((node) => {
      const group = node.closest(".kova-settings-reference-group")!.getBoundingClientRect();
      const target = node.getBoundingClientRect();
      return {
        rightGap: group.right - target.right,
        contained: target.left >= group.left && target.right <= group.right,
        width: target.width,
        height: target.height,
        coarsePointer: matchMedia("(pointer: coarse)").matches,
      };
    });
    expect(alignment.rightGap).toBe(0);
    expect(alignment.contained).toBe(true);
    const minimumSwitchTarget = alignment.coarsePointer ? 44 : 32;
    expect(alignment.width).toBeGreaterThanOrEqual(minimumSwitchTarget);
    expect(alignment.height).toBeGreaterThanOrEqual(minimumSwitchTarget);
    await page.screenshot({
      path: info.outputPath(`settings-${theme}.png`),
      animations: "disabled",
    });
    await chooseSettingsSection(page, "Subscriptions");
    await expect(dialog.locator(".kova-billing-details")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Manage subscription" })).toBeDisabled();
    if (info.project.name === "phone") {
      const inline = dialog.locator('p a[href^="mailto:"]').first();
      await expect(inline).toHaveCSS("display", "inline");
      await expect(inline).toHaveCSS("min-height", "0px");
    }
    await fitsViewport(page);
    await page.screenshot({
      path: info.outputPath(`billing-${theme}.png`),
      animations: "disabled",
    });
  });
}
