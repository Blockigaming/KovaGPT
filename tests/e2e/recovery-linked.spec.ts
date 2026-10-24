import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { linkedFixture, linkedPrompt, linkedReport } from "./recovery-linked-fixture";
import { waitForKovaHydration } from "./hydration";

async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
}

async function focusInside(page: Page) {
  await expect
    .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
    .toBe(true);
}

test("Prompt Studio loads without a draft and both dialogs dismiss back to their trigger", async ({
  page,
}, info) => {
  await linkedFixture(page);
  await page.goto("/prompt-studio");
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: linkedPrompt.name, exact: true })).toBeVisible();
  await capture(page, info, "prompt-studio-loaded");
  const launch = page.getByRole("button", { name: "Test in chat", exact: true });
  await launch.click();
  const testing = page.getByRole("dialog", { name: `Test ${linkedPrompt.name}`, exact: true });
  await expect(testing).toBeVisible();
  await testing.getByRole("textbox", { name: "topic", exact: true }).fill("Keyboard accessibility");
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    await focusInside(page);
  }
  await capture(page, info, "prompt-test-dialog");
  await testing.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(testing).toHaveCount(0);
  await expect(launch).toBeFocused();
  const history = page.getByRole("button", { name: "Versions & evaluation", exact: true });
  await history.click();
  const inspecting = page.getByRole("dialog", { name: linkedPrompt.name, exact: true });
  await expect(
    inspecting.getByRole("textbox", { name: "Current prompt", exact: true }),
  ).toHaveValue(linkedPrompt.body);
  await expect(inspecting.getByText("No earlier revisions yet.")).toBeVisible();
  await capture(page, info, "prompt-history-dialog");
  await page.keyboard.press("Escape");
  await expect(inspecting).toHaveCount(0);
  await expect(history).toBeFocused();
});

test("Context Pack saves selected resources even when search hides one", async ({ page }, info) => {
  const { saves } = await linkedFixture(page);
  await page.goto("/context-packs");
  await waitForKovaHydration(page);
  await page.getByRole("textbox", { name: "Pack name", exact: true }).fill("Search-safe selection");
  await page.getByRole("checkbox", { name: /Release notes/ }).check();
  const search = page.getByRole("textbox", { name: "Search available context", exact: true });
  await search.fill("Long filename");
  await page.getByRole("checkbox", { name: /Long filename/ }).check();
  await expect(page.getByText("2 context items selected")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Release notes/ })).toHaveCount(0);
  await capture(page, info, "context-filtered-selection");
  await page.getByRole("button", { name: "Save context pack", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Search-safe selection", exact: true }),
  ).toBeVisible();
  expect(saves).toHaveLength(1);
  expect(saves[0]).toContain("Release notes");
  expect(saves[0]).toContain("Long filename");
  await capture(page, info, "context-saved-pack");
});

test("Knowledge Graph supports keyboard selection and timeline navigation", async ({
  page,
}, info) => {
  await linkedFixture(page);
  await page.goto("/knowledge-graph");
  await waitForKovaHydration(page);
  const node = page.getByRole("button", { name: "file: Review source", exact: true });
  await expect(node).toBeVisible();
  await node.focus();
  const scrollBefore = await page.evaluate(() => document.scrollingElement?.scrollTop);
  await page.keyboard.press("Space");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await expect(node).toBeFocused();
  expect(await page.evaluate(() => document.scrollingElement?.scrollTop)).toBe(scrollBefore);
  await expect(page.getByRole("link", { name: "Open resource", exact: true })).toHaveAttribute(
    "href",
    "/library",
  );
  await capture(page, info, "graph-keyboard-selection");
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page.getByRole("list", { name: "Knowledge timeline", exact: true })).toBeVisible();
  await capture(page, info, "graph-timeline");
  await page.getByRole("link", { name: "Review source", exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
});

test("Study opens from response More and dismissal returns focus there", async ({ page }, info) => {
  await linkedFixture(page);
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("button", { name: "Practice this explanation", exact: true }),
  ).toHaveCount(0);
  const trigger = page
    .getByRole("toolbar", { name: "Response actions", exact: true })
    .last()
    .getByRole("button", { name: "More actions", exact: true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitem", { name: "Practice this explanation", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Study from this chat", exact: true });
  await expect(dialog.getByLabel("Learning goal", { exact: true })).toBeVisible();
  await expect(
    dialog.getByLabel("Notes or an explanation to practice", { exact: true }),
  ).not.toHaveValue("");
  await focusInside(page);
  await capture(page, info, "study-dialog");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("Moderation controls explain disabled state and failed lookup clears stale actions", async ({
  page,
}, info) => {
  await linkedFixture(page);
  await page.goto("/admin/kovas");
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: linkedReport.name, exact: true })).toBeVisible();
  const block = page.getByRole("button", { name: "Block Kova", exact: true });
  await expect(block).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Decision reason", exact: true })
    .fill("Synthetic review only");
  await expect(block).toBeEnabled();
  await expect(page.getByRole("button", { name: "Restore access", exact: true })).toBeDisabled();
  await page.getByText("Published snapshot", { exact: true }).click();
  await expect(page.getByText("Synthetic published snapshot.", { exact: true })).toBeVisible();
  await capture(page, info, "moderation-controls");
  await page.getByRole("textbox", { name: "Kova ID", exact: true }).fill(linkedReport.kova_id);
  await page.getByRole("button", { name: "Inspect moderation state", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(block).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Refresh reports", exact: true })).toBeEnabled();
  await capture(page, info, "moderation-lookup-error");
});
