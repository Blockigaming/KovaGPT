import { expect, test } from "@playwright/test";
import { waitForKovaHydration } from "./hydration";

const sse = (...chunks: string[]) =>
  chunks
    .map((content) =>
      content === "[DONE]"
        ? "data: [DONE]\n\n"
        : `data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: "assistant", content } }] })}\n\n`,
    )
    .join("");

test("guest chat consumes Kova SSE, persists once, and renders one top-left brand", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().startsWith("Failed to load resource:") &&
      message.text() !==
        "Potential permissions policy violation: payment is not allowed in this document."
    )
      errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://**", async (route) => {
    const script = route.request().resourceType() === "script";
    await route.fulfill({
      status: 200,
      contentType: script ? "application/javascript" : "application/json",
      body: script ? "" : "{}",
    });
  });
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
    await expect(page.locator("aside .kova-logo-mark")).toHaveCount(1);
    await expect(page.locator("aside").getByText("KovaGPT", { exact: true })).toHaveCount(1);
  } else {
    await expect(
      page.locator("header.kova-topbar:visible").getByText("KovaGPT", { exact: true }),
    ).toHaveCount(1);
  }
  if (testInfo.project.name === "desktop-1280x800") {
    await page.screenshot({ path: "test-results/openai-migration-logo.png", fullPage: false });
  }
  const input = page.getByRole("textbox").first();
  await input.fill("Hello mocked runtime");
  await page.getByRole("button", { name: /^send$/i }).click();
  await expect(page.getByText("Mocked OpenAI response", { exact: false })).toBeVisible();
  await expect.poll(() => requests).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Array.from({ length: localStorage.length }, (_, index) =>
          localStorage.getItem(localStorage.key(index) ?? ""),
        ).some((value) => value?.includes("Mocked OpenAI response")),
      ),
    )
    .toBe(true);
  await page.reload();
  await waitForKovaHydration(page);
  await expect(page.getByRole("textbox").first()).toBeVisible();
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
  const input = page.getByRole("textbox").first();
  await input.fill("Should be blocked");
  await page.getByRole("button", { name: /^send$/i }).click();
  await expect(page.getByText(/temporarily disabled/i).first()).toBeVisible();
  await page.waitForTimeout(500);
  expect(requests).toBe(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});

test("Stop aborts a slow generation without duplicating the assistant message", async ({
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
  const input = page.getByRole("textbox").first();
  await input.fill("Stop this response");
  await page.getByRole("button", { name: /^send$/i }).click();
  const stop = page.getByRole("button", { name: /^stop$/i }).first();
  await expect(stop).toBeVisible({ timeout: 2_000 });
  await stop.click();
  await expect(stop).toHaveCount(0);
  await expect(page.getByText("too late")).toHaveCount(0);
  await expect(page.locator("article[aria-label='KovaGPT response']")).toHaveCount(0);
});
