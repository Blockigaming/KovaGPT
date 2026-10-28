import { expect, test } from "@playwright/test";
import { coreFixture } from "./core-app-fixture";
import { functionNames } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

const resourceId = "77777777-7777-4777-8777-777777777777";
const secondResourceId = "88888888-8888-4888-8888-888888888888";
const secondResourceName = "Second saved review resource";
const common = {
  id: resourceId,
  name: "Saved review resource",
  created_at: "2026-10-01T10:00:00Z",
  updated_at: "2026-10-01T10:00:00Z",
};

for (const theme of ["light", "dark"] as const) {
  for (const scenario of [
    {
      path: "/context-packs",
      read: "listContextPacks",
      mutation: "deleteContextPack",
      title: "Delete context pack?",
      confirm: "Delete pack",
      heading: "Saved packs",
      status: "Deleting context pack…",
      editor: "Pack name",
      resource: { ...common, description: "Review context", items: [] },
    },
    {
      path: "/prompt-studio",
      read: "listPromptTemplates",
      mutation: "deletePromptTemplate",
      title: "Delete prompt?",
      confirm: "Delete prompt",
      heading: "Saved prompts",
      status: "Deleting prompt…",
      editor: "Prompt name",
      resource: {
        ...common,
        body: "A saved review prompt.",
        category: "General",
        folder: "Unfiled",
        favorite: false,
        variables: [],
        use_count: 0,
        last_used_at: null,
      },
    },
  ]) {
    for (const preserveEditorFocus of [false, true]) {
      test(`${scenario.path}: shared deletion dialog cancels and confirms safely in ${theme}${preserveEditorFocus ? " while preserving editor focus" : ""}`, async ({
        page,
      }, info) => {
        await coreFixture(page, theme);
        const mutations: unknown[] = [];
        let finishDeletion: (() => void) | undefined;
        const deletionPending = new Promise<void>((resolve) => {
          finishDeletion = resolve;
        });
        await page.route("**/_serverFn/**", async (route) => {
          const id = new URL(route.request().url()).pathname.split("/").at(-1)!;
          const name = (functionNames.get(id) ?? "").split("_")[0];
          if (name === scenario.read)
            return route.fulfill({
              json: {
                result: [
                  scenario.resource,
                  { ...scenario.resource, id: secondResourceId, name: secondResourceName },
                ],
                context: {},
              },
            });
          if (name === scenario.mutation) {
            mutations.push(route.request().postDataJSON());
            await deletionPending;
            return route.fulfill({ json: { result: { ok: true }, context: {} } });
          }
          return route.fallback();
        });
        await page.goto(scenario.path);
        await waitForKovaHydration(page);
        const trigger = page.getByRole("button", { name: `Delete ${common.name}`, exact: true });
        await expect(trigger).toBeVisible();
        await trigger.click();
        const dialog = page.getByRole("alertdialog", { name: scenario.title, exact: true });
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText(common.name);
        await expect(dialog).toContainText("This cannot be undone.");
        const bounds = await dialog.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            top: box.top,
            bottom: box.bottom,
            width: innerWidth,
            height: innerHeight,
            radius: parseFloat(getComputedStyle(element).borderTopLeftRadius),
          };
        });
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(bounds.width + 1);
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
        expect(bounds.radius).toBeGreaterThan(0);
        await page.screenshot({
          path: info.outputPath(`delete-${scenario.read}-${theme}.png`),
          animations: "disabled",
        });
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(mutations).toEqual([]);
        await trigger.click();
        await expect(dialog).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
        expect(mutations).toEqual([]);
        await trigger.click();
        await dialog.getByRole("button", { name: scenario.confirm, exact: true }).click();
        const secondTrigger = page.getByRole("button", {
          name: `Delete ${secondResourceName}`,
          exact: true,
        });
        await expect(trigger).toBeDisabled();
        await expect(secondTrigger).toBeDisabled();
        const pendingStatus = page.getByRole("status").filter({ hasText: scenario.status });
        await expect(pendingStatus).toHaveText(scenario.status);
        await expect.poll(() => mutations.length).toBe(1);
        expect(JSON.stringify(mutations[0])).toContain(resourceId);
        await expect(dialog).toBeHidden();
        const editor = page.getByRole("textbox", { name: scenario.editor, exact: true });
        if (preserveEditorFocus) {
          await editor.fill("An in-progress draft");
          await expect(editor).toBeFocused();
        }
        finishDeletion!();
        await expect(trigger).toHaveCount(0);
        await expect(secondTrigger).toBeEnabled();
        if (preserveEditorFocus) {
          await expect(editor).toBeFocused();
          await expect(editor).toHaveValue("An in-progress draft");
        } else {
          await expect(
            page.getByRole("heading", { name: scenario.heading, exact: true }),
          ).toBeFocused();
        }
        await expect(pendingStatus).toHaveCount(0);
        expect(mutations).toHaveLength(1);
        expect(JSON.stringify(mutations[0])).toContain(resourceId);
      });
    }
  }
}
