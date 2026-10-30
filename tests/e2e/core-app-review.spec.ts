import { expect, test, type Page, type TestInfo, type Locator } from "@playwright/test";
import { coreFixture, reviewProject } from "./core-app-fixture";
import { openResponseOptions, openCurrentSettings, chooseSettingsSection } from "./current-ui";
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
  if (await navigation.isVisible()) return navigation;
  const opener = page
    .getByRole("button", { name: /^(Open menu|Open sidebar|Expand sidebar|Toggle sidebar)$/ })
    .filter({ visible: true });
  if (await opener.count()) await opener.first().click();
  await expect(navigation).toBeVisible();
  return navigation;
}

async function expectReadableFilter(tab: Locator) {
  await expect
    .poll(() =>
      tab.evaluate((element) => {
        const style = getComputedStyle(element);
        const context = document.createElement("canvas").getContext("2d")!;
        const luminance = (color: string) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const rgba = context.getImageData(0, 0, 1, 1).data;
          const rgb = [...rgba].slice(0, 3).map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const foreground = luminance(style.color),
          background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
        );
      }),
    )
    .toBeGreaterThanOrEqual(4.5);
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
  await openResponseOptions(page);
  await expect(page.getByTestId("model-selector-trigger").filter({ visible: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const sidebar = await openSidebar(page);
  await sidebar.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = page.getByRole("combobox", {
    name: "Search workspace, commands, and chats",
    exact: true,
  });
  await search.fill("Second review");
  const results = page.getByRole("dialog", {
    name: "Search workspace, chats, and actions",
    exact: true,
  });
  await expect(results.getByRole("option").filter({ hasText: "Second review chat" })).toBeVisible();
  await expect(results.getByRole("option").filter({ hasText: "Composer review chat" })).toHaveCount(
    0,
  );
  await capture(page, info, "sidebar-search");
  await search.fill("");
  await page.keyboard.press("Escape");

  await openSidebar(page);
  await page.getByRole("link", { name: "Images", exact: true }).click();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Images", exact: true }),
  ).toBeVisible();
  const imagePrompt = page.getByRole("textbox", { name: "Describe the image to generate" });
  await imagePrompt.fill("A rounded paper sculpture in morning light");
  await page.getByRole("combobox", { name: "Output image shape", exact: true }).click();
  await page.getByRole("option", { name: "Portrait 2:3", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Output image shape", exact: true }),
  ).toContainText("Portrait 2:3");
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
    await expect(
      page.getByRole("main").getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    if (name === "Library") {
      await page.getByPlaceholder("Search Library", { exact: true }).fill("Release notes");
      await page.getByRole("button", { name: /^Release notes(?:\s|$)/ }).click();
      const preview = page.getByRole("dialog", { name: "Release notes", exact: true });
      await preview.getByRole("button", { name: "Extracted text", exact: true }).click();
      await expect(preview).toContainText(
        "Synthetic review content. No account records are included.",
      );
      await capture(page, info, "library-preview");
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: /^Release notes(?:\s|$)/ })).toBeFocused();
    }
  }
  await openSidebar(page);
  await page.getByRole("link", { name: "Scheduled tasks", exact: true }).click();
  await expect(page.getByRole("status", { name: "Scheduled Tasks Status" })).toContainText(
    "Scheduled execution is not available yet",
  );
  await expect(page.getByRole("button", { name: "New task", exact: true })).toHaveCount(0);
  await page.getByRole("textbox", { name: "Search scheduled tasks" }).fill("morning");
  await page.getByRole("tab", { name: /^paused\b/i }).click();
  await expect(page.getByRole("tab", { name: /^paused\b/i })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expectReadableFilter(page.getByRole("tab", { name: /^paused\b/i }));
  await capture(page, info, "tasks");

  await openSidebar(page);
  await page.getByRole("link", { name: "Connections", exact: true }).click();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await page.getByPlaceholder("Search connections").fill("Gmail");
  await page.getByRole("button", { name: "Connect Gmail", exact: true }).click();
  const plugin = page.getByRole("dialog", { name: "Gmail", exact: true });
  await expect(plugin).toContainText("Capabilities and permissions");
  await capture(page, info, "plugins-details");
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Search connections").fill("");
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
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Search and discovery" }),
  ).toBeVisible();
  await expect(page.getByText(/Live discovery is not available here yet/)).toBeVisible();
  await page.getByRole("button", { name: "Local places", exact: true }).click();
  await page.getByRole("textbox", { name: "What are you looking for?" }).fill("Quiet cafes");
  await page
    .getByRole("textbox", { name: "City, neighborhood, or place (entered manually)" })
    .fill("London");
  await expect(
    page.getByRole("main").getByRole("button", { name: "Search", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Open this search in Google Maps (shares the entered place)" }),
  ).toHaveAttribute("href", /maps/);
  await page.getByRole("button", { name: "Remove location" }).click();
  await capture(page, info, "discovery");

  await openSidebar(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Subscriptions", exact: true })).toBeVisible();
  await page.getByRole("menuitem", { name: "Help", exact: true }).click();
  await expect(
    page.getByRole("main").getByRole("heading", { name: "How can we help?" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "Search help", exact: true }).fill("cancel subscription");
  await expect(
    page.getByRole("main").getByRole("heading", { name: "Search results", exact: true }),
  ).toBeVisible();
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
  const paused = page.getByRole("tab", { name: /^paused\b/i });
  await paused.click();
  await expect(paused).toHaveAttribute("aria-selected", "true");
  await expectReadableFilter(paused);
  await capture(page, info, "task-filter-dark");
});

test("project sections and account settings remain navigable and cancel safely", async ({
  page,
}, info) => {
  // This compound journey uses the same budget as the dedicated core review lane.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await coreFixture(page, "dark");
  await page.goto(`/projects/${reviewProject.id}`);
  await waitForKovaHydration(page);
  await expect(
    page.getByRole("main").getByRole("heading", { name: reviewProject.name, exact: true }),
  ).toBeVisible();
  for (const name of ["Chats", "Context"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  for (const name of [
    "Project files",
    "Project images",
    "Notes",
    "Project tasks",
    "Memory",
    "Members",
    "Collaboration",
    "Settings",
    "Activity",
  ]) {
    await page.getByRole("button", { name: "More project tools", exact: true }).click();
    await page.getByRole("menuitemradio", { name, exact: true }).click();
    await expect(page.getByRole("tabpanel")).toBeVisible();
  }
  await capture(page, info, "project-workspace");
  const settings = await openCurrentSettings(page);
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
    await chooseSettingsSection(page, name);
    await expect(settings.getByRole("tabpanel").first()).toBeVisible();
    if (name === "Subscriptions")
      await expect(settings.getByRole("button", { name: "Manage subscription" })).toBeDisabled();
  }
  await settings.getByRole("button", { name: "Schedule deletion", exact: true }).click();
  const deletion = page.getByRole("alertdialog", { name: "Schedule account deletion?" });
  await expect(deletion).toBeVisible();
  await expect(
    deletion.getByRole("button", { name: "Schedule deletion", exact: true }),
  ).toBeDisabled();
  await capture(page, info, "account-deletion-cancel");
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deletion).toBeHidden();
  await capture(page, info, "settings-data");
  const back = settings.getByRole("button", { name: "Back to settings" });
  if (await back.isVisible()) await back.click();
  const searchSettings = settings.getByRole("textbox", { name: "Search settings", exact: true });
  if (await searchSettings.isVisible()) {
    await searchSettings.fill("subscription");
    await expect(settings.getByRole("tab", { name: "Subscriptions", exact: true })).toBeVisible();
    await expect(settings.getByRole("tab", { name: "Responses", exact: true })).toHaveCount(0);
  } else {
    await settings.getByRole("button", { name: "Section", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Search sections", exact: true })
      .fill("Subscriptions");
    await expect(page.getByRole("option", { name: "Subscriptions", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Responses", exact: true })).toHaveCount(0);
    await page.keyboard.press("Escape");
  }
  const sidebar = await openSidebar(page);
  await sidebar
    .getByRole("navigation", { name: "KovaGPT features", exact: true })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(settings).toBeHidden();
  expect(errors).toEqual([]);
});
