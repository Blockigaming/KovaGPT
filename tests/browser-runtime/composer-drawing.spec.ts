import { test, expect } from "@playwright/test";
import { build } from "esbuild";

// Actual component and browser canvas; the callback models real refusal/failure/acceptance.
const result = await build({
  stdin: {
    contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ComposerDrawingDialog} from './src/components/ComposerDrawingDialog';
      window.drawingOutcome = false; window.drawingNames = [];
      function Harness() {
        const [open,setOpen] = useState(true);
        return <><button onClick={()=>setOpen(true)}>Open drawing</button>
          <ComposerDrawingDialog open={open} onOpenChange={setOpen} onReturnFocus={()=>{}}
            onAttach={async files=>{window.drawingNames.push(files[0].name);if(window.drawingOutcome==='reject')throw new Error('Image could not be read. Try again.');return window.drawingOutcome;}}/></>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);
    `,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
});

test("drawing survives refused and failed attachment, closing only after acceptance", async ({
  page,
}) => {
  await page.route("https://kova-drawing.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><style>[role=dialog]{position:fixed;inset:20px;max-width:600px;overflow:auto;background:white;padding:20px}canvas{width:480px;height:320px}</style><div id="root"></div>',
    }),
  );
  await page.goto("https://kova-drawing.test/");
  await page.addScriptTag({ content: result.outputFiles[0].text });
  const dialog = page.getByRole("dialog", { name: "Drawings", exact: true }),
    canvas = page.locator('canvas[aria-label="Drawing canvas"]');
  await expect(dialog).toBeVisible();
  const bounds = await canvas.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + 30, bounds!.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 120, bounds!.y + 100, { steps: 5 });
  await page.mouse.up();
  const sketch = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await dialog.getByRole("button", { name: "Attach drawing", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Your sketch is still here");
  await expect(dialog).toBeVisible();
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(
    sketch,
  );
  await page.evaluate(() => {
    (window as unknown as { drawingOutcome: unknown }).drawingOutcome = "reject";
  });
  await dialog.getByRole("button", { name: "Attach drawing", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Image could not be read");
  expect(await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).toBe(
    sketch,
  );
  await page.evaluate(() => {
    (window as unknown as { drawingOutcome: unknown }).drawingOutcome = true;
  });
  await dialog.getByRole("button", { name: "Attach drawing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const previous = await page.evaluate(
    () => (window as unknown as { drawingNames: string[] }).drawingNames[0],
  );
  expect(
    await page.evaluate(
      () => new Set((window as unknown as { drawingNames: string[] }).drawingNames).size,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "Open drawing", exact: true }).click();
  await dialog.getByRole("button", { name: "Attach drawing", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(
    await page.evaluate(() =>
      (window as unknown as { drawingNames: string[] }).drawingNames.at(-1),
    ),
  ).not.toBe(previous);
});
