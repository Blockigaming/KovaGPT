import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BrowserRuntime,
  BrowserRuntimeError,
  type AuditEvent,
  type AuditSink,
} from "../../src/browser-runtime/index";

let server: Server;
let origin: string;
let root: string;
let runtime: BrowserRuntime;

test.beforeAll(async () => {
  server = createServer((request, response) => {
    const second = request.url === "/second";
    if (request.url === "/redirect-denied") {
      response.writeHead(302, { location: "https://example.org/" });
      response.end();
      return;
    }
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

  const expiring = await runtime.createSession({ ...sessionOptions(), lifetimeMs: 2_000 });
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

test("blocks redirected document navigations to non-allow-listed origins", async () => {
  const session = await runtime.createSession(sessionOptions());
  const tab = await runtime.createTab(session.id, "owner-a");
  await expect(
    runtime.openUrl(session.id, "owner-a", tab.id, `${origin}/redirect-denied`),
  ).rejects.toBeInstanceOf(Error);
  expect(runtime.listTabs(session.id, "owner-a")[0].url).toBe("about:blank");
});

test("checks resolved addresses before allowing public-looking hostnames", async () => {
  const localhostOrigin = origin.replace("127.0.0.1", "localhost");
  const session = await runtime.createSession({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    permissions: { grants: ["navigate"], allowedOrigins: [localhostOrigin] },
  });
  const tab = await runtime.createTab(session.id, "owner-a");
  await expect(
    runtime.openUrl(session.id, "owner-a", tab.id, localhostOrigin),
  ).rejects.toMatchObject({
    code: "private_network_denied",
  });
});

test("freezes returned permission policy lists", async () => {
  const session = await runtime.createSession({
    ownerId: "owner-a",
    workspaceId: "workspace-a",
    permissions: { grants: [], allowedOrigins: [], deniedOrigins: [] },
  });
  expect(() => (session.permissions.grants as string[]).push("navigate")).toThrow(TypeError);
  expect(() => (session.permissions.allowedOrigins as string[]).push(origin)).toThrow(TypeError);
  const tab = await runtime.createTab(session.id, "owner-a");
  await expect(runtime.openUrl(session.id, "owner-a", tab.id, origin)).rejects.toMatchObject({
    code: "permission_denied",
  });
});

test("cleans resources even when close audit logging fails", async () => {
  class FailingCloseAuditSink implements AuditSink {
    readonly events: AuditEvent[] = [];
    async append(event: Readonly<AuditEvent>) {
      if (event.action === "session.closed") throw new Error("audit unavailable");
      this.events.push(event);
    }
    async list(sessionId: string) {
      return this.events.filter((event) => event.sessionId === sessionId);
    }
  }
  const auditSink = new FailingCloseAuditSink();
  const isolatedRuntime = new BrowserRuntime({ artifactRoot: root, auditSink });
  const session = await isolatedRuntime.createSession(sessionOptions());
  const tab = await isolatedRuntime.createTab(session.id, "owner-a", origin);
  await isolatedRuntime.screenshot(session.id, "owner-a", tab.id);
  await expect(isolatedRuntime.closeSession(session.id, "owner-a")).rejects.toThrow(
    "audit unavailable",
  );
  await expect(stat(join(root, session.id))).rejects.toMatchObject({ code: "ENOENT" });
  expect(() => isolatedRuntime.listTabs(session.id, "owner-a")).toThrow(BrowserRuntimeError);
  await isolatedRuntime.shutdown();
});
