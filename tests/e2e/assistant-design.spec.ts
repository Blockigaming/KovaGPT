import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installAuthenticatedFixture } from "./authenticated-fixture";
import { waitForKovaHydration } from "./hydration";

// These are renders of the actual application with synthetic provider responses.
// They prove layout/interaction, not authentication or live model acceptance.
async function capture(page: Page, info: TestInfo, state: string) {
  const directory = process.env.KOVA_UI_CAPTURE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page
    .locator("img.kova-logo:visible")
    .evaluateAll((logos) => Promise.all(logos.map((logo) => (logo as HTMLImageElement).decode())));
  await page.mouse.move(page.viewportSize()!.width - 4, page.viewportSize()!.height / 2);
  await page.screenshot({
    path: path.join(directory, `${info.project.name}-${state}.png`),
    fullPage: false,
    animations: "disabled",
  });
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(1);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  const composer = await input.boundingBox();
  expect(composer?.width).toBeGreaterThan(200);
  await expect(input).toBeVisible();
}

test("assistant and login render in both themes with usable mobile navigation", async ({
  page,
}, info) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
    await page.goto("/");
    await waitForKovaHydration(page);
    await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Start with Make a plan" })).toBeVisible();
    await expect(page.locator(".kova-auth-primary:visible")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    for (const logo of await page.locator("img.kova-logo:visible").all()) {
      await expect(logo).toHaveAttribute("src", "/kova-logo.png");
      await expect(logo).toHaveJSProperty("naturalWidth", 1024);
    }
    await noOverflow(page);
    await expect(page.getByText("Your space to think", { exact: true })).toBeVisible();
    await expect(page.getByText("Bring a question", { exact: false })).toHaveCount(0);
    const heading = await page
      .getByRole("heading", { name: "What can I help with?" })
      .boundingBox();
    const composer = await page.locator(".kova-composer").first().boundingBox();
    expect(
      Math.abs(heading!.x + heading!.width / 2 - composer!.x - composer!.width / 2),
    ).toBeLessThan(1);
    await capture(page, info, `${theme}-empty`);

    await page.getByRole("button", { name: "Start with Make a plan" }).click();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
    await page.getByRole("textbox", { name: "Message KovaGPT" }).fill("");

    if (page.viewportSize()!.width < 1024) {
      const menu = page.getByRole("button", { name: "Open menu" });
      await menu.click();
      await expect(page.getByRole("link", { name: "Projects", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Files", exact: true })).toHaveCount(0);
      const billing = await page.getByRole("link", { name: "Billing", exact: true }).boundingBox();
      const login = await page.getByRole("button", { name: "Log in to KovaGPT" }).boundingBox();
      expect(billing!.y + billing!.height).toBeLessThan(login!.y);
      await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
      await capture(page, info, `${theme}-navigation`);
      await page.keyboard.press("Escape");
      await expect(menu).toBeFocused();
    } else {
      await expect(page.getByRole("navigation", { name: "KovaGPT features" })).toBeVisible();
      await capture(page, info, `${theme}-navigation`);
    }

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: "Email address" })).toBeFocused();
    await capture(page, info, `${theme}-login`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeFocused();
    await page.goto("/auth?mode=sign-in&email=preview%40example.invalid");
    await waitForKovaHydration(page);
    await expect(page.getByRole("heading", { name: "Enter your password" })).toBeVisible();
    await capture(page, info, `${theme}-password`);
  }
});

test("shared-chat error envelopes keep Library and assistant navigation usable", async ({
  page,
}) => {
  await installAuthenticatedFixture(page);
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({
      json: { result: { error: "service_unavailable" } },
    }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("link", { name: "Library", exact: true }).click();
  await expect(page.getByText("Could not load shared chats", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Shared chats are temporarily unavailable. Please retry.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "KovaGPT couldn't load this page" })).toHaveCount(
    0,
  );
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: /KovaGPT features|Collapsed navigation/ })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
});

test("streaming and completion keep the composer usable", async ({ page }, info) => {
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    const encoder = new TextEncoder();
    Object.assign(window, { finishAssistantFixture: () => {} });
    window.fetch = async (input, options) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url, location.origin).pathname !== "/api/chat")
        return originalFetch(input, options);
      const stream = new ReadableStream({
        start(controller) {
          const chunk = (content: string) =>
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
            );
          chunk(
            "## A clearer plan\n\nStart with the outcome, then make the next step small enough to do today.\n\n",
          );
          Object.assign(window, {
            finishAssistantFixture: () => {
              chunk(
                "1. **Define the goal.** Write one sentence describing what success looks like.\n2. **Choose the next step.** Pick one task you can finish in 20 minutes.\n3. **Review what changed.** Adjust the plan using what you learned.\n\nWhat would you like to work on first?",
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          });
          options?.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
    };
  });
  await page.route("**/api/title", (route) => route.fulfill({ json: { title: "A clearer plan" } }));
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Help me turn a big idea into a practical plan.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("heading", { name: "A clearer plan" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating" })).toBeVisible();
  await noOverflow(page);
  await capture(page, info, "streaming");
  await page.evaluate(() =>
    (window as Window & { finishAssistantFixture(): void }).finishAssistantFixture(),
  );
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await expect(
    page.getByText("What would you like to work on first?", { exact: false }),
  ).toBeVisible();
  await capture(page, info, "conversation");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/dark/);
  await capture(page, info, "dark-conversation");
});

test("Files error envelopes retain navigation back to the assistant", async ({ page }, info) => {
  await installAuthenticatedFixture(page);
  await page.route("**/_serverFn/**", (route) =>
    route.fulfill({ json: { error: "fixture_unavailable" } }),
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await capture(page, info, "signed-in-empty");
  // Existing file deep links remain supported; new navigation lives in Library.
  await page.goto("/files");
  await expect(page.getByRole("heading", { name: "Files could not be loaded" })).toBeVisible();
  await capture(page, info, "files-error");
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Open menu" }).click();
  await page
    .getByRole("navigation", { name: /KovaGPT features|Collapsed navigation/ })
    .getByRole("button", { name: "New chat", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("textbox", { name: "Message KovaGPT" })).toBeVisible();
});

test("provider failure stays visible and leaves the composer usable", async ({ page }, info) => {
  let requests = 0;
  await page.route("**/api/chat", (route) => {
    requests += 1;
    return route.fulfill({
      status: 503,
      json: {
        error: "KovaGPT generation is temporarily disabled.",
        code: "provider_unavailable",
        retryable: false,
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT" });
  await input.fill("Help me prepare for tomorrow.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/temporarily disabled/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Stop generating" })).toHaveCount(0);
  await noOverflow(page);
  await capture(page, info, "provider-error");
  await input.fill("A revised question");
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  // A visible notification must never intercept the next prompt's send action.
  await page.getByRole("button", { name: "Send message" }).click({ trial: true });
  expect(requests).toBe(1);
});
