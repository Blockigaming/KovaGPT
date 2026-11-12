import { expect, test } from "@playwright/test";
import { png } from "../helpers/image-fixture.mjs";
import { fixture, owner, chatA } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("chat attachments open in the workspace preview without downloading", async ({ page }) => {
  await fixture(page, "dark", true, true, "free", { preserveStorageOnReload: true });
  await page.addInitScript(
    ({ owner, chatA, image }) => {
      const key = `nova-gpt-conversations-v3:user:${owner}`;
      const chats = JSON.parse(localStorage.getItem(key)!);
      chats.find((chat: { id: string }) => chat.id === chatA).messages = [
        {
          id: "preview-attachments",
          role: "user",
          content: "Preview my attachments.",
          attachments: [
            { kind: "image", dataUrl: image },
            { kind: "text_file", name: "review.txt", content: "Chemical bonding study notes." },
          ],
        },
      ];
      localStorage.setItem(key, JSON.stringify(chats));
    },
    { owner, chatA, image: `data:image/png;base64,${png(120, 80, false).toString("base64")}` },
  );
  await page.goto("/");
  await waitForKovaHydration(page);
  const message = page.locator('[data-message-id="preview-attachments"]');
  const openText = message.getByRole("button", { name: "review.txt", exact: true });
  const openImage = message.locator("[data-chat-image] > img");
  const wide = page.viewportSize()!.width >= 1024;

  const checkGeometry = async (name: string) => {
    const preview = page.getByRole("dialog", { name, exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-attachment-preview", wide ? "docked" : "full");
    if (wide) {
      const chat = await page.locator("#conversation-pane").boundingBox();
      const dock = await preview.boundingBox();
      expect(chat!.x + chat!.width).toBeLessThanOrEqual(dock!.x);
    } else {
      const viewport = page.viewportSize()!;
      await expect
        .poll(async () => {
          const box = await preview.boundingBox();
          return (
            box && [
              Math.round(box.x),
              Math.round(box.y),
              Math.round(box.width),
              Math.round(box.height),
            ]
          );
        })
        .toEqual([0, 0, viewport.width, viewport.height]);
    }
    return preview;
  };

  await openText.click();
  const textPreview = await checkGeometry("review.txt");
  await expect(textPreview.getByText("Chemical bonding study notes.")).toBeVisible();
  if (!wide) {
    await expect(textPreview.getByRole("textbox", { name: "Ask KovaGPT" })).toBeVisible();
    await textPreview.getByLabel("More options").click();
  }
  await expect(textPreview.getByRole("button", { name: "Copy text" })).toBeVisible();
  await expect(textPreview.getByRole("button", { name: "Download text" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(textPreview).toBeHidden();
  await expect(openText).toBeFocused();

  await openImage.click();
  const imagePreview = await checkGeometry("Image preview");
  await expect(imagePreview.getByRole("img")).toBeVisible();
  await expect(imagePreview.getByRole("button", { name: "Download image" })).toBeVisible();
  await imagePreview
    .getByRole("button", { name: wide ? "Close image preview" : "Close preview" })
    .click();
  await expect(imagePreview).toBeHidden();
});
