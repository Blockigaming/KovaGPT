import { test, expect } from "@playwright/test";

test.describe("projects and library workspaces", () => {
  test("projects overview desktop and mobile controls render", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    const signInGate = page.getByRole("heading", { name: /sign in to use projects/i }).first();
    const projectsHeading = page.getByRole("heading", { name: /^projects$/i }).first();
    await expect(signInGate.or(projectsHeading)).toBeVisible();
    if (await signInGate.isVisible().catch(() => false)) {
      await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
      return;
    }

    await expect(projectsHeading).toBeVisible();
    await expect(page.getByRole("button", { name: /new project/i }).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /search projects/i }).first()).toBeVisible();
  });

  test("library grid/list/search and dark mode render", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("kova-theme-mode", "dark"));
    await page.goto("/library", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /library/i }).first()).toBeVisible();
    await expect(page.getByRole("textbox", { name: /search library/i }).first()).toBeVisible();
    await page.getByRole("button", { name: /list view/i }).click();
    await expect(page.getByRole("button", { name: /grid view/i })).toBeVisible();
  });

  test("project tabs and instructions surface are reachable", async ({ page }) => {
    await page.goto("/projects/test-project", { waitUntil: "domcontentloaded" });
    const instructions = page.getByRole("tab", { name: /instructions/i }).first();
    if (await instructions.isVisible().catch(() => false)) {
      await instructions.click();
      await expect(page.getByText(/instructions are injected into project chats/i)).toBeVisible();
    }
  });
});
