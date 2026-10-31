import { expect, test, type Page } from "@playwright/test";
import { fixture, functionNames, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

const projectId = "33333333-3333-4333-8333-333333333333";
const instructions = "Use the reference documents and keep answers concise.";
const projects = [
  { id: projectId, name: "Research notebook", role: "owner", pinned_at: "2026-10-01T10:00:00Z" },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Alpha planning",
    role: "editor",
    pinned_at: null,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    name: "Zeta notes with a longer project name for narrow screens",
    role: "owner",
    pinned_at: null,
  },
].map((project, index) => ({
  ...project,
  description:
    index === 0
      ? "Sources, conversations, and instructions for a research project."
      : "A project workspace.",
  color: null,
  owner_id: owner,
  member_count: 2,
  chat_count: 2,
  file_count: 2,
  instructions_preview: instructions,
  created_at: "2026-10-01T10:00:00Z",
  updated_at: `2026-10-${20 + index}T10:00:00Z`,
  archived_at: null,
  deletion_requested_at: null,
}));

async function projectFixture(
  page: Page,
  theme: "light" | "dark",
  role: "owner" | "viewer" = "owner",
) {
  await fixture(page, theme);
  const mutations: string[] = [];
  await page.route("**/_serverFn/**", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const name = functionNames.get(id) ?? "";
    if (
      /^(?:create|update|delete|move|pin|duplicate|accept|decline|invite|remove|revoke|setProjectArchived)/u.test(
        name,
      )
    ) {
      mutations.push(name);
      await route.abort("blockedbyclient");
      return;
    }
    let result: unknown;
    if (name.startsWith("listProjects_")) result = projects;
    else if (name.startsWith("getProject_"))
      result = { ...projects[0], role, system_prompt: instructions };
    else if (name.startsWith("listMembers_"))
      result = [
        { user_id: owner, email: "review@example.test", role, created_at: "2026-10-01T10:00:00Z" },
      ];
    else if (name.startsWith("listProjectChats_"))
      result = [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          title: "Research outline",
          updated_at: "2026-10-22T10:00:00Z",
          created_by: owner,
        },
      ];
    else if (name.startsWith("listFiles_"))
      result = [
        "Research brief.pdf",
        "Long reference document name for small phone screens.txt",
      ].map((name, index) => ({
        id: `file-${index}`,
        project_id: projectId,
        name,
        mime_type: index ? "text/plain" : "application/pdf",
        size_bytes: 12345,
        kind: "file",
        created_at: "2026-10-22T10:00:00Z",
      }));
    else return route.fallback();
    await route.fulfill({ json: { result, context: {} } });
  });
  return mutations;
}

async function contained(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator("main#main-content")).toHaveCount(1);
}

async function expandDesktopNavigation(page: Page) {
  if (page.viewportSize()!.width < 1024) return;
  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  if (await expand.isVisible()) await expand.click();
  await expect(
    page.getByRole("navigation", { name: "KovaGPT features", exact: true }),
  ).toBeVisible();
}

