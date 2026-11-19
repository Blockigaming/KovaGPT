import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserType } from "playwright";
import {
  BrowserRuntime,
  BrowserRuntimeError,
  BrowserSessionManager,
} from "../../src/browser-runtime/index";

let server: Server;
let origin: string;
let root: string;
let runtime: BrowserRuntime;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const second = request.url === "/second";
    response.setHeader("content-type", "text/html");
    response.end(
      `<!doctype html><html><head><title>${second ? "Second" : "Atlas"}</title><link rel="icon" href="/favicon.png"></head><body><main aria-label="Workspace"><h1>${second ? "History" : "Runtime ready"}</h1><button>Safe control</button></main></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  origin = `http://127.0.0.1:${address.port}`;
});

test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "atlas-runtime-test-"));
  runtime = new BrowserRuntime({ artifactRoot: root });
});

test.afterEach(async () => runtime.shutdown());
test.afterAll(
  async () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

const sessionOptions = (ownerId = "owner-a") => ({
  ownerId,
  workspaceId: "workspace-a",
  permissions: {
    grants: ["navigate", "screenshot", "dom_snapshot"] as const,
    allowedOrigins: [origin],
    allowPrivateNetworks: true,
  },
});

test("creates isolated sessions and rejects cross-owner access", async () => {
  const first = await runtime.createSession(sessionOptions());
  const second = await runtime.createSession(sessionOptions("owner-b"));
  expect(first.id).not.toBe(second.id);
  expect(() => runtime.listTabs(first.id, "owner-b")).toThrow(BrowserRuntimeError);
  await runtime.createTab(first.id, "owner-a", origin);
  expect(runtime.listTabs(second.id, "owner-b")).toHaveLength(0);
});

test("manages tabs, navigation metadata, history, reload, and waits", async () => {
  const session = await runtime.createSession(sessionOptions());
  const tab = await runtime.createTab(session.id, "owner-a", origin);
  expect(tab.title).toBe("Atlas");
  expect(tab.faviconUrl).toBe("/favicon.png");
  const second = await runtime.openUrl(session.id, "owner-a", tab.id, `${origin}/second`);
  expect(second.history).toHaveLength(2);
  expect((await runtime.back(session.id, "owner-a", tab.id)).title).toBe("Atlas");
  expect((await runtime.forward(session.id, "owner-a", tab.id)).title).toBe("Second");
  await runtime.refresh(session.id, "owner-a", tab.id);
  await runtime.waitForLoad(session.id, "owner-a", tab.id);
  await runtime.waitForNetworkIdle(session.id, "owner-a", tab.id);
  const duplicate = await runtime.duplicateTab(session.id, "owner-a", tab.id);
  expect(duplicate.url).toContain("/second");
  runtime.switchTab(session.id, "owner-a", tab.id);
  await runtime.closeTab(session.id, "owner-a", duplicate.id);
  expect(runtime.listTabs(session.id, "owner-a")).toHaveLength(1);
});

test("stores PNG screenshots and returns a bounded structured DOM snapshot", async () => {
  const session = await runtime.createSession(sessionOptions());
  const tab = await runtime.createTab(session.id, "owner-a", origin);
  for (const options of [{}, { fullPage: true }, { selector: "main" }]) {
    const artifact = await runtime.screenshot(session.id, "owner-a", tab.id, options);
    const bytes = await runtime.artifacts.read(artifact.storageKey);
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(artifact.mimeType).toBe("image/png");
  }
  const snapshot = await runtime.domSnapshot(session.id, "owner-a", tab.id);
  expect(snapshot.root.tag).toBe("html");
  expect(JSON.stringify(snapshot.root)).toContain("Runtime ready");
  expect(JSON.stringify(snapshot.root)).not.toContain("JSHandle");
});

test("enforces permissions and cleans expired sessions, artifacts, and processes", async () => {
  const denied = await runtime.createSession({ ...sessionOptions(), permissions: { grants: [] } });
  const deniedTab = await runtime.createTab(denied.id, "owner-a");
  await expect(runtime.openUrl(denied.id, "owner-a", deniedTab.id, origin)).rejects.toMatchObject({
    code: "permission_denied",
  });

  const expiring = await runtime.createSession({ ...sessionOptions(), idleTimeoutMs: 2_000 });
  const tab = await runtime.createTab(expiring.id, "owner-a", origin);
  await runtime.screenshot(expiring.id, "owner-a", tab.id);
  expect(await runtime.sessions.sweep(Date.now() + 3_000)).toBe(1);
  await expect(stat(join(root, expiring.id))).rejects.toMatchObject({ code: "ENOENT" });
  expect(() => runtime.listTabs(expiring.id, "owner-a")).toThrow(BrowserRuntimeError);
  const events = await runtime.auditSink.list(expiring.id);
  expect(events.map((event) => event.action)).toContain("session.closed");
});

test("blocks unsafe schemes, private networks, and non-allow-listed origins", async () => {
  const session = await runtime.createSession({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    permissions: { grants: ["navigate"], allowedOrigins: ["https://example.com"] },
  });
  const tab = await runtime.createTab(session.id, "owner-a");
  for (const url of ["file:///etc/passwd", "http://127.0.0.1/admin", "https://example.org/"]) {
    await expect(runtime.openUrl(session.id, "owner-a", tab.id, url)).rejects.toBeInstanceOf(
      BrowserRuntimeError,
    );
  }
});

test("expires inactive browser sessions after fifteen minutes", async () => {
  const session = await runtime.createSession(sessionOptions());
  expect(session.idleTimeoutMs).toBe(15 * 60_000);
  const created = Date.parse(session.lastUsedAt);
  expect(await runtime.sessions.sweep(created + 14 * 60_000)).toBe(0);
  expect(await runtime.sessions.sweep(created + 15 * 60_000)).toBe(1);
  expect(() => runtime.listTabs(session.id, "owner-a")).toThrow(BrowserRuntimeError);
});

test("closes the browser at its quota deadline even after activity", async () => {
  let browserClosed = false;
  const engine = {
    async launch() {
      return {
        async newContext() {
          return { async close() {} };
        },
        isConnected: () => true,
        once() {},
        async close() {
          browserClosed = true;
        },
      };
    },
  } as unknown as BrowserType;
  const manager = new BrowserSessionManager(runtime.artifacts, runtime.auditSink, {
    get: () => engine,
  });
  try {
    const hardExpiresAt = Date.now() + 1_000;
    const session = await manager.create({ ...sessionOptions(), hardExpiresAt });
    expect(Date.parse(session.expiresAt)).toBe(hardExpiresAt);
    expect(Date.parse(manager.get(session.id, "owner-a").descriptor.expiresAt)).toBe(hardExpiresAt);
    await expect.poll(() => browserClosed, { timeout: 4_000 }).toBe(true);
    expect(() => manager.get(session.id, "owner-a")).toThrow(BrowserRuntimeError);
  } finally {
    await manager.shutdown();
  }
});

test("admits Browserbase regional CDP endpoints and rejects look-alike hosts", async () => {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  const projectId = process.env.BROWSERBASE_PROJECT_ID;
  const fetch = globalThis.fetch;
  const remoteId = "12345678-abcd-1234-efab-123456789abc";
  let connectUrl = "wss://connect.usw2.browserbase.com/session";
  let released = 0;
  const manager = new BrowserSessionManager(runtime.artifacts, runtime.auditSink, {
    get() {
      throw new Error("CDP connection allowed");
    },
  });
  process.env.BROWSERBASE_API_KEY = "fixture-browserbase-key";
  process.env.BROWSERBASE_PROJECT_ID = "fixture-project";
  globalThis.fetch = async (url) => {
    if (url === "https://api.browserbase.com/v1/sessions") {
      return Response.json({ id: remoteId, connectUrl });
    }
    expect(url).toBe(`https://api.browserbase.com/v1/sessions/${remoteId}`);
    released += 1;
    return Response.json({ status: "COMPLETED" });
  };
  try {
    await expect(manager.create(sessionOptions())).rejects.toThrow("CDP connection allowed");
    connectUrl = "wss://connect.usw2.browserbase.com.example.org/session";
    await expect(manager.create(sessionOptions())).rejects.toThrow(
      "Invalid Browserbase connection endpoint",
    );
    expect(released).toBe(2);
  } finally {
    globalThis.fetch = fetch;
    if (apiKey === undefined) delete process.env.BROWSERBASE_API_KEY;
    else process.env.BROWSERBASE_API_KEY = apiKey;
    if (projectId === undefined) delete process.env.BROWSERBASE_PROJECT_ID;
    else process.env.BROWSERBASE_PROJECT_ID = projectId;
    await manager.shutdown();
  }
});
