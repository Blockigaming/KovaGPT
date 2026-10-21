import { expect, test, type Page } from "@playwright/test";
import { recoveryCrudFixture, createdProjectId } from "./recovery-crud-fixture";
import { waitForKovaHydration } from "./hydration";

async function openProjects(page: Page) {
  await page.goto("/projects");
  await waitForKovaHydration(page);
  await expect(page.getByRole("heading", { name: "Projects", exact: true })).toBeVisible();
}
async function projectMenu(page: Page, name: string, action: string) {
  await page.getByRole("button", { name: `Options for ${name}`, exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}
async function libraryDelete(page: Page) {
  await page.getByRole("button", { name: "Actions for Release notes", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  return page.getByRole("alertdialog", { name: "Delete this Library item?" });
}

test("review-only Project create and rename preserve failed drafts, then delete safely", async ({
  page,
}) => {
  const state = await recoveryCrudFixture(page);
  await openProjects(page);
  await page.getByRole("button", { name: "New project", exact: true }).first().click();
  const create = page.getByRole("dialog", { name: "New project", exact: true });
  await create.getByLabel("Name", { exact: true }).fill("Synthetic recovery project");
  await create.getByLabel("Description (optional)").fill("Review-only draft retained on error");
  await create.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.calls).toHaveLength(0);
  await page.getByRole("button", { name: "New project", exact: true }).first().click();
  await expect(create.getByLabel("Name", { exact: true })).toHaveValue(
    "Synthetic recovery project",
  );
  state.failNext.add("createProject");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(
    page.getByText("Synthetic review failure. Please retry.", { exact: true }),
  ).toBeVisible();
  await expect(create.getByLabel("Name", { exact: true })).toHaveValue(
    "Synthetic recovery project",
  );
  await expect(create.getByLabel("Description (optional)")).toHaveValue(
    "Review-only draft retained on error",
  );
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${createdProjectId}$`));
  expect(state.projects.some((project) => project.id === createdProjectId)).toBe(true);

  await openProjects(page);
  await projectMenu(page, "Synthetic recovery project", "Rename");
  const rename = page.getByRole("dialog", { name: "Rename project", exact: true });
  await rename.locator("input").fill("Renamed recovery project");
  await rename.locator("textarea").fill("Edited review-only description");
  state.failNext.add("updateProject");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rename.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(rename.locator("input")).toHaveValue("Renamed recovery project");
  await expect(rename.locator("textarea")).toHaveValue("Edited review-only description");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rename).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Options for Renamed recovery project", exact: true }),
  ).toBeVisible();
  await projectMenu(page, "Renamed recovery project", "Delete");
  const confirmation = page.getByRole("alertdialog", { name: "Delete this project?" });
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.calls.filter((call) => call.operation === "deleteProject")).toHaveLength(0);
  state.failNext.add("deleteProject");
  await projectMenu(page, "Renamed recovery project", "Delete");
  await confirmation.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect
    .poll(() => state.calls.filter((call) => call.operation === "deleteProject").length)
    .toBe(1);
  await expect(
    page.getByRole("button", { name: "Options for Renamed recovery project", exact: true }),
  ).toBeEnabled();
  await projectMenu(page, "Renamed recovery project", "Delete");
  await confirmation.getByRole("button", { name: "Delete project", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Options for Renamed recovery project", exact: true }),
  ).toHaveCount(0);
  expect(state.projects.some((project) => project.id === createdProjectId)).toBe(false);
  expect(state.calls.map((call) => call.operation)).toEqual([
    "createProject",
    "createProject",
    "updateProject",
    "updateProject",
    "deleteProject",
    "deleteProject",
  ]);
});

test("review-only Library preview, delete cancellation and failed-delete retry", async ({
  page,
}) => {
  const state = await recoveryCrudFixture(page);
  await page.goto("/library");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Release notes", exact: true }).click();
  const preview = page.getByRole("dialog", { name: "Release notes", exact: true });
  await expect(preview).toContainText("Synthetic review content. No account records are included.");
  const bounds = await preview.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  await preview.getByRole("button", { name: "Close", exact: true }).click();
  await (await libraryDelete(page)).getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.calls).toHaveLength(0);
  state.failNext.add("deleteLibraryItem");
  await (await libraryDelete(page)).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(
    page.getByText("Could not delete this Library item. Please try again.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Release notes", exact: true })).toBeVisible();
  expect(state.items).toHaveLength(2);
  await (await libraryDelete(page)).getByRole("button", { name: "Delete", exact: true }).click();
  await expect.poll(() => state.items.length).toBe(1);
  await expect(page.getByRole("button", { name: "Release notes", exact: true })).toHaveCount(0);
  expect(state.calls.map((call) => call.operation)).toEqual([
    "deleteLibraryItem",
    "deleteLibraryItem",
  ]);
});
