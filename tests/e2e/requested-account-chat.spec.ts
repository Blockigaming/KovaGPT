import { test, expect } from "@playwright/test";
import { fixture, owner, chatA } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { chooseSettingsSection, openCurrentSettings, revealSidebar } from "./current-ui";
import { PUBLIC_WEBSITE_PAGES } from "../../src/lib/public-website-catalog.mjs";

test("requested: returning accounts never render the signed-out homepage", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.addInitScript(() => {
    (window as unknown as { guestFlash: boolean }).guestFlash = false;
    new MutationObserver(() => {
      if (document.querySelector("#public-home-title"))
        (window as unknown as { guestFlash: boolean }).guestFlash = true;
    }).observe(document, { childList: true, subtree: true });
  });
  const response = await page.goto("/");
  expect(await response!.text()).not.toContain('id="public-home-title"');
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as { guestFlash: boolean }).guestFlash)).toBe(
    false,
  );
});

test("requested: every Settings section has room and Settings owns sidebar interaction", async ({
  page,
}, info) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  const settings = await openCurrentSettings(page);
  const sidebarPreferences = () =>
    page.evaluate(() => [
      localStorage.getItem("kova-sidebar-open"),
      localStorage.getItem("kova-mobile-sidebar-open"),
    ]);
  const before = await sidebarPreferences();
  // Desktop Settings replaces the shell; mobile Settings makes it inaccessible.
  await expect
    .poll(() =>
      page
        .locator("#kova-primary-navigation")
        .evaluateAll((nodes) =>
          nodes.every((node) => node.closest('[aria-hidden="true"], [inert]') !== null),
        ),
    )
    .toBe(true);
  await page.keyboard.press("Control+Backslash");
  expect(await sidebarPreferences()).toEqual(before);
  await expect(settings).toHaveAttribute("data-settings-open", "true");
  for (const section of [
    "Profile",
    "Appearance",
    "General",
    "Personalization",
    "Security and login",
    "Storage",
    "Notifications",
    "Connections",
    "Cloud Browser",
    "Data controls",
    "Voice",
    "Usage",
    "Subscriptions",
  ]) {
    await chooseSettingsSection(page, section);
    const geometry = await settings.evaluate((node) => ({
      width: node.clientWidth,
      scroll: node.scrollWidth,
      overflow: Array.from(node.querySelectorAll("*"))
        .filter(
          (item) => item.getBoundingClientRect().right > node.getBoundingClientRect().right + 1,
        )
        .map((item) => ({
          tag: item.tagName,
          className: item.className,
          text: item.textContent?.slice(0, 70),
        }))
        .slice(-12),
    }));
    expect(geometry.scroll, `${section}: ${JSON.stringify(geometry)}`).toBeLessThanOrEqual(
      geometry.width + 1,
    );
    const panel = settings.getByRole("tabpanel").first();
    expect(await panel.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), section).toBe(
      true,
    );
    if (section === "Voice") {
      await page.route("**/api/voice", (route) =>
        route.fulfill({ json: { stt: true, conversation: false } }),
      );
      await settings.getByRole("button", { name: "Check voice connection", exact: true }).click();
      await expect(settings.getByRole("status").filter({ hasText: "Dictation" })).toContainText(
        "Configured",
      );
      await page.screenshot({
        path: info.outputPath("settings-responses.png"),
        animations: "disabled",
      });
    }
  }
  await page.screenshot({
    path: info.outputPath("settings-subscriptions.png"),
    animations: "disabled",
  });
  await settings.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(settings).toBeHidden();
});

test("requested: account Upgrade opens its selected checkout rather than Settings", async ({ page }) => {
  await fixture(page, "dark", true);
  await page.goto("/");
  await waitForKovaHydration(page);
  const sidebar = await revealSidebar(page);
  await sidebar.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Upgrade plan", exact: true }).click();
  await expect(page).toHaveURL(/\/subscribe\?plan=plus_monthly$/);
  await expect(page.getByRole("heading", { name: "Opening checkout…", exact: true })).toBeVisible();
  await expect(page.locator(".kova-settings-dialog")).toHaveCount(0);
});

