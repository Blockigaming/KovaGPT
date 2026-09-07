import { test, expect, type Page } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
let server: Server, origin: string;
test.beforeAll(async () => {
  const worker = await readFile("public/kova-sw.js"),
    offline = await readFile("public/offline.html");
  server = createServer((request, response) => {
    if (request.url === "/simulated-network-failure") {
      request.socket.destroy();
      return;
    }
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/kova-sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(worker);
      return;
    }
    if (request.url === "/offline.html") {
      response.setHeader("Content-Type", "text/html");
      response.end(offline);
      return;
    }
    if (request.url === "/api/push/revoke-device") {
      response.setHeader("Content-Type", "application/json");
      response.end('{"ok":true}');
      return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end(
      "<!doctype html><html><title>PWA lifecycle fixture</title><body>Public shell</body></html>",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("No fixture port");
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});
async function message(page: Page, data: Record<string, unknown>) {
  return page.evaluate(async (value) => {
    const ready = await navigator.serviceWorker.ready;
    const post = (data: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => reject(Error("worker timeout")), 15000);
        channel.port1.onmessage = (event) => {
          clearTimeout(timer);
          channel.port1.close();
          resolve(event.data);
        };
        ready.active!.postMessage(data, [channel.port2]);
      });
    if (!["STATE", "CLEAR_OWNER"].includes(String(value.type)) && value.expectedEpoch === undefined)
      value.expectedEpoch = (await post({ type: "STATE" })).epoch;
    return post(value);
  }, data);
}
async function install(page: Page) {
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/kova-sw.js");
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
}
async function share(page: Page, text: string) {
  const previous = page.url();
  await page.evaluate((value) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/share-inbox";
    form.enctype = "multipart/form-data";
    const field = document.createElement("textarea");
    field.name = "text";
    field.value = value;
    form.append(field);
    document.body.append(form);
    form.submit();
  }, text);
  await page.waitForURL((url) => url.href !== previous && /\/share-inbox\?ticket=/u.test(url.href));
  await page.waitForLoadState("load");
  return new URL(page.url()).searchParams.get("ticket")!;
}
const owner = "11111111-1111-4111-8111-111111111111",
  other = "22222222-2222-4222-8222-222222222222";
test("actual service worker preserves an OS share through sign-in and repeated preview, then erases on consume or account switch", async ({
  page,
}) => {
  await install(page);
  await message(page, { type: "OWNER", ownerId: null });
  const ticket = await share(page, "Private shared note");
  await message(page, { type: "OWNER", ownerId: owner });
  const preview = { type: "SHARE", ownerId: owner, ticket };
  expect(await message(page, preview)).toEqual({
    ok: true,
    value: { title: "", text: "Private shared note", url: "" },
  });
  expect(await message(page, preview)).toEqual({
    ok: true,
    value: { title: "", text: "Private shared note", url: "" },
  });
  expect(await message(page, { type: "SHARE", ownerId: other, ticket })).toEqual({ ok: false });
  expect(await message(page, { ...preview, type: "SHARE_CONSUME" })).toEqual({ ok: true });
  expect(await message(page, preview)).toEqual({ ok: false });
  const second = await share(page, "Only the original account");
  await message(page, { type: "OWNER", ownerId: other });
  expect(await message(page, { type: "SHARE", ownerId: other, ticket: second })).toEqual({
    ok: false,
  });
  await message(page, { type: "OWNER", ownerId: owner });
  expect(await message(page, { type: "SHARE", ownerId: owner, ticket: second })).toEqual({
    ok: false,
  });
});
test("actual service worker caches only public offline content and bounded share intake rejects files and unsafe URLs", async ({
  page,
}) => {
  await install(page);
  await page.goto(`${origin}/private-chat`);
  await page.evaluate(() => fetch("/api/private-document").then((r) => r.text()));
  const entries = await page.evaluate(async () => {
    const all = [];
    for (const name of await caches.keys())
      for (const request of await (await caches.open(name)).keys())
        all.push(new URL(request.url).pathname);
    return all;
  });
  expect(entries).toEqual(["/offline.html"]);
  expect(
    await page.evaluate(async () => {
      const form = new FormData();
      form.append("text", new File(["private"], "private.txt"));
      return (await fetch("/share-inbox", { method: "POST", body: form })).status;
    }),
  ).toBe(400);
  expect(
    await page.evaluate(async () => {
      const form = new FormData();
      form.append("url", "javascript:alert(1)");
      return (await fetch("/share-inbox", { method: "POST", body: form })).status;
    }),
  ).toBe(400);
  expect(
    await page.evaluate(async () => {
      const form = new FormData();
      form.append("text", "x".repeat(12001));
      return (await fetch("/share-inbox", { method: "POST", body: form })).status;
    }),
  ).toBe(400);
  await page.goto(`${origin}/simulated-network-failure`);
  await expect(page.getByRole("heading", { name: "Connect to open KovaGPT" })).toBeVisible();
  expect(await page.content()).not.toContain("Private shared note");
});
test("device binding is erased on privacy clear and a stale account cannot reinstate it", async ({
  page,
}) => {
  await install(page);
  await message(page, { type: "OWNER", ownerId: owner });
  const binding = {
    ownerId: owner,
    id: crypto.randomUUID(),
    revision: 1,
    deviceSecret: "a".repeat(43),
  };
  expect(await message(page, { type: "BIND", ownerId: owner, binding })).toEqual({ ok: true });
  expect((await message(page, { type: "BINDING", ownerId: owner })).binding).toEqual(binding);
  await message(page, { type: "CLEAR_OWNER", ownerId: owner });
  await message(page, { type: "OWNER", ownerId: other });
  expect(await message(page, { type: "BIND", ownerId: owner, binding })).toEqual({ ok: false });
  expect((await message(page, { type: "BINDING", ownerId: other })).binding).toBeNull();
});

