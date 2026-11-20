import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "playwright";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserEgress } from "../../work-runner/browser-egress.mjs";
import { BrowserRuntime } from "@/browser-runtime/runtime";
import type { AuthedCaller } from "@/lib/api-auth.server";
import { readBrowserCapacity } from "@/lib/browserbase-capacity.server.mjs";
import { readCloudBrowserRules } from "@/lib/cloud-browser-preferences.server.mjs";
import { assertCloudBrowserDestination } from "@/lib/cloud-browser-rules.mjs";
import { ChatPreflightError } from "@/lib/chat-preflight.server.mjs";
import type { CloudBrowserControl, CloudBrowserFrame } from "@/lib/cloud-browser-control";

type BrowserTier = "free" | "plus" | "pro";
type BrowserClaim =
  { status: "waiting" | "daily_limit" } | { status: "admitted"; deadline: string | null };
type Preview = { preview_jpeg: string | null; preview_expires_at: string | null };
type BrowserDatabase = {
  public: {
    Tables: {
      browserbase_queue: {
        Row: Preview & {
          owner_id: string;
          request_id: string;
          claimed: boolean;
          quota_reserved_ms: number | null;
        };
        Insert: never;
        Update: Partial<Preview>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_browserbase_slot_with_quota: {
        Args: { p_owner: string; p_request: string; p_tier: BrowserTier; p_capacity: number };
        Returns: BrowserClaim;
      };
      release_browserbase_slot_with_quota: {
        Args: { p_owner: string; p_request: string; p_opened: boolean };
        Returns: undefined;
      };
    };
  };
};
const database = (caller: AuthedCaller) =>
  caller.supabaseAdmin as unknown as SupabaseClient<BrowserDatabase>;
type ActiveChatBrowser = {
  requestId: string;
  sessionId: string;
  page: Page;
  origin: string;
  takeover: boolean;
  busy: boolean;
  frame?: CloudBrowserFrame;
  controls: AbortController;
};
const active = new Map<string, ActiveChatBrowser>();
let browserRuntime: BrowserRuntime | undefined;
function getBrowserRuntime() {
  return (browserRuntime ??= new BrowserRuntime({
    artifactRoot: join(tmpdir(), `kova-chat-browser-${randomUUID()}`),
    auditSink: {
      async append() {},
      async list() {
        return [];
      },
    },
  }));
}

export function chatBrowserFailure(code: string, publicMessage: string, status = 503) {
  return new ChatPreflightError({
    stage: "cloud_browser",
    code,
    status,
    retryable: status === 503 || (status === 429 && code !== "cloud_browser_daily_limit"),
    publicMessage,
  });
}

export async function readChatBrowserPage({
  caller,
  tier,
  chatId,
  url,
  signal,
}: {
  caller: AuthedCaller;
  tier: BrowserTier;
  chatId?: string;
  url: URL;
  signal: AbortSignal;
}) {
  const userId = caller.userId;
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  const unavailable = () =>
    chatBrowserFailure(
      "cloud_browser_unavailable",
      "Cloud Browser is temporarily unavailable. Try again shortly.",
    );
  if (!apiKey || !projectId) throw unavailable();
  const db = database(caller);
  const runtime = getBrowserRuntime();
  const requestId = randomUUID();
  let sessionId: string | undefined;
  let queued = false;
  let opened = false;
  const release = async () => {
    const current = active.get(userId);
    if (current?.sessionId === sessionId && current) {
      current.controls.abort();
      active.delete(userId);
    }
    await db
      .rpc("release_browserbase_slot_with_quota", {
        p_owner: userId,
        p_request: requestId,
        p_opened: opened,
      })
      .abortSignal(AbortSignal.timeout(4000));
  };
  try {
    const rules = await readCloudBrowserRules(caller.supabaseAdmin, userId);
    try {
      assertCloudBrowserDestination(rules, url.href);
    } catch {
      throw chatBrowserFailure(
        "cloud_browser_site_denied",
        "This site is blocked in your Cloud Browser settings.",
        403,
      );
    }
    const capacity = await readBrowserCapacity({ projectId, apiKey });
    signal.throwIfAborted();
    if (capacity === 0) throw unavailable();
    const previous = active.get(userId);
    if (previous?.takeover)
      throw chatBrowserFailure(
        "cloud_browser_under_your_control",
        "Return control in Cloud Browser before starting another browser task.",
        409,
      );
    if (previous) await runtime.closeSession(previous.sessionId, userId).catch(() => undefined);
    const waitUntil = Date.now() + 8000;
    let hardExpiresAt: number | undefined;
    while (true) {
      signal.throwIfAborted();
      queued = true;
      const claim = await db
        .rpc("claim_browserbase_slot_with_quota", {
          p_owner: userId,
          p_request: requestId,
          p_tier: tier,
          p_capacity: capacity,
        })
        .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(4000)]));
      if (claim.error || !claim.data) throw unavailable();
      if (claim.data.status === "daily_limit") {
        throw chatBrowserFailure(
          "cloud_browser_daily_limit",
          "You've reached your daily Cloud Browser limit. Your time resets at midnight UTC.",
          429,
        );
      }
      if (claim.data.status === "admitted") {
        if (tier !== "pro") {
          hardExpiresAt = Date.parse(claim.data.deadline ?? "");
          if (!Number.isFinite(hardExpiresAt)) throw unavailable();
        }
        break;
      }
      if (Date.now() >= waitUntil) {
        throw chatBrowserFailure(
          "cloud_browser_busy",
          "Cloud Browser is busy. Try again shortly.",
          429,
        );
      }
      await delay(550, undefined, { signal });
    }
    const descriptor = await runtime.createSession({
      ownerId: userId,
      workspaceId: chatId ?? requestId,
      chatId,
      readOnly: true,
      hardExpiresAt,
      permissions: {
        grants: ["navigate", "dom_snapshot", "screenshot"],
        allowedOrigins: [url.origin],
      },
      onClosed: release,
    });
    sessionId = descriptor.id;
    opened = true;
    signal.throwIfAborted();
    const { context } = runtime.sessions.get(sessionId, userId, false);
    // Browserbase renders the page. All network requests go through the existing
    // DNS-pinned egress broker, with no credentials and no redirect passthrough.
    let remaining = 40;
    let loading = true;
    const controls = new AbortController();
    const browserSignal = () => {
      if (loading) return signal;
      if (interactive.takeover && active.get(userId) === interactive)
        return interactive.controls.signal;
      throw new Error("browser_request_denied");
    };
    const fetchPage = createBrowserEgress({
      origins: [url.origin],
      assertAuthority: () => browserSignal().throwIfAborted(),
    });
    await context.route("**/*", async (route) => {
      try {
        if (--remaining < 0) throw new Error("browser_request_budget");
        const request = route.request();
        const result = await fetchPage(
          { url: request.url(), method: request.method(), headers: {}, bodyBase64: "" },
          { signal: browserSignal() },
        );
        if (result.status < 200 || result.status >= 300) throw new Error("browser_request_denied");
        await route.fulfill({
          status: result.status,
          contentType: result.headers["content-type"],
          headers: {
            "x-dns-prefetch-control": "off",
            "content-security-policy":
              "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'",
          },
          body: Buffer.from(result.bodyBase64, "base64"),
        });
      } catch {
        await route.abort().catch(() => undefined);
      }
    });
    await context.routeWebSocket("**/*", (socket) => socket.close());
    const tab = await runtime.createTab(sessionId, userId);
    await runtime.openUrl(sessionId, userId, tab.id, url.href, 12_000);
    const session = runtime.sessions.get(sessionId, userId);
    const page = session.tabs.get(tab.id)!.page;
    const content = await page
      .locator("main, [role=main], body")
      .last()
      .evaluate(
        (element) => (element as HTMLElement).innerText.trim().slice(0, 10_000),
        undefined,
        { timeout: 2500 },
      );
    if (!content)
      throw chatBrowserFailure(
        "cloud_browser_empty_page",
        "Cloud Browser could not read text from that page.",
      );
    const title = (await page.title()).slice(0, 180);
    const jpeg = (await page.screenshot({ type: "jpeg", quality: 60, timeout: 3500 })).toString(
      "base64",
    );
    signal.throwIfAborted();
    const { expiresAt } = runtime.sessions.get(sessionId, userId).descriptor;
    const saved = await db
      .from("browserbase_queue")
      .update({ preview_jpeg: jpeg, preview_expires_at: expiresAt })
      .eq("owner_id", userId)
      .eq("request_id", requestId)
      .eq("claimed", true)
      .select("request_id")
      .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(4000)]))
      .maybeSingle();
    if (saved.error || !saved.data) throw unavailable();
    signal.throwIfAborted();
    runtime.sessions.get(sessionId, userId, false);
    const interactive: ActiveChatBrowser = {
      requestId,
      sessionId,
      page,
      origin: url.origin,
      takeover: false,
      busy: false,
      controls,
    };
    active.set(userId, interactive);
    loading = false;
    return {
      title,
      content,
      browser: {
        sessionId: requestId,
        observedAt: Date.now(),
        expiresAt: Date.parse(expiresAt),
        tabCount: 1,
        hostname: url.hostname,
        previewPath: `/api/browser/preview/${requestId}`,
      },
    };
  } catch (error) {
    if (sessionId) await runtime.closeSession(sessionId, userId).catch(() => undefined);
    else if (queued) await release().catch(() => undefined);
    if (signal.aborted) signal.throwIfAborted();
    if (error instanceof ChatPreflightError) throw error;
    throw unavailable();
  }
}

