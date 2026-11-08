import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { png } from "../helpers/image-fixture.mjs";
import { fixture, owner, chatA } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

declare global {
  interface Window {
    imageMenuShares: { type: string; size: number }[];
    imageMenuCopies: { type: string; signature: number[]; width: number; height: number }[];
  }
}

for (const role of ["user", "assistant"] as const) {
  test(`${role} image has the requested device-specific context actions`, async ({
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
        window.imageMenuShares = [];
        Object.defineProperty(navigator, "canShare", {
          configurable: true,
          value: ({ files }: ShareData) => files?.length === 1,
        });
        Object.defineProperty(navigator, "share", {
          configurable: true,
          value: async ({ files }: ShareData) => {
            window.imageMenuShares.push({ type: files![0].type, size: files![0].size });
          },
        });
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
    // Native touch coordinates must target the decoded image, whose intrinsic
    // dimensions can differ from the loading placeholder.
    await image.evaluate((node) => (node as HTMLImageElement).decode());
    await expect
      .poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth))
      .toBe(120);
    const original = await image.getAttribute("src");
    const expectedBytes = Buffer.from(original!.split(",", 2)[1], "base64");
    await image.click();
    const viewer = page.getByRole("dialog", { name: "Image preview", exact: true });
    await expect(viewer).toBeVisible();
    await expect(viewer.getByRole("img")).toHaveAttribute("src", original!);
    await viewer.getByRole("button", { name: "Share image", exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.imageMenuShares.length)).toBe(1);
    expect(await page.evaluate(() => window.imageMenuShares[0])).toEqual({
      type: original!.slice(5, original!.indexOf(";")),
      size: expectedBytes.length,
    });
    if (page.viewportSize()!.width < 1024) {
      const canvas = (await viewer.locator("[data-image-viewer-canvas]").boundingBox())!;
      const x = canvas.x + canvas.width / 2,
        y = canvas.y + canvas.height / 2;
      const touch = await page.context().newCDPSession(page);
      try {
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { x: x - 30, y },
            { x: x + 30, y },
          ],
        });
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: x - 60, y },
            { x: x + 60, y },
          ],
        });
        await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await expect(viewer.getByRole("button", { name: "Reset image zoom" })).not.toHaveText(
          "100%",
        );
        await viewer.getByRole("button", { name: "Reset image zoom" }).click();
      } finally {
        await touch.detach();
      }
    }
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect(viewer.getByRole("button", { name: "Reset image zoom" })).toHaveText("150%");
    await viewer.getByRole("button", { name: "Reset image zoom" }).click();
    await expect(viewer.getByRole("button", { name: "Zoom out", exact: true })).toBeDisabled();
    const viewerBounds = (await viewer.boundingBox())!;
    expect(viewerBounds.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    expect(viewerBounds.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
    await page.screenshot({
      path: info.outputPath(`${role}-image-viewer.png`),
      animations: "disabled",
    });
    await viewer.getByRole("button", { name: "Close image preview" }).click();
    await expect(viewer).toBeHidden();
    await expect(image).toBeFocused();
    const menu = page.getByRole("menu", { name: "Image actions", exact: true });
    const open = async () => {
      await image.scrollIntoViewIfNeeded();
      if (page.viewportSize()!.width < 1024) {
        const box = (await image.boundingBox())!;
        const touch = await page.context().newCDPSession(page);
        await touch.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
        });
        try {
          await expect(menu).toBeVisible();
        } finally {
          await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await touch.detach();
        }
      } else await image.click({ button: "right" });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem")).toHaveText(
        page.viewportSize()!.width < 1024
          ? ["Copy"]
          : ["Open image in new tab", "Add to chat", "Copy image", "Download a copy"],
      );
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
    if (page.viewportSize()!.width < 1024) {
      await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
      await expect.poll(() => page.evaluate(() => window.imageMenuCopies.length)).toBe(1);
      expect(await page.evaluate(() => window.imageMenuCopies[0])).toEqual({
        type: "image/png",
        signature: [137, 80, 78, 71, 13, 10, 26, 10],
        width: 120,
        height: 80,
      });
      expect(sends).toBe(0);
      return;
    }
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

    await expect(image).toHaveAttribute("src", original!);
    expect(sends).toBe(0);
  });
}
