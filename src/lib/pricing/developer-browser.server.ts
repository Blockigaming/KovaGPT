import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserRuntime } from "@/browser-runtime/runtime";
import { readAccountIdentity } from "@/lib/account-identity.server.mjs";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { readCloudBrowserRules } from "@/lib/cloud-browser-preferences.server.mjs";
import { assertCloudBrowserDestination } from "@/lib/cloud-browser-rules.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { createBrowserEgress } from "../../../work-runner/browser-egress.mjs";
import type { DeveloperIdentity } from "./developer-platform.server";
import {
  BROWSER_MODEL,
  developerBrowserOrigins,
  developerBrowserUrl,
  developerBrowserTargets,
  executeDeveloperBrowserPlan,
  validDeveloperBrowserRequest,
} from "./developer-browser-policy.mjs";

function allowedOrigins() {
  return developerBrowserOrigins(runtimeEnv("KOVA_DEVELOPER_BROWSER_ORIGINS_JSON"));
}

export function developerBrowserEnabled() {
  if (
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") !== "true" ||
    runtimeEnv("KOVA_DEVELOPER_BROWSER_ENABLED") !== "true" ||
    !process.env.BROWSERBASE_API_KEY?.trim() ||
    !process.env.BROWSERBASE_PROJECT_ID?.trim()
  )
    return false;
  try {
    return allowedOrigins().length > 0;
  } catch {
    return false;
  }
}

export async function assertDeveloperBrowserAuthority(
  identity: DeveloperIdentity,
  destination: URL,
) {
  if (!developerBrowserEnabled() || !allowedOrigins().includes(destination.origin))
    throw new Error("developer_browser_scope_required");
  const db = identity.db;
  const signal = AbortSignal.timeout(5000);
  const [key, owner, account, fence, banned, user, rules] = await Promise.all([
    db
      .from("developer_billing_keys")
      .select("id")
      .eq("id", identity.id)
      .eq("account_id", identity.account_id)
      .eq("project_id", identity.project_id)
      .contains("capabilities", ["cloud_browser"])
      .eq("enabled", true)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .abortSignal(signal)
      .maybeSingle(),
    db
      .from("developer_account_owners")
      .select("owner_id")
      .eq("account_id", identity.account_id)
      .eq("owner_id", identity.ownerId)
      .abortSignal(signal)
      .maybeSingle(),
    db
      .from("developer_credit_accounts")
      .select("id")
      .eq("id", identity.account_id)
      .is("suspended_at", null)
      .abortSignal(signal)
      .maybeSingle(),
    db
      .from("account_deletion_fences")
      .select("user_id")
      .eq("user_id", identity.ownerId)
      .abortSignal(signal)
      .maybeSingle(),
    db
      .from("banned_users")
      .select("user_id")
      .eq("user_id", identity.ownerId)
      .abortSignal(signal)
      .maybeSingle(),
    readAccountIdentity(db, identity.ownerId),
    readCloudBrowserRules(db, identity.ownerId),
  ]);
  if (
    [key, owner, account, fence, banned].some((row) => row.error) ||
    !key.data ||
    !owner.data ||
    !account.data ||
    fence.data ||
    banned.data ||
    !user
  )
    throw new Error("developer_browser_scope_required");
  await assertLockdownAllows(db, identity.ownerId, "agent");
  await assertLockdownAllows(db, identity.ownerId, "live_web");
  assertCloudBrowserDestination(rules, destination.href);
}