for (const theme of ["light", "dark"] as const) {
  test(`project directory organizes, filters and remembers its view in ${theme}`, async ({
    page,
  }, info) => {
    const mutations = await projectFixture(page, theme);
    await page.goto("/projects");
    await waitForKovaHydration(page);
    const directory = page.locator(".kova-project-directory");
    await expect(directory).toHaveAttribute("data-project-view", "list");
    await expect(directory.locator(".kova-project-file:visible")).toHaveCount(3);
    await expandDesktopNavigation(page);
    for (const name of ["New project", "Project templates"]) {
      const button = page.getByRole("button", { name, exact: true });
      await expect(button).toBeInViewport();
      const box = await button.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      const minimum = await page.evaluate(() =>
        matchMedia("(pointer: coarse)").matches ? 44 : 36,
      );
      await expect(button).toHaveAttribute("data-ui-reference", "chatgpt.button.pill");
      expect(box!.height).toBeGreaterThanOrEqual(minimum);
    }
    if (page.viewportSize()!.width < 768) {
      const description = await directory.locator(".kova-page-description").boundingBox();
      const actions = await directory.locator(".kova-project-header-actions").boundingBox();
      const search = await directory.locator(".kova-project-directory-search").boundingBox();
      expect(actions!.y - description!.y - description!.height).toBeGreaterThanOrEqual(8);
      expect(actions!.y - description!.y - description!.height).toBeLessThanOrEqual(24);
      expect(search!.y - actions!.y - actions!.height).toBeLessThanOrEqual(24);
    }
    await expect(
      directory.getByRole("heading", { name: "Research notebook", exact: true }),
    ).toHaveCSS("font-family", /sans-serif/);
    await contained(page);
    await page.screenshot({
      path: info.outputPath(`projects-list-${theme}.png`),
      animations: "disabled",
    });

    const search = page.getByRole("textbox", { name: "Search projects", exact: true });
    await search.fill("Alpha planning");
    await expect(directory.locator(".kova-project-file:visible")).toHaveCount(1);
    await search.clear();
    await page.getByRole("button", { name: "My projects", exact: true }).click();
    await expect(directory.locator(".kova-project-file:visible")).toHaveCount(2);
    await page.getByRole("button", { name: "Shared with me", exact: true }).click();
    await expect(directory.locator(".kova-project-file:visible")).toHaveCount(1);
    await page.getByRole("button", { name: "All projects", exact: true }).click();
    await page.getByRole("combobox", { name: "Sort projects", exact: true }).click();
    await page.getByRole("option", { name: "Name", exact: true }).click();
    await expect(directory.locator(".kova-project-file:visible h3")).toHaveText(
      projects.map((p) => p.name),
    );

    const options = page.getByRole("button", {
      name: "Options for Research notebook",
      exact: true,
    });
    await options.click();
    await expect(page.getByRole("menuitem", { name: "Rename", exact: true })).toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(options).toBeFocused();

    await page.getByRole("button", { name: "Grid view", exact: true }).click();
    await expect(directory).toHaveAttribute("data-project-view", "grid");
    await page.reload();
    await waitForKovaHydration(page);
    await expect(directory).toHaveAttribute("data-project-view", "grid");
    await expect(directory.locator(".kova-project-file:visible")).toHaveCount(3);
    await contained(page);
    await page.screenshot({
      path: info.outputPath(`projects-grid-${theme}.png`),
      animations: "disabled",
    });
    const create = page.getByRole("button", { name: "New project", exact: true });
    await create.click();
    await expect(page.getByRole("dialog", { name: "New project", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(create).toBeFocused();
    expect(mutations).toEqual([]);
  });

  test(`project content has clear Chats, Files and Context destinations in ${theme}`, async ({
    page,
  }, info) => {
    const mutations = await projectFixture(page, theme);
    await page.goto(`/projects/${projectId}`);
    await waitForKovaHydration(page);
    await expect(
      page.getByRole("heading", { name: "Research notebook", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Project conversations", exact: true }),
    ).toContainText("Research outline");
    await contained(page);
    await page.screenshot({
      path: info.outputPath(`project-chats-${theme}.png`),
      animations: "disabled",
    });
    const more = page.getByRole("button", { name: "More project actions", exact: true });
    const tabsBox = await page
      .getByRole("tablist", { name: "Project sections", exact: true })
      .boundingBox();
    const toolsBox = await page
      .getByRole("button", { name: "More project tools", exact: true })
      .boundingBox();
    expect(Math.abs(tabsBox!.y - toolsBox!.y)).toBeLessThanOrEqual(2);
    await more.click();
    await page.getByRole("menuitem", { name: "Search this project", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Search this project", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    if ((page.viewportSize()?.width ?? 0) >= 380) {
      const search = page.getByRole("button", { name: "Search this project", exact: true });
      await expect(search).toBeVisible();
      await search.click();
      await expect(
        page.getByRole("dialog", { name: "Search this project", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(search).toBeFocused();
    } else {
      await expect(page.locator(".kova-project-search-action")).toBeHidden();
    }
    await page.getByRole("tab", { name: "Files", exact: true }).click();
    await expect(page.getByRole("list", { name: "Project files", exact: true })).toContainText(
      "Research brief.pdf",
    );
    await expect(
      page.getByText("Long reference document name for small phone screens.txt", { exact: true }),
    ).toBeVisible();
    await contained(page);
    await page.screenshot({
      path: info.outputPath(`project-files-${theme}.png`),
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "Context", exact: true }).click();
    const context = page.locator(".kova-project-instructions textarea");
    await expect(context).toHaveValue(instructions);
    await context.fill("Unsaved project context");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(context).toHaveValue(instructions);
    await expect(context).toBeFocused();
    await page.getByRole("button", { name: "More project tools", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Project tasks", exact: true }).click();
    await expect(page.getByRole("region", { name: "Project tasks", exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Breadcrumb", exact: true })
      .getByRole("link", { name: "Projects", exact: true })
      .click();
    await expect(page).toHaveURL(/\/projects$/u);
    expect(mutations).toEqual([]);
  });
}

test("viewer project layout keeps files and context readable without editing actions", async ({
  page,
}) => {
  const mutations = await projectFixture(page, "dark", "viewer");
  await page.goto(`/projects/${projectId}`);
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Research notebook", exact: true })).toBeVisible();
  await expandDesktopNavigation(page);
  await expect(page.getByRole("button", { name: "New chat in project", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("tab", { name: "Files", exact: true }).click();
  await expect(page.getByRole("list", { name: "Project files", exact: true })).toContainText(
    "Research brief.pdf",
  );
  await expect(page.getByText("Upload", { exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Context", exact: true }).click();
  await expect(page.locator(".kova-project-instructions textarea")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes", exact: true })).toHaveCount(0);
  await contained(page);
  expect(mutations).toEqual([]);
});

test("workspace destinations stay together in desktop navigation and the phone drawer", async ({
  page,
}) => {
  await projectFixture(page, "dark");
  await page.goto("/projects");
  await waitForKovaHydration(page);
  await expect(page.locator(".kova-project-file:visible")).toHaveCount(3);
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
  } else await expandDesktopNavigation(page);
  const workspace = page.getByRole("navigation", { name: "KovaGPT features", exact: true });
  for (const name of ["Projects", "Library", "Scheduled tasks"]) {
    await expect(workspace.getByRole("link", { name, exact: true })).toBeVisible();
  }
  const more = page.locator("details.kova-sidebar-more-disclosure");
  await more.locator("summary").click();
  await expect(page.getByRole("link", { name: "Work", exact: true })).toHaveCount(0);
  await expect(more.getByRole("link", { name: "Discover", exact: true })).toBeVisible();
  if (page.viewportSize()!.width < 1024) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Open menu", exact: true })).toBeFocused();
  }
});
