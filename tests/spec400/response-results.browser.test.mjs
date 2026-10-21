import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";
import {
  normalizeTaskCreatedReceipt,
  taskCreatedReceiptFromResult,
  taskCreationNotice,
} from "../../src/lib/task-created-receipt.mjs";
import { resultRevisionDiff, applyReviewedDiff } from "../../src/lib/result-revision-diff.mjs";

const id = "0ad66d37-b5ee-40bd-8e5c-069de38ada89";
let browser, server, origin, dir;
const long = `${"This is the complete reusable explanation with deliberate wording. ".repeat(14)}\n\nA second paragraph stays in the same box.`;
const code = `def run():\n\treturn "${"long-code-".repeat(80)}"\n`;
before(async () => {
  dir = await mkdtemp(join(tmpdir(), "kova-spec400-response-"));
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { ResponseMarkdown } from './src/components/ResponseMarkdown'; import { TaskCreatedBubble } from './src/components/TaskCreatedBubble'; import './src/components/response-action-refinement.css'; window.setContent=(text)=>createRoot(document.getElementById('root')).render(<div className='prose-chat'><ResponseMarkdown>{text}</ResponseMarkdown></div>); createRoot(document.getElementById('receipt')).render(<TaskCreatedBubble activity={{tool:'scheduled_task',status:'done',taskReceipt:{operation:'created',source:'persisted-result',taskId:'${id}'}}}/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    outfile: join(dir, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  await writeFile(
    join(dir, "index.html"),
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>:root{--border:#aaa;--foreground:#172126;--background:#fff;--surface-secondary:#f5f7f8;--muted-foreground:#4f5e69;--accent:#dfe7ec;--ring:#005f8f}*{box-sizing:border-box}body{font-family:Arial;margin:0;padding:16px}#root{max-width:760px;margin:auto}button{font:inherit;cursor:pointer;background:none;border:0}p{font-size:16px;line-height:26px}pre{font-family:monospace}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}#receipt{margin-bottom:16px}</style></head><body><p>Example fixture for component testing</p><div id="receipt"></div><div id="root"></div><script src="/fixture.js"></script></body></html>`,
  );
  server = createServer(async (request, response) => {
    try {
      const path =
        request.url === "/fixture.js"
          ? "fixture.js"
          : request.url === "/fixture.css"
            ? "fixture.css"
            : "index.html";
      response.setHeader(
        "Content-Type",
        path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : "text/html",
      );
      response.end(await readFile(join(dir, path)));
    } catch {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.KOVA_TEST_CHROMIUM_PATH
      ? { executablePath: process.env.KOVA_TEST_CHROMIUM_PATH }
      : {}),
  });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
  if (dir) await rm(dir, { recursive: true, force: true });
});
async function pageFor(text, width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
  await page.goto(origin);
  await page.evaluate((content) => {
    window.copiedContent = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value) => {
          window.copiedContent.push(value);
        },
      },
    });
    window.setContent(content);
  }, text);
  return page;
}

test("200–207,397: desktop box copies the exact deliverable and shows Copied for two seconds", async () => {
  const page = await pageFor(long);
  const box = page.locator(".kova-response-output");
  await box.waitFor();
  assert.equal(await box.count(), 1);
  const header = await box.locator("header").boundingBox();
  const copy = box.getByRole("button", { name: "Copy text", exact: true });
  const position = await copy.boundingBox();
  assert.equal(header.height, 44);
  assert.equal(position.height, 44);
  assert.ok(position.x > header.x);
  assert.equal(position.y, header.y);
  await copy.click();
  assert.deepEqual(await page.evaluate(() => window.copiedContent), [long]);
  await box.getByRole("button", { name: "Copied", exact: true }).waitFor();
  await page.waitForTimeout(2100);
  assert.equal(await copy.count(), 1);
  assert.equal(
    await page
      .getByRole("link", { name: "Scheduled task created. Open schedule details" })
      .getAttribute("href"),
    `/scheduled-tasks?taskId=${id}`,
  );
  await page.close();
});
test("201: threshold is strictly over 800 and paragraphs share one section", async () => {
  let page = await pageFor("a".repeat(800));
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".kova-response-output").count(), 0);
  await page.close();
  page = await pageFor("a".repeat(801));
  await page.locator(".kova-response-output").waitFor();
  assert.equal(await page.locator(".kova-response-output").count(), 1);
  await page.close();
});
test("205,207,397: mobile full-width footer and clipboard failure keep selectable text", async () => {
  const page = await pageFor(`> First paragraph.\n>\n> Second paragraph.`, 390);
  const box = page.locator(".kova-response-output");
  await box.waitFor();
  const copy = box.getByRole("button", { name: "Copy text", exact: true });
  const buttonBounds = await copy.boundingBox(),
    contentBounds = await box.locator(".kova-response-output-content").boundingBox(),
    boxBounds = await box.boundingBox();
  assert.ok(buttonBounds.y >= contentBounds.y + contentBounds.height);
  assert.ok(Math.abs(buttonBounds.width - (boxBounds.width - 2)) <= 1);
  assert.equal(buttonBounds.height, 44);
  assert.equal(await copy.innerText(), "Copy text");
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => {
      throw new Error("Denied");
    };
  });
  await copy.click();
  await box.getByRole("alert").waitFor();
  assert.match(await box.getByRole("alert").innerText(), /Couldn’t copy/);
  await box.getByRole("button", { name: "Select content" }).click();
  assert.match(await page.evaluate(() => window.getSelection().toString()), /First paragraph/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
});
test("202,227,397: code preserves whitespace, safe filename, and horizontal overflow at 320px", async () => {
  const page = await pageFor('```python filename="../../analysis.py"\n' + code + "```", 320);
  const box = page.locator(".kova-response-output[data-output-kind=code]");
  await box.waitFor();
  const pre = box.locator("pre");
  assert.equal(await pre.innerText(), code.replace(/\n$/, ""));
  assert.equal(await pre.evaluate((element) => element.scrollWidth > element.clientWidth), true);
  await box.getByRole("button", { name: "Copy code", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.copiedContent), [code.replace(/\n$/, "")]);
  const download = page.waitForEvent("download");
  await box.getByRole("button", { name: "Download file" }).click();
  assert.equal((await download).suggestedFilename(), "analysis.py");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.close();
});
test("199,233: semantic tables and safe markdown never execute embedded HTML", async () => {
  const page = await pageFor(
    "| Name | Value |\n|---|---|\n| First | 10 |\n\n<script>window.unsafe=true</script>\n\n[Unsafe](javascript:alert(1))\n\n```email\nSubject: Update\n\nHello, team.\n```",
  );
  await page.locator("table").waitFor();
  assert.equal(await page.locator("table th").count(), 2);
  assert.equal(await page.getByRole("region", { name: "Scrollable comparison table" }).count(), 1);
  assert.equal(await page.evaluate(() => window.unsafe), undefined);
  assert.notEqual(
    await page.getByRole("link", { name: /Unsafe/ }).getAttribute("href"),
    "javascript:alert(1)",
  );
  assert.equal(await page.locator(".kova-response-output[data-output-kind=text]").count(), 1);
  await page.close();
});