test("requested: Share confirms only a copied public view-only snapshot; Activity uses real chat content", async ({
  page,
}, info) => {
  await fixture(page, "dark", true, true);
  await page.addInitScript(
    ({ owner, chatA }) => {
      const key = `nova-gpt-conversations-v3:user:${owner}`;
      const chats = JSON.parse(localStorage.getItem(key)!);
      const chat = chats.find((item: { id: string }) => item.id === chatA);
      chat.messages[0].attachments = [
        { kind: "text_file", name: "Actual-input.txt", content: "Actual input" },
      ];
      chat.messages[1].content = "Here is the output.\n\n```js\nconst actual = true;\n```";
      localStorage.setItem(key, JSON.stringify(chats));
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async () => {} },
      });
    },
    { owner, chatA },
  );
  const shares: unknown[] = [];
  await page.route("**/api/chat-share", async (route) => {
    shares.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        id: "share-fixture",
        path: `/share/${"a".repeat(64)}`,
        expiresAt: "2026-12-05T00:00:00Z",
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const header = page.getByLabel("Conversation actions", { exact: true }).filter({ visible: true });
  await expect(header.getByRole("button")).toHaveCount(2);
  await header.getByRole("button", { name: "Activity", exact: true }).click();
  const activity = page.locator(".kova-conversation-outputs");
  await expect(activity.getByRole("heading", { name: "Outputs", exact: true })).toBeVisible();
  await expect(activity.getByRole("heading", { name: "Inputs", exact: true })).toBeVisible();
  await expect(activity).toContainText("Actual-input.txt");
  await expect(activity.getByRole("region", { name: "Cloud browser", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("chat-activity.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await header.getByRole("button", { name: "Share chat", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share this conversation", exact: true });
  await expect(share).toBeVisible();
  expect(shares).toHaveLength(0);
  await share.getByRole("button", { name: "Create & copy link", exact: true }).click();
  const copied = page.getByRole("dialog", { name: "Public view-only link copied", exact: true });
  await expect(copied).toBeVisible();
  expect(shares).toHaveLength(1);
  expect(JSON.stringify(shares[0])).not.toContain("Actual input");
  await page.screenshot({ path: info.outputPath("chat-share.png"), animations: "disabled" });
});

for (const path of [
  "/company",
  "/overview",
  "/about",
  "/features/chat",
  "/help/billing",
  "/terms",
  "/privacy",
  "/refund",
  "/pricing",
]) {
  test(`requested: public articles and legal pages have a searchable real page directory: ${path}`, async ({
    page,
  }, info) => {
    await fixture(page, "dark", false);
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      path,
    ).toBe(true);
    const directory = page.locator(".kova-footer-directory");
    await expect(directory).toHaveCount(1);
    await directory.locator("summary").click();
    await directory.getByRole("searchbox", { name: "Search the page directory" }).fill("privacy");
    const links = directory
      .getByRole("navigation", { name: "All public pages", exact: true })
      .getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    await expect(links.first()).toBeVisible();
    if (path === "/company")
      await page.screenshot({
        path: info.outputPath("public-company.png"),
        animations: "disabled",
      });
  });
}

test("requested: every published catalog route renders its actual content and shared footer", async ({
  request,
  page,
}) => {
  test.skip(page.viewportSize()!.width < 1024, "HTTP content is viewport-independent");
  test.setTimeout(90000);
  for (let index = 0; index < PUBLIC_WEBSITE_PAGES.length; index += 5) {
    await Promise.all(
      PUBLIC_WEBSITE_PAGES.slice(index, index + 5).map(async (item) => {
        const response = await request.get(item.path);
        expect(response.status(), item.path).toBe(200);
        const html = await response.text();
        expect(html, item.path).toContain('class="kova-footer-directory"');
        expect(html, item.path).toContain('id="main-content"');
      }),
    );
  }
});
