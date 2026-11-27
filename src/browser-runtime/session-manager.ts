import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { audit } from "./audit";
import { runtimeError } from "./errors";
import type {
  AuditSink,
  BrowserEngine,
  CreateSessionOptions,
  EngineProvider,
  RuntimeSession,
} from "./types";
import { BrowserArtifactStore } from "./artifacts";

// Idle browsers are released after 15 minutes with no authenticated operation.
const DEFAULT_IDLE_MS = 15 * 60_000;
const BROWSERBASE_CDP_HEARTBEAT_MS = 4 * 60_000;
// Browserbase's Free plan allows at most 15 minutes per remote session.
const BROWSERBASE_READ_ONLY_TIMEOUT_SECONDS = 900;

function sessionExpiry(now: number, idleMs: number, hardExpiresAt = Infinity) {
  return new Date(Math.min(now + idleMs, hardExpiresAt)).toISOString();
}

export class PlaywrightEngineProvider implements EngineProvider {
  get(engine: BrowserEngine) {
    const load = createRequire(import.meta.url);
    const playwright = load("playwright") as typeof import("playwright");
    return playwright[engine];
  }
}

export class BrowserSessionManager {
  readonly #sessions = new Map<string, RuntimeSession>();
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly artifacts: BrowserArtifactStore,
    private readonly auditSink: AuditSink,
    private readonly engines: EngineProvider = new PlaywrightEngineProvider(),
    sweepIntervalMs = 30_000,
  ) {
    this.#timer = setInterval(() => void this.sweep(), sweepIntervalMs);
    this.#timer.unref?.();
  }

  async create(options: CreateSessionOptions) {
    if (!options.ownerId || !options.workspaceId)
      throw runtimeError("invalid_identity", "Owner and workspace are required");
    const id = randomUUID();
    const engine = options.engine ?? "chromium";
    let { hardExpiresAt } = options;
    const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_MS;
    const storagePath = await this.artifacts.initializeSession(id);
    let browser;
    let providerSessionId: string | undefined;
    let releaseRemote: (() => Promise<void>) | undefined;
    let remoteHeartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      // A process per session is intentional: contexts isolate cookies/storage while the
      // process boundary prevents accidental cross-user browser reuse.
      const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
      const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
      const remainingMs = (hardExpiresAt ?? Infinity) - Date.now();
      if (remainingMs <= 0) throw runtimeError("session_expired", "Browser time has expired");
      if (options.requireRemote && (!apiKey || !projectId || !options.readOnly))
        throw new Error("A bounded remote browser is required");
      if (apiKey || projectId) {
        if (!apiKey || !projectId || engine !== "chromium") {
          throw new Error("Browserbase requires a configured Chromium project");
        }
        const headers = { "X-BB-API-Key": apiKey, "Content-Type": "application/json" };
        const sessionsUrl = "https://api.browserbase.com/v1/sessions";
        const timeout = Math.min(
          BROWSERBASE_READ_ONLY_TIMEOUT_SECONDS,
          Math.max(60, Math.ceil(remainingMs / 1000)),
        );
        const requestedAt = Date.now();
        const response = await fetch(sessionsUrl, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({
            projectId,
            keepAlive: false,
            ...(options.readOnly ? { timeout } : {}),
            browserSettings: { recordSession: false, logSession: false, solveCaptchas: false },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) {
          console.error("[browserbase] Session creation failed", { status: response.status });
          throw new Error("Browserbase session creation failed");
        }
        const session = await response.json();
        if (typeof session.id !== "string" || !/^[a-f0-9-]{36}$/i.test(session.id)) {
          throw new Error("Invalid Browserbase session ID");
        }
        providerSessionId = session.id;
        releaseRemote = async () => {
          await fetch(`${sessionsUrl}/${session.id}`, {
            method: "POST",
            headers,
            redirect: "error",
            body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
            signal: AbortSignal.timeout(5000),
          });
        };
        if (options.readOnly) {
          const providerExpiry = Date.parse(session.expiresAt ?? "");
          hardExpiresAt = Math.min(
            hardExpiresAt ?? Infinity,
            Number.isFinite(providerExpiry) ? providerExpiry : requestedAt + timeout * 1000,
          );
        }
        const connection = new URL(session.connectUrl);
        if (
          connection.protocol !== "wss:" ||
          !/^connect(?:\.[a-z0-9-]+)?\.browserbase\.com$/.test(connection.hostname) ||
          connection.username ||
          connection.password ||
          connection.port
        ) {
          throw new Error("Invalid Browserbase connection endpoint");
        }
        browser = await this.engines
          .get("chromium")
          .connectOverCDP(connection.href, { timeout: 8000 });
      } else {
        browser = await this.engines.get(engine).launch({ headless: true });
      }
      const context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
        ...(options.readOnly
          ? { javaScriptEnabled: false, viewport: { width: 840, height: 540 } }
          : {}),
      });
      if (releaseRemote && options.readOnly) {
        const cdp = await browser.newBrowserCDPSession();
        // Browserbase closes inactive CDP connections before Kova's idle limit.
        // This control-plane command never refreshes the user's idle deadline.
        remoteHeartbeat = setInterval(() => {
          void cdp.send("Browser.getVersion").catch(() => undefined);
        }, BROWSERBASE_CDP_HEARTBEAT_MS);
        remoteHeartbeat.unref();
      }
      const now = Date.now();
      if (hardExpiresAt !== undefined && now >= hardExpiresAt)
        throw runtimeError("session_expired", "Browser time has expired");
      const session: RuntimeSession = {
        descriptor: {
          id,
          engine,
          ownerId: options.ownerId,
          workspaceId: options.workspaceId,
          workRunId: options.workRunId,
          chatId: options.chatId,
          createdAt: new Date(now).toISOString(),
          expiresAt: sessionExpiry(now, idleTimeoutMs, hardExpiresAt),
          idleTimeoutMs,
          lastUsedAt: new Date(now).toISOString(),
          permissions: Object.freeze({
            ...options.permissions,
            grants: [...options.permissions.grants],
          }),
        },
        browser,
        context,
        tabs: new Map(),
        storagePath,
        providerSessionId,
        releaseRemote,
        remoteHeartbeat,
        hardExpiresAt,
        onClosed: options.onClosed,
      };
      await audit(this.auditSink, session, "session.created", "success", { engine });
      if (!browser.isConnected()) throw new Error("Browser connection closed");
      this.#sessions.set(id, session);
      if (hardExpiresAt !== undefined) {
        session.deadlineTimer = setTimeout(
          () => {
            void this.close(id, options.ownerId, "time_limit").catch(() => undefined);
          },
          Math.max(0, hardExpiresAt - Date.now()),
        );
        session.deadlineTimer.unref();
      }
      browser.once("disconnected", () => {
        if (this.#sessions.has(id))
          void this.close(id, options.ownerId, "disconnected").catch(() => undefined);
      });
      return { ...session.descriptor };
    } catch (error) {
      clearInterval(remoteHeartbeat);
      await Promise.allSettled([
        browser?.close(),
        releaseRemote?.(),
        this.artifacts.removeSession(id),
      ]);
      throw error;
    }
  }

  get(sessionId: string, ownerId: string, touch = true) {
    const session = this.#sessions.get(sessionId);
    if (!session || session.descriptor.ownerId !== ownerId)
      throw runtimeError("session_not_found", "Browser session not found");
    if (this.expired(session)) {
      void this.close(sessionId, ownerId, "expired").catch(() => undefined);
      throw runtimeError("session_expired", "Browser session has expired");
    }
    if (touch) {
      const now = Date.now();
      session.descriptor.lastUsedAt = new Date(now).toISOString();
      session.descriptor.expiresAt = sessionExpiry(
        now,
        session.descriptor.idleTimeoutMs,
        session.hardExpiresAt,
      );
    }
    return session;
  }

  async close(sessionId: string, ownerId: string, reason = "requested") {
    const session = this.#sessions.get(sessionId);
    if (!session || session.descriptor.ownerId !== ownerId)
      throw runtimeError("session_not_found", "Browser session not found");
    if (session.closing) return session.closing;
    session.closing = (async () => {
      this.#sessions.delete(sessionId);
      clearInterval(session.remoteHeartbeat);
      clearTimeout(session.deadlineTimer);
      await Promise.allSettled([
        audit(this.auditSink, session, "session.closed", "success", { reason }),
        session.context.close(),
        session.browser.close(),
        session.releaseRemote?.(),
        this.artifacts.removeSession(sessionId),
        rm(session.storagePath, { recursive: true, force: true }),
      ]);
      await session.onClosed?.();
    })();
    return session.closing;
  }

  async sweep(now = Date.now()) {
    const expired = [...this.#sessions.values()].filter((session) => this.expired(session, now));
    await Promise.allSettled(
      expired.map((session) =>
        this.close(session.descriptor.id, session.descriptor.ownerId, "expired"),
      ),
    );
    return expired.length;
  }

  async shutdown() {
    clearInterval(this.#timer);
    await Promise.allSettled(
      [...this.#sessions.values()].map((session) =>
        this.close(session.descriptor.id, session.descriptor.ownerId, "shutdown"),
      ),
    );
  }

  private expired(session: RuntimeSession, now = Date.now()) {
    return now >= Date.parse(session.descriptor.expiresAt);
  }
}
