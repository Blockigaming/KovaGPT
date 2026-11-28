import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";

test("scrollable history and chat-body search reach older conversations", async ({
  page,
}, info) => {
  test.skip(!["phone-390x844", "desktop-1440x900"].includes(info.project.name));
  await fixture(page, "dark");
  await page.addInitScript((userId) => {
    const now = Date.now();
    const chats = Array.from({ length: 24 }, (_, index) => ({
      id: `a0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      title: index === 23 ? "Bob has a friend" : `Planning chat ${index}`,
      updatedAt: now - 1000 * index,
      createdAt: now - 1000 * index,
      messages: [
        {
          id: "prompt",
          role: "user",
          content: index === 23 ? "How much money do we need?" : "Plans for the week.",
          createdAt: now,
        },
      ],
      mode: "instant",
    }));
    localStorage.setItem(`nova-gpt-conversations-v3:user:${userId}`, JSON.stringify(chats));
  }, owner);
  await page.goto("/");
  await waitForKovaHydration(page);
  await revealSidebar(page);
  const sidebar = page.locator("#kova-primary-navigation");
  const history = sidebar.getByRole("region", { name: "Chats", exact: true });
  await expect(
    history.getByRole("button", { name: "Open chat Bob has a friend", exact: true }),
  ).toHaveCount(1);
  await expect(sidebar.getByText("View all chats", { exact: true })).toHaveCount(0);
  await sidebar.getByRole("button", { name: "Search chats", exact: true }).click();
  const search = page.getByRole("dialog", { name: "Search chats", exact: true });
  const field = search.getByRole("searchbox");
  await expect(field).toBeFocused();
  await field.fill("money unrelated-word");
  const found = search.getByRole("button", { name: "Open chat Bob has a friend", exact: true });
  await expect(found).toContainText("How much money");
  await found.click();
  await expect(search).toBeHidden();
  await expect(page.getByText("How much money do we need?", { exact: true })).toBeVisible();
});

test("desktop settings entry and deep link remain usable", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440x900");
  await fixture(page, "dark");
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("tab", { name: "General", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page).toHaveURL(/\/$/);
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await page.goto("/settings/appearance");
  await expect(settings.getByRole("tab", { name: "Appearance", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("desktop chat renders the fade, blue emphasis, and default home surfaces", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop-1440x900");
  await fixture(page, "dark", true, true, "free", {
    savedMessages: [
      { id: "prompt-a", role: "user", content: "Summarize the main detail." },
      { id: "answer-a", role: "assistant", content: "Keep the **important detail** in view." },
    ],
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const header = page.locator(".kova-desktop-topbar");
  await expect(header).toHaveCSS("border-bottom-width", "0px");
  await expect
    .poll(() => header.evaluate((node) => getComputedStyle(node, "::after").backgroundImage))
    .toMatch(/^linear-gradient\(/);
  await expect(page.locator(".kova-response-emphasis")).toHaveCSS("color", "rgb(124, 196, 255)");

  const sidebar = await revealSidebar(page);
  await sidebar.getByRole("button", { name: "New chat", exact: true }).click();
  const canvas = await page
    .locator(".kova-chat-main")
    .evaluate((node) => getComputedStyle(node).backgroundColor);
  await expect(page.locator(".kova-empty-composer .kova-composer-tray")).toHaveCSS(
    "background-color",
    canvas,
  );
  await expect(
    page.getByRole("region", { name: "Continue working" }).getByRole("button").first(),
  ).toHaveCSS("background-color", canvas);
});
