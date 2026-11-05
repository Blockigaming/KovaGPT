import { expect, test, type Page } from "@playwright/test";
import { coreFixture } from "../e2e/core-app-fixture";
import { owner, chatA } from "../e2e/actual-app-fixture";
import { waitForKovaHydration } from "../e2e/hydration";

async function showBlocks(
  page: Page,
  theme: "dark" | "light",
  blocks: unknown[],
  holdHistory = false,
) {
  await coreFixture(page, theme, "plus");
  await page.addInitScript(
    ({ owner, chatA, content }) => {
      const key = `nova-gpt-conversations-v3:user:${owner}`;
      const chats = JSON.parse(localStorage.getItem(key)!);
      chats.find((chat: { id: string }) => chat.id === chatA).messages.at(-1).content = content;
      localStorage.setItem(key, JSON.stringify(chats));
    },
    {
      owner,
      chatA,
      content: blocks
        .map((block) => "```kova-interactive\n" + JSON.stringify(block) + "\n```")
        .join("\n\n"),
    },
  );
  if (holdHistory) {
    await page.addInitScript(() => {
      const manager = navigator.locks;
      const request = manager.request;
      const ready = new Promise<void>((resolve) =>
        window.addEventListener("kova-test-history-ready", () => resolve(), { once: true }),
      );
      manager.request = ((...args: unknown[]) => {
        if (String(args[0]).startsWith("kova-chat-history:")) {
          const callback = args.at(-1) as (lock: Lock | null) => unknown;
          args[args.length - 1] = async (lock: Lock | null) => {
            await ready;
            return callback(lock);
          };
        }
        return Reflect.apply(request, manager, args);
      }) as typeof manager.request;
    });
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await waitForKovaHydration(page);
  await expect(page.locator(".kova-interactive")).toHaveCount(blocks.length);
  await expect(page.locator(".kova-interactive form, .kova-interactive table")).toHaveCount(
    blocks.length,
  );
}

for (const theme of ["dark", "light"] as const) {
  test(`${theme}: interactive fields, long actions, and tables fit the viewport`, async ({
    page,
  }, info) => {
    const submitLabel = "Send all of these preferences for the next response";
    await showBlocks(page, theme, [
      {
        version: 1,
        type: "form",
        id: "preferences",
        title: "Your preferences",
        fields: [
          { id: "name", label: "Your name", kind: "text" },
          { id: "notes", label: "More details", kind: "textarea" },
          { id: "quantity", label: "Quantity", kind: "number", min: 0, max: 10 },
          { id: "start", label: "Start date", kind: "date" },
          {
            id: "style",
            label: "Style",
            kind: "radio",
            options: [
              {
                value: "a",
                label: "A long option label that should wrap naturally on a narrow phone",
              },
            ],
          },
          {
            id: "extras",
            label: "Extras",
            kind: "checkbox",
            options: [
              {
                value: "b",
                label: "Include the complete explanation and additional context in the result",
              },
            ],
          },
          {
            id: "format",
            label: "Format",
            kind: "select",
            options: [{ value: "c", label: "An option with additional detail" }],
          },
          { id: "amount", label: "Amount", kind: "slider", min: 0, max: 10, default: 5 },
          { id: "confirm", label: "Include reminders", kind: "toggle" },
        ],
        submitLabel,
        actions: [
          {
            id: "later",
            label: "Keep these preferences and continue with another detailed alternative",
            style: "secondary",
          },
        ],
      },
      {
        version: 1,
        type: "table",
        id: "comparison",
        title: "Compare the details",
        columns: Array.from({ length: 8 }, (_, i) => ({
          id: `c${i}`,
          label: `Comparison column ${i + 1}`,
        })),
        rows: [
          {
            id: "first",
            cells: Array.from({ length: 8 }, (_, i) => `Value ${i + 1} with additional detail`),
          },
        ],
        selection: "single",
        submitLabel,
      },
    ]);
    const form = page.getByRole("region", { name: "Your preferences", exact: true });
    await form.getByRole("textbox", { name: "Your name", exact: true }).fill("Demo user");
    await form.getByRole("textbox", { name: "More details", exact: true }).fill("A saved draft");
    await form.getByRole("spinbutton", { name: "Quantity", exact: true }).fill("3");
    await form.locator('input[type="date"]').fill("2026-11-05");
    const style = form.getByRole("radio");
    await style.check();
    await expect(style).toBeChecked();
    const extra = form.getByRole("checkbox");
    await extra.check();
    await expect(extra).toBeChecked();
    const format = form.getByRole("combobox", { name: "Format", exact: true });
    await format.click();
    const option = page.getByRole("option", {
      name: "An option with additional detail",
      exact: true,
    });
    try {
      await expect(option).toBeInViewport({ ratio: 0.99 });
    } catch (error) {
      const layout = await page.evaluate(() => {
        const selectors = [
          '[data-slot="select-trigger"]',
          "[data-radix-popper-content-wrapper]",
          '[data-slot="select-content"]',
          "[data-radix-select-viewport]",
          '[role="option"]',
          "[data-chat-transcript]",
          ".spec400-composer-dock",
        ].join(", ");
        return {
          viewport: { width: innerWidth, height: innerHeight },
          controls: Array.from(document.querySelectorAll(selectors)).map((node) => {
            const box = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            return {
              name: node.getAttribute("data-slot") || node.getAttribute("role") || node.tagName,
              x: box.x,
              y: box.y,
              width: box.width,
              height: box.height,
              maxHeight: style.maxHeight,
              minHeight: style.minHeight,
              overflow: style.overflowY,
              position: style.position,
              transform: style.transform,
              availableHeight: style.getPropertyValue("--radix-select-content-available-height"),
              scrollTop: node.scrollTop,
              parentScrollTop: node.parentElement?.scrollTop,
            };
          }),
        };
      });
      console.log("INTERACTIVE_SELECT_LAYOUT", JSON.stringify(layout));
      throw error;
    }
    await option.click();
    await expect(format).toContainText("An option with additional detail");
    const reminders = form.getByRole("switch", { name: "Include reminders", exact: true });
    await reminders.check();
    await expect(reminders).toBeChecked();
    await form.getByRole("slider", { name: "Amount", exact: true }).press("End");
    await expect(form.getByRole("slider", { name: "Amount", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "10",
    );
    const clipping = await page.locator(".kova-interactive").evaluateAll((sections) =>
      sections.flatMap((section) =>
        [...section.querySelectorAll("button, input, textarea")].flatMap((control) => {
          const box = control.getBoundingClientRect();
          if (!box.width || !box.height) return [];
          return box.left < -1 || box.right > document.documentElement.clientWidth + 1
            ? [control.getAttribute("aria-label") || control.textContent || control.tagName]
            : [];
        }),
      ),
    );
    expect(clipping).toEqual([]);
    const clippedActions = await page
      .locator(".kova-interactive button:not([role])")
      .evaluateAll((buttons) =>
        buttons.flatMap((button) => {
          const bounds = button.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(button);
          return [...range.getClientRects()].some(
            (text) =>
              text.left < bounds.left - 1 ||
              text.right > bounds.right + 1 ||
              text.top < bounds.top - 1 ||
              text.bottom > bounds.bottom + 1,
          )
            ? [button.textContent]
            : [];
        }),
      );
    expect(clippedActions).toEqual([]);
    const tableScroll = page
      .getByRole("region", { name: "Compare the details", exact: true })
      .last();
    expect(await tableScroll.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    await page.screenshot({ path: info.outputPath(`interactive-${theme}.png`) });
    const table = page.getByRole("region", { name: "Compare the details", exact: true }).first();
    const row = table.getByRole("radio", {
      name: "Select Value 1 with additional detail",
      exact: true,
    });
    await row.check();
    await expect(row).toBeChecked();
    const submissions: string[] = [];
    await page.route("**/api/chat", async (route) => {
      submissions.push(String(route.request().postDataJSON().messages.at(-1).content));
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"Your selection was received."}}]}\n\ndata: [DONE]\n\n',
      });
    });
    await table.getByRole("button", { name: submitLabel, exact: true }).click();
    await expect.poll(() => submissions).toHaveLength(1);
    expect(submissions[0]).toContain("Compare the details");
    expect(submissions[0]).toContain("Value 1 with additional detail");
    await expect(table).toHaveAttribute("data-interactive-state", "submitted");
    await expect(page.getByText("Your selection was received.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop generating", exact: true })).toHaveCount(0);
    await page.keyboard.press("Control+K");
    const search = page.getByRole("dialog", {
      name: "Search workspace, chats, and actions",
      exact: true,
    });
    await expect(search).toBeVisible();
    await search.getByRole("option", { name: "Focus message box", exact: true }).click();
    await expect(search).toBeHidden();
    await expect(page.getByRole("textbox", { name: "Message KovaGPT", exact: true })).toBeFocused();
  });
}

