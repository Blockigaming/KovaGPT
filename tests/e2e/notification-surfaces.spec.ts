import { expect, test, type Page } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

const projects = new Set(["desktop-1440x900", "phone-390x844"]);
test.beforeEach(async ({ page }, testInfo) => {
  test.skip(!projects.has(testInfo.project.name));
  await fixture(page, "dark", true, false);
  await page.goto("/");
  await waitForKovaHydration(page);
});

async function emit(page: Page, notice: Record<string, unknown>) {
  await page.evaluate((detail) => {
    window.dispatchEvent(new CustomEvent("kova:notice", { detail }));
  }, notice);
}

test("modal is centered on desktop, bottom-aligned on phone and keyboard accessible", async ({
  page,
}) => {
  await emit(page, {
    id: "guided_tour",
    title: "Discover your tools",
    message: "Explore available tools whenever you are ready.",
    primaryLabel: "Explore",
  });
  const dialog = page.getByRole("dialog", { name: "Discover your tools" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  if (viewport.width <= 640) {
    expect(Math.abs(box!.y + box!.height - viewport.height)).toBeLessThan(4);
    expect(box!.width).toBeGreaterThan(viewport.width - 4);
  } else {
    expect(box!.width).toBeLessThanOrEqual(500);
    expect(Math.abs(box!.x + box!.width / 2 - viewport.width / 2)).toBeLessThan(40);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("contextual tips are nonmodal and announcements defer behind existing dialogs", async ({
  page,
}) => {
  await page.evaluate(() => {
    const anchor = document.createElement("button");
    anchor.textContent = "Reference action";
    anchor.id = "kova-notice-test-anchor";
    anchor.style.position = "fixed";
    anchor.style.top = "90px";
    anchor.style.left = "30px";
    document.body.appendChild(anchor);
  });
  await emit(page, {
    id: "quick_tip",
    title: "Quick tip",
    message: "This control has more options.",
    anchorSelector: "#kova-notice-test-anchor",
  });
  const tip = page.locator('.kova-notice-panel[data-surface="popover"]');
  await expect(tip).toBeVisible();
  await expect(tip).not.toHaveAttribute("aria-modal", "true");
  await page.getByRole("button", { name: "Close notification" }).click();
  await expect(tip).toHaveCount(0);

  await page.evaluate(() => {
    const dialog = document.createElement("div");
    dialog.id = "kova-external-dialog-test";
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
  });
  await emit(page, {
    id: "whats_new",
    title: "New update",
    message: "Verified feature announcement.",
  });
  await expect(page.getByText("New update", { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.getElementById("kova-external-dialog-test")?.remove());
  await expect(page.getByText("New update", { exact: true })).toBeVisible();
});
