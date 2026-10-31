import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";
import { revealSidebar } from "./current-ui";
import { fixture } from "./actual-app-fixture";
import { waitForCommittedChat } from "./chat-history-commit";

test.beforeEach(async ({ page }) => {
  await fixture(page, "light", true, false, "free", { preserveStorageOnReload: true });
});

const sse = (...chunks: string[]) =>
  chunks
    .map((content) =>
      content === "[DONE]"
        ? "data: [DONE]\n\n"
        : `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content } }] })}\n\n`,
    )
    .join("");

test("authenticated chat consumes Kova SSE once and keeps page and menu identity", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:"))
      errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/title", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"title":"Mock chat"}' }),
  );
  let requests = 0;
  await page.route("**/api/chat", async (route) => {
    requests += 1;
    const headers = route.request().headers();
    expect(headers["idempotency-key"]).toMatch(/^[A-Za-z0-9:_-]{8,200}$/);
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sse("Mocked ", "OpenAI response", "[DONE]"),
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const viewport = page.viewportSize();
  if (viewport && viewport.width >= 1024) {
    const navigation = await revealSidebar(page);
    const sidebarBrand = navigation.locator(".kova-sidebar-brand");
    await expect(sidebarBrand).toHaveCount(1);
    await expect(sidebarBrand).toHaveText("KovaGPT");
  } else {
    await expect(
      page
        .locator('[data-ui-reference="chatgpt-mobile-topbar"]')
        .getByRole("heading", { name: "KovaGPT", exact: true }),
    ).toHaveCount(1);
    const navigation = await revealSidebar(page);
    const sidebarBrand = navigation.locator(".kova-sidebar-brand");
    await expect(sidebarBrand).toHaveCount(1);
    await expect(sidebarBrand).toHaveText("KovaGPT");
    await page.keyboard.press("Escape");
  }
  if (testInfo.project.name === "desktop-1280x800") {
    await page.screenshot({ path: "test-results/openai-migration-logo.png", fullPage: false });
  }
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Hello mocked runtime");
  await page.getByTestId("send-button").click();
  await expect(page.getByText("Mocked OpenAI response", { exact: false })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await revealSidebar(page);
  await expect(
    page.getByRole("button", { name: "Open chat Mock chat", exact: true }),
  ).toBeVisible();
  await waitForCommittedChat(page, "Mocked OpenAI response", "Mock chat");
  await page.reload();
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeVisible();
  await revealSidebar(page);
  await page.getByRole("button", { name: "Open chat Mock chat", exact: true }).click();
  await expect(page.getByText("Mocked OpenAI response", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  expect(errors).toEqual([]);
});

test("kill-switch error is shown once without automatic retry or horizontal overflow", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/chat", async (route) => {
    requests += 1;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "KovaGPT generation is temporarily disabled.",
        code: "provider_unavailable",
        retryable: false,
      }),
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Should be blocked");
  await page.getByTestId("send-button").click();
  await expect(page.getByText(/temporarily disabled/i).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("Stop aborts a slow generation and preserves one retryable assistant message", async ({
  page,
}) => {
  await page.route("**/api/chat", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
    await route
      .fulfill({ status: 200, contentType: "text/event-stream", body: sse("too late", "[DONE]") })
      .catch(() => undefined);
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Stop this response");
  await page.getByTestId("send-button").click();
  const stop = page.getByTestId("stop-button").first();
  await expect(stop).toBeVisible({ timeout: 2_000 });
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.getByText("too late")).toHaveCount(0);
  await expect(page.getByText("Response stopped", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry stopped response" })).toBeVisible();
  await expect(page.locator("article[aria-label='KovaGPT response']")).toHaveCount(1);
});
