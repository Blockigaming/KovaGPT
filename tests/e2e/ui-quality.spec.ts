import { expect, test } from "@playwright/test";

const projects = new Set(["phone-320x700", "phone-390x844", "desktop-1440x900"]);

test.beforeEach(({ page: _page }, testInfo) => test.skip(!projects.has(testInfo.project.name)));

test("empty workspace remains contained and composer focus is deliberate", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const composer = page.locator(".kova-composer").first();
  const input = page.getByRole("textbox", { name: "Message KovaGPT" }).first();
  await expect(composer).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" }).first()).toBeDisabled();
  await input.focus();
  await input.fill("A focused prompt");
  await expect(page.getByRole("button", { name: "Send" }).first()).toBeEnabled();

  const focused = await composer.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderRadius: Number.parseFloat(style.borderRadius),
      borderColor: style.borderColor,
      shadow: style.boxShadow,
    };
  });
  expect(focused.borderRadius).toBeGreaterThanOrEqual(16);
  expect(focused.borderColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(focused.shadow).not.toBe("none");

  const overflow = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test("mobile greeting and composer actions fit the viewport", async ({ page }) => {
  test.skip(page.viewportSize()!.width >= 1024);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("What can I help with?", { exact: true })).toBeVisible();

  const composer = page.locator(".kova-composer");
  const box = await composer.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByRole("button", { name: "Add files, tools, or prompts" }).click();
  const sheet = page.getByTestId("mobile-bottom-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Search the web" })).toBeVisible();
  await sheet.getByRole("button", { name: "Close sheet" }).click();
  await expect(sheet).toBeHidden();
});
test("rich conversation rhythm and actions remain stable at every core viewport", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = Date.now();
    localStorage.setItem(
      "nova-gpt-conversations-v2",
      JSON.stringify([
        {
          id: "workspace-quality",
          title: "Workspace quality review with a title that truncates cleanly",
          mode: "instant",
          createdAt: now,
          updatedAt: now,
          messages: [
            { id: "user-quality", role: "user", content: "Explain the result clearly." },
            {
              id: "assistant-quality",
              role: "assistant",
              content:
                "## Result\n\nReadable copy with a [source](https://example.com).\n\n| Metric | Value |\n|---|---:|\n| Stability | 100 |\n\n```ts\nconst longValue = 'abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz';\n```",
            },
          ],
        },
      ]),
    );
    localStorage.setItem("nova-gpt-pending-active", "workspace-quality");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".kova-user-message")).toBeVisible();
  await expect(page.locator(".kova-assistant-message")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const assistant = await page.locator(".kova-assistant-message").boundingBox();
  expect(assistant).not.toBeNull();
  expect(assistant!.width).toBeLessThanOrEqual(Math.min(page.viewportSize()!.width, 820));

  if (page.viewportSize()!.width < 1024) {
    const action = page.getByRole("button", { name: "Copy", exact: true });
    const box = await action.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("button", { name: "Open menu" }).click();
  }
  await expect(page.locator(".kova-chat-row")).toBeVisible();
});