export async function controlChatBrowser(
  caller: AuthedCaller,
  requestId: string,
  action: CloudBrowserControl,
): Promise<CloudBrowserFrame | null> {
  const current = active.get(caller.userId);
  const expired = () =>
    chatBrowserFailure("cloud_browser_expired", "This browser session has ended.", 404);
  if (!current || current.requestId !== requestId) throw expired();
  const runtime = getBrowserRuntime();
  const getSession = (touch = false) => {
    try {
      return runtime.sessions.get(current.sessionId, caller.userId, touch);
    } catch {
      throw expired();
    }
  };
  if (action.kind === "release") {
    current.controls.abort();
    await runtime.closeSession(current.sessionId, caller.userId).catch(() => undefined);
    return null;
  }
  getSession();
  if (current.busy)
    throw chatBrowserFailure("cloud_browser_busy", "A browser action is in progress.", 409);
  if (action.kind !== "takeover" && !current.takeover)
    throw chatBrowserFailure("cloud_browser_not_in_control", "Take over the browser first.", 409);
  current.busy = true;
  const { page } = current;
  try {
    if (action.kind === "takeover") {
      const rules = await readCloudBrowserRules(caller.supabaseAdmin, caller.userId);
      try {
        assertCloudBrowserDestination(rules, page.url());
      } catch {
        throw chatBrowserFailure(
          "cloud_browser_site_denied",
          "This site is blocked in your Cloud Browser settings.",
          403,
        );
      }
      getSession(true);
      current.takeover = true;
    } else if (action.kind === "frame") {
      const viewport = page.viewportSize();
      if (
        action.width !== undefined &&
        action.height !== undefined &&
        (viewport?.width !== action.width || viewport?.height !== action.height)
      )
        await page.setViewportSize({ width: action.width, height: action.height });
    } else {
      getSession(true);
      if (action.kind === "click" || action.kind === "scroll") {
        const frame = current.frame;
        if (
          !frame ||
          action.frame !== frame.id ||
          action.x >= frame.width ||
          action.y >= frame.height
        )
          return frame ?? null;
        if (action.kind === "click") {
          await page.mouse.click(action.x, action.y);
          await page.waitForLoadState("domcontentloaded", { timeout: 3500 }).catch(() => undefined);
        } else {
          await page.mouse.move(action.x, action.y);
          await page.mouse.wheel(action.deltaX, action.deltaY);
        }
      } else if (action.kind === "input") {
        if (!(await page.locator("input[type=password]:focus").count()))
          await page.keyboard.insertText(action.text);
      } else if (action.kind === "key") {
        await page.keyboard.press(action.key);
        if (action.key === "Enter")
          await page.waitForLoadState("domcontentloaded", { timeout: 3500 }).catch(() => undefined);
      }
    }
    if (new URL(page.url()).origin !== current.origin)
      throw chatBrowserFailure(
        "cloud_browser_site_denied",
        "Cloud Browser stays on the site opened in this chat.",
        403,
      );
    const viewport = page.viewportSize();
    if (!viewport) throw expired();
    // Keep owner-entered page state in the browser. Never save these frames in Chat history.
    for (const quality of [55, 32, 16]) {
      const bytes = await page.screenshot({ type: "jpeg", quality, timeout: 3500 });
      if (bytes.length > 256000) continue;
      getSession();
      const jpeg = bytes.toString("base64");
      if (
        current.frame?.jpeg !== jpeg ||
        current.frame.width !== viewport.width ||
        current.frame.height !== viewport.height
      )
        current.frame = { id: randomUUID(), jpeg, ...viewport };
      return current.frame;
    }
    throw chatBrowserFailure(
      "cloud_browser_frame_too_large",
      "Cloud Browser could not display this page.",
    );
  } finally {
    current.busy = false;
  }
}

export async function readChatBrowserPreview(caller: AuthedCaller, requestId: string) {
  const result = await database(caller)
    .from("browserbase_queue")
    .select("preview_jpeg")
    .eq("owner_id", caller.userId)
    .eq("request_id", requestId)
    .eq("claimed", true)
    .gt("preview_expires_at", new Date().toISOString())
    .abortSignal(AbortSignal.timeout(5000))
    .maybeSingle();
  return result.error ? null : (result.data?.preview_jpeg ?? null);
}

export async function chatBrowserReadiness(caller: AuthedCaller) {
  const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
  const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
  if (!apiKey || !projectId) return false;
  try {
    const [capacity, queue] = await Promise.all([
      readBrowserCapacity({ projectId, apiKey }),
      database(caller)
        .from("browserbase_queue")
        .select("request_id,quota_reserved_ms")
        .limit(0)
        .abortSignal(AbortSignal.timeout(5000)),
    ]);
    return capacity > 0 && !queue.error;
  } catch {
    return false;
  }
}
