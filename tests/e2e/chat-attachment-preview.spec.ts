import { expect, test } from "@playwright/test";
import { png } from "../helpers/image-fixture.mjs";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

test("chat attachments open in the workspace preview without downloading", async ({ page }) => {
  await fixture(page, "dark", true, true, "free", {
    preserveStorageOnReload: true,
    savedMessages: [
      {
        id: "preview-attachments",
        role: "user",
        content: "Preview my attachments.",
        attachments: [
          {
            kind: "image",
            dataUrl: `data:image/png;base64,${png(120, 80, false).toString("base64")}`,
          },
          { kind: "text_file", name: "review.txt", content: "Chemical bonding study notes." },
        ],
      },
    ],
  });
  await page.goto("/");
  await waitForKovaHydration(page);
  const message = page.locator('[data-message-id="preview-attachments"]');
  const openText = message.getByRole("button", { name: "review.txt", exact: true });
  const openImage = message.locator("[data-chat-image] > img");
  const wide = page.viewportSize()!.width >= 1024;

  const checkGeometry = async (name: string, docked = wide) => {
    const preview = page.getByRole("dialog", { name, exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-attachment-preview", docked ? "docked" : "full");
    if (docked) {
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
  await expect(
    textPreview.getByText("Chemical bonding study notes.").filter({ visible: true }),
  ).toBeVisible();
  if (!wide) {
    await expect(textPreview.getByRole("textbox", { name: "Ask KovaGPT" })).toBeVisible();
    await textPreview.getByLabel("More options").click();
  }
  await expect(textPreview.getByRole("button", { name: "Copy text" })).toBeVisible();
  await expect(textPreview.getByRole("button", { name: "Download text" })).toBeVisible();
  if (wide) {
    const divider = page.getByRole("separator", {
      name: "Resize conversation and attachment preview",
    });
    const handle = (await divider.boundingBox())!;
    const previousWidth = (await textPreview.boundingBox())!.width;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100);
    await page.mouse.down();
    await page.mouse.move(handle.x + 100, handle.y + 100, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => (await textPreview.boundingBox())!.width)
      .toBeLessThan(previousWidth);
    await expect(page.locator("main[data-sidebar]")).toHaveAttribute("data-sidebar", "open");
  }
  await page.keyboard.press("Escape");
  await expect(textPreview).toBeHidden();
  await expect(openText).toBeFocused();

  await openImage.click();
  const imagePreview = await checkGeometry("Image preview", false);
  await expect(imagePreview.getByRole("img")).toBeVisible();
  await expect(imagePreview.getByRole("button", { name: "Download image" })).toBeVisible();
  if (wide) {
    await expect(imagePreview.getByText("Image", { exact: true })).toBeVisible();
    await imagePreview.getByRole("button", { name: "Open in side panel" }).click();
    await expect(imagePreview).toHaveAttribute("data-attachment-preview", "docked");
  }
  await imagePreview
    .getByRole("button", { name: wide ? "Close image preview" : "Close preview" })
    .click();
  await expect(imagePreview).toBeHidden();
});
