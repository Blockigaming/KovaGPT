import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { png } from "../helpers/image-fixture.mjs";
import { fixture, owner, chatA } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

declare global {
  interface Window {
    imageMenuCopies: { type: string; signature: number[]; width: number; height: number }[];
  }
}

for (const role of ["user", "assistant"] as const) {
  test(`${role} image has five working context actions and reversible visibility`, async ({
    page,
  }, info) => {
    await fixture(page, "dark", true, true, "free", { preserveStorageOnReload: true });
    await page.addInitScript(
      ({ owner, chatA, image, role }) => {
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 80;
        canvas.getContext("2d")!.fillRect(0, 0, 120, 80);
        const assistantImage = canvas.toDataURL("image/jpeg", 0.9);
        const key = `nova-gpt-conversations-v3:user:${owner}`;
        const chats = JSON.parse(localStorage.getItem(key)!);
        chats.find((chat: { id: string }) => chat.id === chatA).messages = [
          {
            id: "image-user",
            role: "user",
            content: "Keep my uploaded image.",
            attachments: [{ kind: "image", dataUrl: image }],
          },
          {
            id: "image-assistant",
            role: "assistant",
            content: `Here is your image.\n\n![Kova image](${assistantImage})`,
          },
        ];
        localStorage.setItem(key, JSON.stringify(chats));
        window.imageMenuCopies = [];
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            async write(items: ClipboardItem[]) {
              for (const item of items) {
                const blob = await item.getType("image/png");
                const decoded = await createImageBitmap(blob);
                window.imageMenuCopies.push({
                  type: blob.type,
                  signature: [...new Uint8Array(await blob.arrayBuffer()).slice(0, 8)],
                  width: decoded.width,
                  height: decoded.height,
                });
                decoded.close();
              }
            },
          },
        });
        // This fixture never sends a model request or touches an actual user's clipboard.
        void role;
      },
      {
        owner,
        chatA,
        image: `data:image/png;base64,${png(120, 80, false).toString("base64")}`,
        role,
      },
    );
    let sends = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/chat" && request.method() === "POST") sends++;
    });
    await page.goto("/");
    await waitForKovaHydration(page);
    const message = page.locator(`[data-message-id="image-${role}"]`);
    const image = message.locator("[data-chat-image] > img");
    await expect(image).toBeVisible();
    const original = await image.getAttribute("src");
    const expectedBytes = Buffer.from(original!.split(",", 2)[1], "base64");
    const menu = page.getByRole("menu", { name: "Image actions", exact: true });
    const open = async () => {
      await image.scrollIntoViewIfNeeded();
      await image.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveText([
        "Download a copy",
        "Open image in new tab",
        "Copy image",
        "Add to chat",
        "Hide from chat",
      ]);
      const box = (await menu.boundingBox())!;
      const viewport = page.viewportSize()!;
      // Assert the first visible frame, while the opening animation is active.
      // Transitioning Radix's available width briefly clips narrow phone menus.
      expect(await menu.evaluate((node) => getComputedStyle(node).transitionProperty)).toBe("none");
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    };
    await open();
    await page.screenshot({
      path: info.outputPath(`${role}-image-actions.png`),
      animations: "disabled",
    });
    const downloaded = page.waitForEvent("download");
    await menu.getByRole("menuitem", { name: "Download a copy", exact: true }).click();
    const download = await downloaded;
    expect(await readFile((await download.path())!)).toEqual(expectedBytes);

    await open();
    const opened = page.context().waitForEvent("page");
    await menu.getByRole("menuitem", { name: "Open image in new tab", exact: true }).click();
    const tab = await opened;
    await expect
      .poll(() => tab.locator("img").evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(120);
    expect(tab.url()).toMatch(/^blob:/);
    expect(await tab.evaluate(() => window.opener === null)).toBe(true);
    await tab.close();

    await open();
    await menu.getByRole("menuitem", { name: "Copy image", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => window.imageMenuCopies))
      .toEqual([
        { type: "image/png", signature: [137, 80, 78, 71, 13, 10, 26, 10], width: 120, height: 80 },
      ]);
    const input = page.getByRole("textbox", { name: "Message KovaGPT", exact: true });
    await input.fill("Keep this draft exactly.");
    await open();
    await menu.getByRole("menuitem", { name: "Add to chat", exact: true }).click();
    await expect(
      page
        .getByRole("list", { name: "Attachments", exact: true })
        .locator('[data-status="complete"]'),
    ).toHaveCount(1);
    await expect(input).toHaveValue("Keep this draft exactly.");
    expect(sends).toBe(0);

    await open();
    await menu.getByRole("menuitem", { name: "Hide from chat", exact: true }).click();
    const show = message.getByRole("button", { name: "Show image", exact: true });
    await expect(show).toBeVisible();
    await expect(image).toHaveCount(0);
    await expect(input).toHaveValue("Keep this draft exactly.");
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
      .toBe("auto");
    await page.reload();
    await waitForKovaHydration(page);
    await expect(show).toBeVisible();
    await show.click();
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", original!);
    expect(sends).toBe(0);
  });
}
