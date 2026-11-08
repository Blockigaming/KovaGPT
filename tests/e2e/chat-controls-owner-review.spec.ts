import { test, expect } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { owner, chatA, functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("response is unboxed with five ordered actions, public response sharing, and a persistent bookmark", async ({
  page,
}) => {
  await coreFixture(page, "dark");
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as unknown as { copiedValue: string }).copiedValue = text;
        },
      },
    }),
  );
  const shares: unknown[] = [];
  await page.route("**/api/chat-share", async (route) => {
    shares.push(route.request().postDataJSON());
    await route.fulfill({ json: { id: "share-fixture", path: "/share/" + "a".repeat(64) } });
  });
  await page.route("**/_serverFn/**", async (route) => {
    const name =
      functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) || "";
    if (name.startsWith("saveToLibrary_"))
      return route.fulfill({ json: { result: { id: "library-fixture" }, context: {} } });
    return route.fallback();
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const answer = page.getByRole("article", { name: "KovaGPT response", exact: true }).first();
  await expect(answer).toBeVisible();
  const toolbar = answer.getByRole("toolbar", { name: "Response actions" });
  await expect(toolbar.getByRole("button")).toHaveCount(5);
  expect(
    await toolbar
      .getByRole("button")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label"))),
  ).toEqual(["Copy response", "Read aloud", "Share response", "Save to Library", "More actions"]);
  await expect(answer.locator(".kova-assistant-message")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  await expect(answer.locator(".kova-assistant-message")).toHaveCSS("border-radius", "0px");
  await expect(toolbar).toHaveCSS("border-top-width", "1px");
  await toolbar.getByRole("button", { name: "Share response", exact: true }).click();
  await expect(page.getByText("Public view-only link copied", { exact: true })).toBeVisible();
  expect(shares).toHaveLength(1);
  expect((shares[0] as { messages: { role: string }[] }).messages.map((m) => m.role)).toEqual([
    "assistant",
  ]);
  expect(
    await page.evaluate(() => (window as unknown as { copiedValue: string }).copiedValue),
  ).toMatch(/\/share\/a{64}$/);
  await toolbar.getByRole("button", { name: "Share response", exact: true }).click();
  expect(shares).toHaveLength(1);
  await toolbar.getByRole("button", { name: "Save to Library", exact: true }).click();
  await expect(
    toolbar.getByRole("button", { name: "Saved to Library", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "Saved to Library", exact: true }).click();
  await page.waitForTimeout(2200); // Saving again must not clear the filled bookmark after two seconds.
  await expect(
    toolbar.getByRole("button", { name: "Saved to Library", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(page.getByRole("menuitem", { name: "Try again", exact: true })).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Branch into new chat", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Prepare or manage Work", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: test.info().outputPath("response-controls.png"),
    animations: "disabled",
  });
});

test("free gift offer opens a popup and selected Plus redirects directly to hosted checkout", async ({
  page,
}) => {
  await coreFixture(page, "dark");
  let creates = 0;
  await page
    .context()
    .route("https://checkout.stripe.com/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<h1>Checkout fixture</h1>" }),
    );
  await page.route("**/_serverFn/**", async (route) => {
    const name =
      functionNames.get(new URL(route.request().url()).pathname.split("/").at(-1)!) || "";
    if (name.startsWith("createCheckoutSession_")) {
      creates++;
      return route.fulfill({
        json: { result: { url: "https://checkout.stripe.com/c/pay/cs_test_fixture" }, context: {} },
      });
    }
    return route.fallback();
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const offer = page
    .getByRole("button", { name: "Free offer: 50% off your first month", exact: true })
    .filter({ visible: true });
  await expect(offer.getByText("Free offer", { exact: true })).toBeVisible();
  await expect(offer).toHaveCSS("display", /^(inline-)?flex$/);
  await expect(offer).toHaveCSS("color", "rgb(56, 189, 248)");
  // Read both boxes in one frame: opening the returning sidebar can move the header.
  const { iconBox, labelBox } = await offer.evaluate((node) => ({
    iconBox: node.querySelector("svg")!.getBoundingClientRect().toJSON(),
    labelBox: node.querySelector("span")!.getBoundingClientRect().toJSON(),
  }));
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(labelBox.x);
  expect(Math.abs(iconBox.y + iconBox.height / 2 - labelBox.y - labelBox.height / 2)).toBeLessThan(
    2,
  );
  await offer.click();
  const dialog = page.getByRole("dialog", {
    name: "50% off your first month of Plus",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Get 50% off Plus", exact: true }).click();
  await expect(page).toHaveURL("https://checkout.stripe.com/c/pay/cs_test_fixture");
  expect(creates).toBe(1);
});

test("chat deletion has a five second Undo window and never writes a Trash copy", async ({
  page,
}) => {
  await coreFixture(page, "dark");
  await page.goto("/");
  await waitForKovaHydration(page);
  const open = page
    .getByRole("button", { name: /^(Open menu|Expand sidebar|Open sidebar)$/ })
    .filter({ visible: true })
    .first();
  if (await open.isVisible()) await open.click();
  const options = page
    .getByRole("button", { name: "Options for Composer review chat", exact: true })
    .filter({ visible: true });
  await options.click();
  if (page.viewportSize()!.width >= 1024) {
    const menu = await page.getByRole("menu").boundingBox();
    const sidebar = await page.locator("#kova-primary-navigation").boundingBox();
    expect(menu!.x).toBeGreaterThanOrEqual(sidebar!.x + sidebar!.width);
  }
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Chat deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "Open chat Composer review chat", exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await options.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Chat deleted", { exact: true })).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ owner, chatA }) =>
            JSON.parse(
              localStorage.getItem(`nova-gpt-conversations-v3:user:${owner}`) || "[]",
            ).some((c: { id: string }) => c.id === chatA),
          { owner, chatA },
        ),
      { timeout: 10000 },
    )
    .toBe(false);
  expect(
    await page.evaluate(({ owner }) => localStorage.getItem(`kova-chat-trash-v1:user:${owner}`), {
      owner,
    }),
  ).toBeNull();
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveCount(0);
});

test("cloud browser and steps precede outputs in the borderless activity surface", async ({
  page,
}) => {
  await coreFixture(page, "dark");
  await page.addInitScript(
    ({ owner }) => {
      const key = `nova-gpt-conversations-v3:user:${owner}`;
      const chats = JSON.parse(localStorage.getItem(key) || "[]");
      chats[0].messages[1].activities = [
        { tool: "browser_interact", label: "Opened the review page", status: "done" },
        { tool: "file_search", label: "Read the supplied notes", status: "done" },
      ];
      localStorage.setItem(key, JSON.stringify(chats));
    },
    { owner },
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  await page
    .getByRole("button", { name: "Activity", exact: true })
    .filter({ visible: true })
    .click();
  const panel = page.locator(".kova-conversation-outputs");
  await expect(panel).toHaveCSS("border-top-width", "0px");
  const headings = await panel.getByRole("heading").allTextContents();
  expect(headings.indexOf("Cloud browser")).toBeGreaterThanOrEqual(0);
  expect(headings.indexOf("Steps")).toBeGreaterThan(headings.indexOf("Cloud browser"));
  expect(headings.indexOf("Outputs")).toBeGreaterThan(headings.indexOf("Steps"));
  await expect(panel.getByText("Read the supplied notes", { exact: true })).toBeVisible();
});

test("transient history failures retry quietly without a reconnect banner", async ({ page }) => {
  await coreFixture(page, "dark");
  let reads = 0;
  await page.route("**/api/chat/history**", (route) => {
    reads++;
    return route.fulfill({ status: 503, json: { error: "temporarily unavailable" } });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  await expect(page.getByRole("article", { name: "KovaGPT response", exact: true })).toBeVisible();
  await expect.poll(() => reads, { timeout: 15000 }).toBeGreaterThan(1);
  await expect(
    page.getByText("Chats are saved on this device. Reconnecting to your account…", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry chat sync", exact: true })).toHaveCount(0);
});