test("repeated form IDs keep labels, validation, and submission on the correct form", async ({
  page,
}) => {
  const make = (title: string) => ({
    version: 1,
    type: "form",
    id: "shared",
    title,
    fields: [{ id: "answer", label: "Your preference", kind: "text", required: true }],
    submitLabel: "Send preference",
  });
  await showBlocks(page, "dark", [make("First form"), make("Second form")]);
  await page.evaluate(() => {
    const events: unknown[] = [];
    Object.defineProperty(window, "__kovaInteractiveEvents", { value: events });
    for (const type of ["pointerdown", "pointerup", "click", "submit", "input", "focusin"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const section = target.closest<HTMLElement>(".kova-interactive");
          if (!section || events.length >= 100) return;
          events.push({
            type,
            tag: target.tagName,
            text: target.textContent?.trim().slice(0, 120),
            id: target.id,
            state: section.dataset.interactiveState,
            value: target instanceof HTMLInputElement ? target.value : undefined,
          });
        },
        true,
      );
    }
  });
  const ids = await page
    .locator(".kova-interactive [id]")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(new Set(ids).size).toBe(ids.length);
  const first = page.getByRole("region", { name: "First form", exact: true });
  const second = page.getByRole("region", { name: "Second form", exact: true });
  await first.getByRole("textbox", { name: "Your preference", exact: false }).fill("First answer");
  await second.getByRole("button", { name: "Send preference", exact: true }).click();
  const answer = second.getByRole("textbox", { name: "Your preference", exact: false });
  await expect(answer).toBeFocused();
  await expect(answer).toHaveAttribute("aria-invalid", "true");
  await answer.fill("Second answer");
  const messages: string[] = [];
  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON();
    messages.push(String(body.messages.at(-1).content));
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Your preference was received."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await second.getByRole("button", { name: "Send preference", exact: true }).click();
  try {
    await expect.poll(() => messages).toHaveLength(1);
  } catch (error) {
    const layout = await page.evaluate(() => ({
      events: Reflect.get(window, "__kovaInteractiveEvents") as unknown[],
      active: document.activeElement?.outerHTML.slice(0, 500),
      forms: Array.from(document.querySelectorAll<HTMLElement>(".kova-interactive")).map(
        (section) => ({
          state: section.dataset.interactiveState,
          text: section.innerText,
          inputs: Array.from(section.querySelectorAll("input")).map((input) => ({
            value: input.value,
            invalid: input.getAttribute("aria-invalid"),
            disabled: input.disabled,
          })),
        }),
      ),
      notices: Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(
        (node) => node.textContent,
      ),
      transcript: document.querySelector<HTMLElement>("[data-chat-transcript]")?.innerText,
    }));
    console.log("INTERACTIVE_SUBMISSION_LAYOUT", JSON.stringify(layout));
    throw error;
  }
  expect(messages[0]).toContain("Second form");
  expect(messages[0]).toContain("Second answer");
  expect(messages[0]).not.toContain("First answer");
  await expect(second).toHaveAttribute("data-interactive-state", "submitted");
});

