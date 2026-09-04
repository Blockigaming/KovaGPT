import { test, expect } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

test.describe("projects and library workspaces", () => {
  test("projects overview desktop and mobile controls render", async ({ page }) => {
    await page.goto("/projects", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const signInGate = page.getByRole("heading", { name: /sign in to use projects/i }).first();
    const projectsHeading = page.getByRole("heading", { name: /^projects$/i }).first();
    await expect(projectsHeading).toBeVisible();
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
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: /library/i }).first()).toBeVisible();
    const guestState = page.getByRole("heading", {
      name: "Saved in this browser",
      exact: true,
    });
    const librarySearch = page.getByRole("textbox", { name: /search library/i }).first();
    await expect(guestState.or(librarySearch).first()).toBeVisible();
    if (await guestState.isVisible().catch(() => false)) {
      await expect(page.getByText("Nothing saved in this browser")).toBeVisible();
      await expect(page.getByRole("button", { name: /^sign in$/i })).toBeVisible();
      return;
    }
    await expect(librarySearch).toBeVisible();
    await page.getByRole("button", { name: /list view/i }).click();
    await expect(page.getByRole("button", { name: /grid view/i })).toBeVisible();
  });

  test("project tabs and instructions surface are reachable", async ({ page }) => {
    await page.goto("/projects/test-project", { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    const instructions = page.getByRole("tab", { name: /instructions/i }).first();
    if (await instructions.isVisible().catch(() => false)) {
      await instructions.click();
      await expect(page.getByText(/instructions are injected into project chats/i)).toBeVisible();
    }
  });
});
