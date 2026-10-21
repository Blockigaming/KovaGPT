import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { coreFixture, reviewProject } from "./core-app-fixture";
import { waitForKovaHydration } from "./hydration";

async function openSidebar(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  const navigation = page
    .getByRole("navigation", { name: "Primary navigation", exact: true })
    .or(page.getByRole("dialog", { name: "Primary navigation", exact: true }));
  if (await navigation.isVisible()) return;
  const opener = page
    .getByRole("button", { name: /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/ })
    .filter({ visible: true });
  if (await opener.count()) await opener.first().click();
  await expect(navigation).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  if (!(await page.getByRole("dialog").count()) && name !== "task-filter-dark") {
    await page.evaluate(() => {
      document.querySelectorAll<HTMLElement>(".kova-app-content").forEach((element) => {
        element.scrollTop = 0;
      });
    });
  }
  await page.screenshot({ path: info.outputPath(`${name}.png`), animations: "disabled" });
}

test("sidebar search and all main destinations keep honest service states", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await coreFixture(page, "light", "plus");
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByTestId("model-selector-trigger").filter({ visible: true })).toBeVisible();
  await openSidebar(page);
  await page.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search chats", exact: true });
  await search.fill("Second review");
  await expect(
    page.getByRole("button", { name: "Open chat Second review chat", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open chat Composer review chat", exact: true }),
  ).toHaveCount(0);
  await capture(page, info, "sidebar-search");
  await search.fill("");

  await page.getByRole("link", { name: "Images", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Images", exact: true })).toBeVisible();
  const imagePrompt = page.getByRole("textbox", { name: "Describe the image to generate" });
  await imagePrompt.fill("A rounded paper sculpture in morning light");
  await page.getByLabel("Output image shape").selectOption("2:3");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Image generation is temporarily unavailable" }),
  ).toBeVisible();
  await expect(imagePrompt).toHaveValue("A rounded paper sculpture in morning light");
  await capture(page, info, "images");

  for (const [name, heading] of [
    ["Library", "Library"],
    ["Projects", "Projects"],
  ]) {
    await openSidebar(page);
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    if (name === "Library") {
      await page.getByPlaceholder("Search Library", { exact: true }).fill("Release notes");
      await page.getByRole("button", { name: "Release notes", exact: true }).click();
      const preview = page.getByRole("dialog", { name: "Release notes", exact: true });
      await expect(preview).toContainText(
        "Synthetic review content. No account records are included.",
      );
      await capture(page, info, "library-preview");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: "Release notes", exact: true })).toBeFocused();
    }
  }
  await openSidebar(page);
  await page.getByRole("link", { name: "Scheduled tasks", exact: true }).click();
  await expect(page.getByRole("status", { name: "Scheduled Tasks Status" })).toContainText(
    "Scheduled execution is not available yet",
  );
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search scheduled tasks" }).fill("morning");
  await page.getByRole("tab", { name: "paused", exact: true }).click();
  await expect(page.getByRole("tab", { name: "paused", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("tab", { name: "paused", exact: true })).toHaveCSS(
    "color",
    await page.locator("body").evaluate((element) => getComputedStyle(element).color),
  );
  await capture(page, info, "tasks");

  await openSidebar(page);
  await page.getByRole("link", { name: "Plugins", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Apps & plugins" })).toBeVisible();
  await expect(page.getByText("Credentials not configured", { exact: true })).toBeVisible();
  await page.getByPlaceholder("Search apps and plugins").fill("Gmail");
  await page.getByRole("button", { name: "Details", exact: true }).first().click();
  const plugin = page.getByRole("dialog", { name: "Gmail", exact: true });
  await expect(plugin).toContainText("Capabilities and permissions");
  await capture(page, info, "plugins-details");
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Search apps and plugins").fill("");
  await capture(page, info, "plugins");

  await openSidebar(page);
  await page
    .locator("summary")
    .filter({ hasText: /^More$/ })
    .click();
  await page.getByRole("link", { name: "Work", exact: true }).click();
  await expect(page.getByText("No Work runs", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Start work", exact: true })).toBeDisabled();
  await capture(page, info, "work");
  await openSidebar(page);
  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Search and discovery" })).toBeVisible();
  await expect(page.getByText(/Live discovery is not available here yet/)).toBeVisible();
  await page.getByRole("button", { name: "Local places", exact: true }).click();
  await page.getByRole("textbox", { name: "What are you looking for?" }).fill("Quiet cafes");
  await page
    .getByRole("textbox", { name: "City, neighborhood, or place (entered manually)" })
    .fill("London");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Open this search in Google Maps (shares the entered place)" }),
  ).toHaveAttribute("href", /maps/);
  await page.getByRole("button", { name: "Remove location" }).click();
  await capture(page, info, "discovery");

  await openSidebar(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Plans and subscriptions" })).toHaveAttribute(
    "href",
    "/pricing",
  );
  await page.getByRole("menuitem", { name: "Help", exact: true }).click();
  await expect(page.getByRole("heading", { name: "How can we help?" })).toBeVisible();
  await page.getByRole("textbox", { name: "Search help", exact: true }).fill("cancel subscription");
  await expect(page.getByRole("heading", { name: "Search results", exact: true })).toBeVisible();
  await capture(page, info, "help-search");
  await page.getByLabel("Message", { exact: false }).fill("Synthetic review draft; do not submit.");
  await expect(page.getByLabel("Message", { exact: false })).toHaveValue(
    "Synthetic review draft; do not submit.",
  );
  expect(errors).toEqual([]);
});

test("dark task filter keeps a readable selected label", async ({ page }, info) => {
  await coreFixture(page, "dark", "plus");
  await page.goto("/scheduled-tasks");
  await waitForKovaHydration(page);
  const paused = page.getByRole("tab", { name: "paused", exact: true });
  await paused.click();
  await expect(paused).toHaveAttribute("aria-selected", "true");
  await expect(paused).toHaveCSS(
    "color",
    await page.locator("body").evaluate((element) => getComputedStyle(element).color),
  );
  await capture(page, info, "task-filter-dark");
});

test("project sections and account settings remain navigable and cancel safely", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await coreFixture(page, "dark");
  await page.goto(`/projects/${reviewProject.id}`);
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: reviewProject.name, exact: true })).toBeVisible();
  for (const name of [
    "Chats",
    "Files",
    "Images",
    "Instructions",
    "Notes",
    "Tasks",
    "Memory",
    "Members",
    "Collaboration",
    "Settings",
    "Overview",
  ]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await capture(page, info, "project-workspace");
  await openSidebar(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.locator(".kova-settings-dialog");
  await expect(settings).toBeVisible();
  for (const name of [
    "General",
    "Personalization",
    "Memory",
    "Subscriptions",
    "Usage",
    "Email",
    "Appearance",
    "Notifications",
    "Keyboard shortcuts",
    "Location",
    "Parental controls",
    "Safety & security",
    "Storage",
    "Apps",
    "Family Center",
    "About",
    "Data control",
  ]) {
    const back = settings.getByRole("button", { name: "Back to settings" });
    if (await back.isVisible()) await back.click();
    await settings.getByRole("tab", { name, exact: true }).click();
    await expect(settings.getByRole("tabpanel")).toBeVisible();
    if (name === "Subscriptions")
      await expect(settings.getByRole("button", { name: "Manage subscription" })).toBeDisabled();
  }
  await settings.getByRole("button", { name: "Delete account", exact: true }).click();
  const deletion = page.getByRole("alertdialog", { name: "Delete your account permanently?" });
  await expect(deletion).toBeVisible();
  await expect(
    deletion.getByRole("button", { name: "Delete account", exact: true }),
  ).toBeDisabled();
  await capture(page, info, "account-deletion-cancel");
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deletion).toBeHidden();
  await capture(page, info, "settings-data");
  const back = settings.getByRole("button", { name: "Back to settings" });
  if (await back.isVisible()) await back.click();
  await settings
    .getByRole("textbox", { name: "Search settings", exact: true })
    .fill("subscription");
  await expect(settings.getByRole("tab", { name: "Subscriptions", exact: true })).toBeVisible();
  await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveCount(0);
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
  expect(errors).toEqual([]);
});
