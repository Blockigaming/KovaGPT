import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
type TestState = {
  version: number;
  ownerId: string;
  localEpoch: string;
  epoch: null;
  cursor: number;
  complete: boolean;
  cleared?: boolean;
  records: Record<
    string,
    { id: string; local: { messages?: { content: string }[]; content?: string } }
  >;
};
type HistoryTestGlobals = {
  chatHistoryDevice: {
    commitChatHistoryDevice(previous: TestState | null, next: TestState): Promise<void>;
    loadChatHistoryDevice(ownerId: string): Promise<TestState>;
    clearChatHistoryDevice(ownerId: string): Promise<void>;
  };
  oldChatState: TestState;
  lockAcquired: boolean;
};
const origin = "https://chat-history.test";
const source =
  (await readFile("src/lib/chat-history-idb.mjs", "utf8")).replace(/^export /gmu, "") +
  "\nglobalThis.chatHistoryDevice={loadChatHistoryDevice,commitChatHistoryDevice,clearChatHistoryDevice};";
async function open(page: Page) {
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Private chat storage test</title>",
    }),
  );
  await page.goto(origin);
  await page.addScriptTag({ content: source });
}
test("actual IndexedDB survives reload and isolates owner bodies", async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const api = (globalThis as unknown as HistoryTestGlobals).chatHistoryDevice;
    for (const owner of ["A", "B"])
      await api.commitChatHistoryDevice(null, {
        version: 1,
        ownerId: owner,
        localEpoch: crypto.randomUUID(),
        epoch: null,
        cursor: 0,
        complete: false,
        records: { chat: { id: "chat", local: { messages: [{ content: `private-${owner}` }] } } },
      });
  });
  await page.reload();
  await page.addScriptTag({ content: source });
  const owners = await page.evaluate(async () => {
    const api = (globalThis as unknown as HistoryTestGlobals).chatHistoryDevice;
    return [
      (await api.loadChatHistoryDevice("A")).records.chat.local.messages![0].content,
      (await api.loadChatHistoryDevice("B")).records.chat.local.messages![0].content,
    ];
  });
  expect(owners).toEqual(["private-A", "private-B"]);
});
test("a different tab reset fences delayed old writes and preserves the other account", async ({
  page,
  context,
}) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  await page.evaluate(async () => {
    const api = (globalThis as unknown as HistoryTestGlobals).chatHistoryDevice;
    const state = {
      version: 1,
      ownerId: "A",
      localEpoch: crypto.randomUUID(),
      epoch: null,
      cursor: 0,
      complete: false,
      records: { chat: { id: "chat", local: { content: "private" } } },
    };
    await api.commitChatHistoryDevice(null, state);
    (globalThis as unknown as HistoryTestGlobals).oldChatState = state;
    await api.commitChatHistoryDevice(null, {
      ...state,
      ownerId: "B",
      localEpoch: crypto.randomUUID(),
    });
  });
  await other.evaluate(async () =>
    (globalThis as unknown as HistoryTestGlobals).chatHistoryDevice.clearChatHistoryDevice("A"),
  );
  const result = await page.evaluate(async () => {
    const api = (globalThis as unknown as HistoryTestGlobals).chatHistoryDevice,
      old = (globalThis as unknown as HistoryTestGlobals).oldChatState;
    let rejected = false;
    try {
      await api.commitChatHistoryDevice(old, { ...old, cursor: 1 });
    } catch {
      rejected = true;
    }
    return {
      rejected,
      a: await api.loadChatHistoryDevice("A"),
      b: await api.loadChatHistoryDevice("B"),
    };
  });
  expect(result.rejected).toBe(true);
  expect(result.a.records).toEqual({});
  expect(result.a.cleared).toBe(true);
  expect(result.b.records.chat.local.content).toBe("private");
});
test("Web Locks admit one editor per account and release when its tab closes", async ({
  page,
  context,
}) => {
  await open(page);
  const other = await context.newPage();
  await open(other);
  await page.evaluate(() => {
    (globalThis as unknown as HistoryTestGlobals).lockAcquired = false;
    void navigator.locks.request("kova-chat-history:A", { ifAvailable: true }, async (lock) => {
      (globalThis as unknown as HistoryTestGlobals).lockAcquired = !!lock;
      await new Promise(() => {});
    });
  });
  await expect
    .poll(() => page.evaluate(() => (globalThis as unknown as HistoryTestGlobals).lockAcquired))
    .toBe(true);
  expect(
    await other.evaluate(() =>
      navigator.locks.request("kova-chat-history:A", { ifAvailable: true }, (lock) => !!lock),
    ),
  ).toBe(false);
  expect(
    await other.evaluate(() =>
      navigator.locks.request("kova-chat-history:B", { ifAvailable: true }, (lock) => !!lock),
    ),
  ).toBe(true);
  await page.close();
  // Closing the page initiates lock cleanup; the other process observes release asynchronously.
  await expect
    .poll(() =>
      other.evaluate(() =>
        navigator.locks.request("kova-chat-history:A", { ifAvailable: true }, (lock) => !!lock),
      ),
    )
    .toBe(true);
});
