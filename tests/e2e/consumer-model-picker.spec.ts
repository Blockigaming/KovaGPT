import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

const products = ["kova-argon-4.6", "kova-neon-4.6", "kova-xenon-5"];
for (const [tier, selected, label, permitted] of [
  ["free", "kova-argon-4.6", "Argon 4.6", 1],
  ["plus", "kova-neon-4.6", "Neon 4.6", 2],
  ["pro", "kova-xenon-5", "Xenon 5", 3],
] as const) {
  test(`${tier} selects its exact product without sending, then submits and restores that choice`, async ({
    page,
  }) => {
    await fixture(page, "dark", true, false, tier, { preserveStorageOnReload: true });
    const requests: Record<string, unknown>[] = [];
    await page.route("**/api/chat", async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Verified selected model request."}}]}\n\ndata: [DONE]\n\n',
      });
    });
    await page.goto("/");
    await waitForKovaHydration(page);
    const trigger = page.getByTestId("consumer-model-trigger");
    if (tier === "free") {
      await expect(trigger).toHaveCount(0);
      await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Thinking", exact: true })).toBeVisible();
    } else {
      await expect(trigger).toBeVisible();
      await trigger.click();
      const picker = page.getByRole("dialog", { name: /^(Choose Kova model|Kova models)$/ });
      await expect(picker).toBeVisible();
      for (const [index, id] of products.entries()) {
        const button = picker.getByTestId(`consumer-model-${id}`);
        await expect(button).toBeVisible();
        if (index < permitted) await expect(button).toBeEnabled();
        else await expect(button).toBeDisabled();
      }
      await picker.getByTestId(`consumer-model-${selected}`).click();
      await expect(picker).toHaveCount(0);
      await expect(trigger).toHaveAttribute("aria-label", `Choose Kova model: ${label}`);
      await expect(page.getByRole("button", { name: "Thinking", exact: true })).toHaveCount(0);
    }
    expect(requests).toHaveLength(0);
    // Effort is a separate choice and cannot change the selected foundation.
    if (tier === "free") await page.getByRole("button", { name: "Thinking", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message KovaGPT", exact: true })
      .fill("Prove the algorithm's correctness and compare distributed-system architectures.");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(page.getByText("Verified selected model request.", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0].hostedModel).toBe(selected);
    expect(requests[0].mode).toBe(tier === "free" ? "thinking" : "instant");
    if (tier !== "free") {
      const box = await trigger.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    // Reload only after the real debounced device write commits. Seeing a
    // streamed response is not an acknowledgement that history has saved.
    await expect
      .poll(() =>
        page.evaluate(
          async ({ owner, selected }) => {
            const names = await indexedDB.databases();
            if (!names.some((db) => db.name === "kovagpt-chat-history-v1")) return false;
            return new Promise<boolean>((resolve, reject) => {
              const opened = indexedDB.open("kovagpt-chat-history-v1", 1);
              opened.onerror = () => reject(opened.error);
              opened.onsuccess = () => {
                const db = opened.result;
                const tx = db.transaction("records", "readonly");
                const request = tx.objectStore("records").getAll();
                request.onerror = () => reject(request.error);
                request.onsuccess = () =>
                  resolve(
                    request.result.some(
                      (row) =>
                        row.ownerId === owner &&
                        row.record.local?.hostedModel === selected &&
                        row.record.local.messages.some(
                          (message: { content: string }) =>
                            message.content === "Verified selected model request.",
                        ),
                    ),
                  );
                tx.oncomplete = () => db.close();
              };
            });
          },
          { owner, selected },
        ),
      )
      .toBe(true);
    await page.reload();
    await waitForKovaHydration(page);
    // The homepage deliberately starts a fresh chat after reload. Reopen the
    // saved conversation before checking its restored model choice.
    await page
      .getByRole("region", { name: "Continue working", exact: true })
      .getByRole("button")
      .first()
      .click();
    await expect(page.getByText("Verified selected model request.", { exact: true })).toBeVisible();
    if (tier === "free") {
      await expect(page.getByTestId("consumer-model-trigger")).toHaveCount(0);
      await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("consumer-model-trigger")).toHaveAttribute(
        "aria-label",
        `Choose Kova model: ${label}`,
      );
    }
  });
}

test("keyboard model selection keeps the composer draft and makes no model request", async ({
  page,
}) => {
  await fixture(page, "dark", true, false, "pro");
  let sends = 0;
  await page.route("**/api/chat", (route) => {
    sends++;
    return route.abort();
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const composer = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await composer.fill("Keep this draft while choosing Xenon.");
  const trigger = page.getByTestId("consumer-model-trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: /^(Choose Kova model|Kova models)$/ });
  await expect(picker).toBeVisible();
  await picker.getByTestId("consumer-model-kova-xenon-5").focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toBeFocused();
  await expect(composer).toHaveValue("Keep this draft while choosing Xenon.");
  expect(sends).toBe(0);
});

test("Pro slider sends all 18 exact foundation and effort configurations", async ({ page }) => {
  test.setTimeout(120_000);
  await fixture(page, "dark", true, false, "pro");
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/chat", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "text/event-stream",
      body: `data: ${JSON.stringify({ choices: [{ delta: { content: `Configuration ${requests.length} verified.` } }] })}\n\ndata: [DONE]\n\n`,
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const efforts = ["instant", "thinking", "high", "extra_high", "max", "ultra"];
  const labels = ["Lite", "Medium", "High", "Extra High", "Max", "Ultra"];
  for (const model of products) {
    await page.getByTestId("consumer-model-trigger").click();
    await page.getByTestId(`consumer-model-${model}`).click();
    for (const [index, mode] of efforts.entries()) {
      await page.getByTestId("model-selector-trigger").click();
      const slider = page.getByRole("slider", { name: "Response effort", exact: true });
      await expect(slider).toHaveAttribute("max", "5");
      await slider.press("Home");
      for (let step = 0; step < index; step++) await slider.press("ArrowRight");
      await expect(slider).toHaveAttribute("aria-valuetext", labels[index]);
      await slider.press("Escape");
      const number = requests.length + 1;
      await page
        .getByRole("textbox", { name: "Message KovaGPT", exact: true })
        .fill(`Verify configuration ${number}.`);
      await page.getByRole("button", { name: "Send message", exact: true }).click();
      await expect(
        page.getByText(`Configuration ${number} verified.`, { exact: true }),
      ).toBeVisible();
      expect(requests.at(-1)?.hostedModel).toBe(model);
      expect(requests.at(-1)?.mode).toBe(mode);
    }
  }
  expect(requests).toHaveLength(18);
});

test("Plus slider stops at High and never offers Pro effort positions", async ({ page }) => {
  await fixture(page, "dark", true, false, "plus");
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByTestId("model-selector-trigger").click();
  const slider = page.getByRole("slider", { name: "Response effort", exact: true });
  await expect(slider).toHaveAttribute("max", "2");
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "High");
  for (const mode of ["extra_high", "max", "ultra"])
    await expect(page.getByTestId(`model-option-${mode}`)).toHaveCount(0);
});
