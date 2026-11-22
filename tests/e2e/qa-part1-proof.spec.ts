import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fixture } from "./actual-app-fixture";
import { waitForKovaHydration } from "./hydration";

const matrix: Record<string, [number, number][]> = {
  "chrome-phone": [[360,740],[360,788],[360,740],[740,360],[360,740]],
  "chrome-foldable": [[360,820],[768,880],[576,880],[884,768],[360,820]],
  "webkit-phone": [[390,844],[390,892],[390,844],[844,390],[390,844]],
  "webkit-tablet": [[834,1194],[507,1194],[320,1194],[1194,834],[834,1194]],
};

test("keeps the draft and Send inside the render as the viewport and text size change", async ({page}, info) => {
  const [initial, ...sizes] = matrix[info.project.name];
  const resize = (width: number, height: number) => page.setViewportSize({width,height});
  await resize(...initial);
  await fixture(page, "dark", true, false, "free", {preserveStorageOnReload: true});
  await page.goto("/", {waitUntil:"domcontentloaded"});
  await waitForKovaHydration(page);
  const input = page.getByRole("textbox",{name:"Message KovaGPT"});
  const send = page.getByRole("button",{name:"Send message"});
  const shell = page.locator('.kova-assistant[data-ui="modern"]');
  const draft = "مرحبا بالعالم · שלום · 日本語 · 👩🏽‍💻";
  await input.fill(draft);
  await input.blur();
  for (const [width,height] of [initial,...sizes]) {
    await resize(width,height);
    await expect.poll(async () => Math.round((await shell.boundingBox())?.height ?? 0)).toBe(height);
    await expect(input).toHaveValue(draft);
    await expect(send).toBeInViewport({ratio:1});
    const viewport = await page.locator("html").evaluate(node => ({content:node.scrollWidth,width:node.clientWidth}));
    assert.equal(viewport.content,viewport.width,"Page should not overflow horizontally");
  }
  await resize(320,568);
  for (const size of [16,24,32]) {
    await page.locator("html").evaluate((node,n) => node.style.setProperty("--kova-native-font-size",n+"px"),size);
    await expect(input).toHaveCSS("font-size",size+"px");
    await expect(input).toHaveValue(draft);
    await expect(send).toBeInViewport({ratio:1});
  }
  await page.reload({waitUntil:"domcontentloaded"});
  await waitForKovaHydration(page);
  await expect(input).toHaveValue(draft);
  await expect(page.getByText("Chat history could not be saved on this device.",{exact:false})).toHaveCount(0);
  console.log(info.project.name, "passed five viewport states, three font sizes, and multilingual draft reload");
});

test("actual history storage module writes and reloads an IndexedDB record", async ({page,browserName}) => {
  test.skip(browserName !== "webkit");
  const contents = readFileSync("src/lib/chat-history-idb.mjs","utf8");
  await fixture(page,"dark",true);
  await page.route("**/__device_qa/history_idb.mjs",route => route.fulfill({body:contents,contentType:"text/javascript"}));
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await waitForKovaHydration(page);
  const saved = await page.evaluate(async () => {
    const url = "/__device_qa/history_idb.mjs";
    const storage = await import(/* @vite-ignore */ url);
    const ownerId = "99999999-9999-4999-8999-999999999999";
    const record = {sample:"سلام · 日本語 · 👩🏽‍💻"};
    const previous = null;
    const next = {ownerId,localEpoch:crypto.randomUUID(),version:1,cursor:0,records:{chat:record}};
    await storage.commitChatHistoryDevice(previous,next);
    return await storage.loadChatHistoryDevice(ownerId);
  });
  assert.equal(saved.records.chat.sample,"سلام · 日本語 · 👩🏽‍💻");
  assert.equal(saved.cursor,0);
});