test("forms wait for chat history before accepting a submission", async ({ page }) => {
  await showBlocks(
    page,
    "dark",
    [
      {
        version: 1,
        type: "form",
        id: "readiness",
        title: "A response that must wait",
        fields: [{ id: "answer", label: "Your answer", kind: "text", required: true }],
        submitLabel: "Send this answer",
      },
    ],
    true,
  );
  const form = page.getByRole("region", { name: "A response that must wait", exact: true });
  const answer = form.getByRole("textbox", { name: "Your answer", exact: false });
  const submit = form.getByRole("button", { name: "Send this answer", exact: true });
  await expect(answer).toBeDisabled();
  await expect(submit).toBeDisabled();
  await expect(form).toHaveAttribute("data-interactive-state", "readonly");
  await expect(form).toContainText("Chat history is not ready yet. Check the sync status.");
  await expect(form.getByRole("status")).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("kova-test-history-ready")));
  await expect(answer).toBeEnabled();
  await expect(submit).toBeEnabled();
  const messages: string[] = [];
  await page.route("**/api/chat", async (route) => {
    messages.push(String(route.request().postDataJSON().messages.at(-1).content));
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: 'data: {"choices":[{"delta":{"content":"Your answer was received."}}]}\n\ndata: [DONE]\n\n',
    });
  });
  await answer.fill("An answer sent after initialization");
  await submit.click();
  await expect.poll(() => messages).toHaveLength(1);
  expect(messages[0]).toContain("An answer sent after initialization");
  await expect(form).toHaveAttribute("data-interactive-state", "submitted");
});
