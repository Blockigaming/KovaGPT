import { test, expect } from "@playwright/test";
import { fixture, owner } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("chat exposes task and audio tools without opening Work or sending the draft", async ({
  page,
}) => {
  await fixture(page, "dark", true);
  const writes: { path: string; owner: string | undefined; body: unknown }[] = [];
  const availability: string[] = [];
  await page.route("**/api/ai/services", async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      availability.push("tasks");
      await route.fulfill({
        json: {
          configured: true,
          operations: ["agent", "browser", "decisions", "moderation"].map((operation) => ({
            operation,
            available: true,
          })),
        },
      });
      return;
    }
    writes.push({
      path: "/api/ai/services",
      owner: request.headers()["x-kova-service-owner"],
      body: request.postDataJSON(),
    });
    await route.fulfill({ json: { operation: "agent", text: "The synthetic task finished." } });
  });
  await page.route("**/api/voice", async (route) => {
    if (route.request().method() !== "GET") {
      writes.push({ path: "/api/voice", owner: undefined, body: null });
      await route.abort("blockedbyclient");
      return;
    }
    availability.push("audio");
    await route.fulfill({
      json: {
        configured: true,
        tts: true,
        stt: true,
        sts: true,
        voices: [{ id: "default", label: "Fixture voice", available: true }],
        defaultVoiceId: "default",
      },
    });
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
  await input.fill("Keep this unsent draft.");
  const attach = page.getByRole("button", { name: "Attach", exact: true });
  await attach.click();
  const moreTools = page
    .locator("summary")
    .filter({ hasText: /^More tools$/ })
    .filter({ visible: true });
  await expect(moreTools).toBeVisible();
  await moreTools.click();
  await page.getByRole("button", { name: "Tasks and audio", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tools", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: "Task type" })).toBeEnabled();
  expect(writes).toEqual([]);
  expect(availability).toContain("tasks");
  expect(availability).not.toContain("audio");
  await dialog.getByRole("textbox").fill("Complete this synthetic task.");
  await dialog.getByRole("button", { name: "Run task", exact: true }).click();
  await expect(dialog.getByText("The synthetic task finished.", { exact: true })).toBeVisible();
  expect(writes).toEqual([
    {
      path: "/api/ai/services",
      owner,
      body: { operation: "agent", input: "Complete this synthetic task." },
    },
  ]);
  await dialog.getByRole("tab", { name: "Audio", exact: true }).click();
  await expect(dialog.getByLabel("Audio operation", { exact: true })).toBeEnabled();
  await expect(dialog.getByLabel("Audio operation", { exact: true })).toContainText(
    "Transcribe audio",
  );
  await expect(dialog.getByLabel("Audio operation", { exact: true })).toContainText(
    "Transform voice",
  );
  expect(availability).toContain("audio");
  expect(writes).toHaveLength(1);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(attach).toBeFocused();
  await expect(input).toHaveValue("Keep this unsent draft.");
  expect(new URL(page.url()).pathname).toBe("/");
});