export async function runDeveloperBrowser(
  identity: DeveloperIdentity,
  body: Record<string, unknown>,
  callerSignal?: AbortSignal,
): Promise<Response> {
  if (!validDeveloperBrowserRequest(body)) throw new Error("developer_browser_invalid");
  const [url] = developerBrowserTargets(body);
  const signal = AbortSignal.any([
    AbortSignal.timeout(45000),
    ...(callerSignal ? [callerSignal] : []),
  ]);
  const check = async (target = url) => {
    signal.throwIfAborted();
    await assertDeveloperBrowserAuthority(identity, target);
    signal.throwIfAborted();
  };
  await check();
  const runtime = new BrowserRuntime({
    artifactRoot: join(tmpdir(), "kova-developer-browser"),
    auditSink: {
      async append() {},
      async list() {
        return [];
      },
    },
  });
  let sessionId: string | undefined;
  const owner = identity.ownerId;
  try {
    const descriptor = await runtime.createSession({
      ownerId: owner,
      workspaceId: identity.project_id,
      readOnly: true,
      requireRemote: true,
      hardExpiresAt: Date.now() + 45000,
      permissions: {
        grants: ["navigate", "dom_snapshot", "screenshot"],
        allowedOrigins: [url.origin],
      },
    });
    sessionId = descriptor.id;
    const session = runtime.sessions.get(sessionId, owner, false);
    const remoteId = session.providerSessionId;
    if (!remoteId) throw new Error("developer_browser_unavailable");
    await check();
    let requests = 0;
    let bytes = 0;
    const fetchPage = createBrowserEgress({ origins: [url.origin], assertAuthority: check });
    await session.context.route("**/*", async (route) => {
      try {
        const request = route.request();
        if (
          ++requests > 12 ||
          !["document", "stylesheet", "image", "font"].includes(request.resourceType()) ||
          request.method() !== "GET"
        )
          throw new Error("developer_browser_request_denied");
        const target = developerBrowserUrl(request.url());
        if (target.origin !== url.origin) throw new Error("developer_browser_request_denied");
        const result = await fetchPage(
          {
            url: target.href,
            method: "GET",
            headers: { "user-agent": "KovaGPT/1.0 (https://kovagpt.com/help/contact)" },
            bodyBase64: "",
          },
          { signal },
        );
        const content = Buffer.from(result.bodyBase64, "base64");
        bytes += content.length;
        if (result.status < 200 || result.status >= 300 || bytes > 8 * 1024 * 1024)
          throw new Error("developer_browser_request_denied");
        await route.fulfill({
          status: result.status,
          contentType: result.headers["content-type"],
          headers: {
            "x-dns-prefetch-control": "off",
            "content-security-policy":
              "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'none'; base-uri 'none'; frame-src 'none'",
          },
          body: content,
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await session.context.routeWebSocket("**/*", (socket) => socket.close());
    const tab = await runtime.createTab(sessionId, owner);
    const ownedSession = sessionId;
    const snapshots = await executeDeveloperBrowserPlan(body, {
      signal,
      check,
      capture: async (target) => {
        await runtime.openUrl(ownedSession, owner, tab.id, target.href, 12000);
        const page = runtime.sessions.get(ownedSession, owner).tabs.get(tab.id)?.page;
        if (!page || page.url() !== target.href) throw new Error("developer_browser_unavailable");
        const text = await page.locator("body").innerText({ timeout: 2500 });
        return {
          url: target.href,
          title: (await page.title()).slice(0, 180),
          text: text.slice(0, 10000),
        };
      },
    });
    const final = snapshots[snapshots.length - 1];
    const page = runtime.sessions.get(ownedSession, owner).tabs.get(tab.id)?.page;
    if (!page || page.url() !== final.url) throw new Error("developer_browser_unavailable");
    const image = await page.screenshot({ type: "jpeg", quality: 55, timeout: 3500 });
    if (image.length > 256 * 1024) throw new Error("developer_browser_unavailable");
    await check(developerBrowserUrl(final.url));
    return Response.json({
      id: remoteId,
      model: BROWSER_MODEL,
      status: "completed",
      usage: { browser_sessions_60s: 1 },
      result: {
        id: randomUUID(),
        object: "browser.snapshot",
        ...final,
        ...(snapshots.length > 1 ? { navigation: snapshots } : {}),
        screenshot: "data:image/jpeg;base64," + image.toString("base64"),
        observed_at: new Date().toISOString(),
      },
    });
  } finally {
    if (sessionId) await runtime.closeSession(sessionId, owner).catch(() => undefined);
    await runtime.shutdown();
  }
}