test("durable owner epoch rejects a delayed old-tab owner or binding after another account takes over", async ({
  page,
  context,
}) => {
  await install(page);
  await message(page, { type: "OWNER", ownerId: owner });
  const old = await message(page, { type: "STATE" });
  const newer = await context.newPage();
  await newer.goto(origin);
  await message(newer, { type: "OWNER", ownerId: other });
  expect(await message(page, { type: "OWNER", ownerId: owner, expectedEpoch: old.epoch })).toEqual({
    ok: false,
  });
  expect(
    await message(page, {
      type: "BIND",
      ownerId: owner,
      expectedEpoch: old.epoch,
      binding: {
        ownerId: owner,
        id: crypto.randomUUID(),
        revision: 1,
        deviceSecret: "a".repeat(43),
      },
    }),
  ).toEqual({ ok: false });
  const state = await message(newer, { type: "STATE" });
  expect(state.ownerId).toBe(other);
  const same = await context.newPage();
  await same.goto(origin);
  expect(
    (await message(same, { type: "OWNER", ownerId: other, expectedEpoch: state.epoch })).ok,
  ).toBe(true);
  expect((await message(same, { type: "STATE" })).epoch).toBe(state.epoch);
});
test("native push events record identity before the display adapter and never repeat after dismissal or owner reset", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  let registrationId: string | undefined;
  cdp.on("ServiceWorker.workerRegistrationUpdated", ({ registrations }) => {
    registrationId =
      registrations.find((row) => row.scopeURL === `${origin}/`)?.registrationId ?? registrationId;
  });
  await cdp.send("ServiceWorker.enable");
  await install(page);
  await expect.poll(() => registrationId).toBeTruthy();
  await message(page, { type: "OWNER", ownerId: owner });
  const id = crypto.randomUUID();
  await message(page, {
    type: "BIND",
    ownerId: owner,
    binding: { ownerId: owner, id, revision: 1, deviceSecret: "a".repeat(43) },
  });
  const payload = {
    version: 1,
    subscriptionId: id,
    eventId: crypto.randomUUID(),
    eventSource: "application",
    eventAt: new Date().toISOString(),
  };
  const deliver = () =>
    cdp.send("ServiceWorker.deliverPushMessage", {
      origin,
      registrationId: registrationId!,
      data: JSON.stringify(payload),
    });
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(() => {
    const state = globalThis as unknown as { shown: unknown[] };
    state.shown = [];
    ServiceWorkerRegistration.prototype.showNotification = async function (title, options) {
      const receipts = await new Promise<unknown[]>((resolve, reject) => {
        const req = indexedDB.open("kova-pwa-v1");
        req.onerror = () => reject(Error("storage"));
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("meta", "readonly"),
            read = tx.objectStore("meta").get("delivered");
          read.onsuccess = () => resolve(read.result ?? []);
          tx.oncomplete = () => db.close();
        };
      });
      if (!receipts.length) throw Error("display before durable receipt");
      state.shown.push({ title, body: options?.body });
    };
  });
  const count = () =>
    worker.evaluate(() => (globalThis as unknown as { shown: unknown[] }).shown.length);
  await deliver();
  await expect.poll(count).toBe(1);
  await worker.evaluate(() => {
    (globalThis as unknown as { shown: unknown[] }).shown = [];
  });
  await deliver();
  await page.waitForTimeout(150);
  expect(await count()).toBe(0);
  await message(page, { type: "CLEAR_OWNER", ownerId: owner });
  await message(page, { type: "OWNER", ownerId: other });
  await deliver();
  await page.waitForTimeout(150);
  expect(await count()).toBe(0);
});
