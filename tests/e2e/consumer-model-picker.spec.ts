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
    const box = await trigger.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
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
    await expect(page.getByTestId("consumer-model-trigger")).toHaveAttribute(
      "aria-label",
      `Choose Kova model: ${label}`,
    );
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
