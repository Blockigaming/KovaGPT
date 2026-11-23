import { expect, test } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";
import { revealContinueWorking } from "./current-ui";

const products = [
  "kova-xenon-6.1",
  "kova-xenon-5",
  "kova-xenon-4.6",
  "kova-neon-4.6",
  "kova-neon-4.5",
  "kova-argon-4.6",
  "kova-argon-4.5",
];
for (const [tier, selected, label, permitted] of [
  ["free", "kova-argon-4.6", "Kova Argon 4.6", 1],
  ["plus", "kova-neon-4.6", "Kova Neon 4.6", 7],
  ["pro", "kova-xenon-5", "Kova Xenon 5", 7],
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
    const trigger = page.getByTestId("model-selector-trigger");
    if (tier === "free") {
      await expect(trigger).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Thinking", exact: true })).toBeVisible();
    } else {
      await expect(trigger).toBeVisible();
      await trigger.click();
      const picker = page.getByRole("dialog", { name: "Select model", exact: true });
      await expect(picker).toBeVisible();
      await expect(trigger).toHaveCSS("border-width", "0px");
      await expect(picker).toHaveCSS("border-width", "0px");
      await expect(picker.getByRole("slider", { name: "Response effort" })).toHaveAttribute(
        "aria-valuetext",
        "Lite",
      );
      await picker.getByRole("button", { name: "Select model", exact: true }).click();
      await expect(picker).toHaveCSS("border-width", "0px");
      expect(
        await picker
          .getByTestId(/^consumer-model-kova-/)
          .evaluateAll((buttons) =>
            buttons.map((button) =>
              button.getAttribute("data-testid")?.replace("consumer-model-", ""),
            ),
          ),
      ).toEqual(products);
      for (const [index, id] of products.entries()) {
        const button = picker.getByTestId(`consumer-model-${id}`);
        await expect(button).toBeVisible();
        if (index < permitted) await expect(button).toBeEnabled();
        else await expect(button).toBeDisabled();
      }
      await picker.getByTestId(`consumer-model-${selected}`).click();
      await expect(picker.getByRole("slider")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toHaveAttribute("aria-label", `Choose model and effort, ${label} Lite`);
      await expect(page.getByRole("button", { name: "Thinking", exact: true })).toHaveCount(0);
    }
    expect(requests).toHaveLength(0);
    // Free uses its Thinking toggle for the next request.
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
    const recommendations = await revealContinueWorking(page);
    await recommendations.getByRole("button").first().click();
    await expect(page.getByText("Verified selected model request.", { exact: true })).toBeVisible();
    if (tier === "free") {
      await expect(page.getByTestId("model-selector-trigger")).toHaveCount(0);
    } else {
      await expect(page.getByTestId("model-selector-trigger")).toHaveAttribute(
        "aria-label",
        `Choose model and effort, ${label} Lite`,
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
  const trigger = page.getByTestId("model-selector-trigger");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Select model", exact: true });
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: "Select model", exact: true }).press("Enter");
  await picker.getByTestId("consumer-model-kova-xenon-5").focus();
  await page.keyboard.press("Enter");
  await expect(picker.getByRole("button", { name: "Select model", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(composer).toHaveValue("Keep this draft while choosing Xenon.");
  expect(sends).toBe(0);
});

for (const [tier, count] of [
  ["plus", 35],
  ["pro", 42],
] as const)
  test(`${tier} slider sends all ${count} exact foundation and effort configurations`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await fixture(page, "dark", true, false, tier);
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
    const efforts =
      tier === "pro"
        ? ["instant", "thinking", "high", "extra_high", "max", "ultra"]
        : ["instant", "thinking", "high", "extra_high", "max"];
    const labels = ["Lite", "Medium", "High", "Extra High", "Max", "Ultra"];
    for (const model of products) {
      await page.getByTestId("model-selector-trigger").click();
      const picker = page.getByRole("dialog", { name: "Select model", exact: true });
      await picker.getByRole("button", { name: "Select model", exact: true }).click();
      await picker.getByTestId(`consumer-model-${model}`).click();
      await page.keyboard.press("Escape");
      await expect(picker).toBeHidden();
      for (const [index, mode] of efforts.entries()) {
        await page.getByTestId("model-selector-trigger").click();
        const slider = page.getByRole("slider", { name: "Response effort", exact: true });
        await expect(slider).toHaveAttribute("max", String(efforts.length - 1));
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
    expect(requests).toHaveLength(count);
  });

test("Plus slider stops at Max and never offers Ultra", async ({ page }) => {
  await fixture(page, "dark", true, false, "plus");
  await page.goto("/");
  await waitForKovaHydration(page);
  await page.getByTestId("model-selector-trigger").click();
  const slider = page.getByRole("slider", { name: "Response effort", exact: true });
  await expect(slider).toHaveAttribute("max", "4");
  await slider.press("End");
  await expect(slider).toHaveAttribute("aria-valuetext", "Max");
  await slider.press("ArrowRight");
  await expect(slider).toHaveAttribute("aria-valuetext", "Max");
});

for (const [tier, highest] of [
  ["plus", "Max"],
  ["pro", "Ultra"],
] as const) {
  test(`mobile ${tier} Send hold selects an entitled model and effort without sending`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, "dark", true, false, tier);
    await page.addInitScript(() => localStorage.setItem("kova-sidebar-open", "0"));
    await page.goto("/");
    await waitForKovaHydration(page);
    const draft = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await draft.fill("Explain the causes of tides.");
    const send = page.getByTestId("send-button");
    await send.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0 });
    const picker = page.getByRole("dialog", { name: "Intelligence", exact: true });
    await expect(picker).toBeVisible();
    await send.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0 });
    await send.dispatchEvent("click", { detail: 1 });
    await picker
      .getByRole("combobox", { name: "Available models" })
      .selectOption({ label: "Kova Neon 4.6" });
    const rail = picker.getByRole("slider", { name: "Response effort" });
    await rail.press("Home");
    await expect(rail).toHaveAttribute("aria-valuetext", highest);
    await picker.getByRole("button", { name: "Kova Neon 4.6 Medium", exact: true }).click();
    await expect(rail).toHaveAttribute("aria-valuetext", "Medium");
    await picker.getByRole("button", { name: "Close Intelligence" }).click();
    await expect(picker).toBeHidden();
    await expect(draft).toHaveValue("Explain the causes of tides.");
    await expect(page.getByTestId("model-selector-trigger")).toHaveAccessibleName(
      /Kova Neon 4.6 Medium/,
    );
  });
}
