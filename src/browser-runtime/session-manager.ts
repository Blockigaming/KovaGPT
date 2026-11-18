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
    const storagePath = await this.artifacts.initializeSession(id);
    let browser;
    let releaseRemote: (() => Promise<void>) | undefined;
    try {
      // A process per session is intentional: contexts isolate cookies/storage while the
      // process boundary prevents accidental cross-user browser reuse.
      const apiKey = process.env.BROWSERBASE_API_KEY?.trim();
      const projectId = process.env.BROWSERBASE_PROJECT_ID?.trim();
      if (apiKey || projectId) {
        if (!apiKey || !projectId || engine !== "chromium") {
          throw new Error("Browserbase requires a configured Chromium project");
        }
        const headers = { "X-BB-API-Key": apiKey, "Content-Type": "application/json" };
        const sessionsUrl = "https://api.browserbase.com/v1/sessions";
        const response = await fetch(sessionsUrl, {
          method: "POST",
          headers,
          redirect: "error",
          body: JSON.stringify({
            projectId,
            keepAlive: false,
            ...(options.readOnly ? { timeout: 960 } : {}),
            browserSettings: { recordSession: false, logSession: false, solveCaptchas: false },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw new Error("Browserbase session creation failed");
        const session = await response.json();
        if (typeof session.id !== "string" || !/^[a-f0-9-]{36}$/i.test(session.id)) {
          throw new Error("Invalid Browserbase session ID");
        }
        releaseRemote = async () => {
          await fetch(`${sessionsUrl}/${session.id}`, {
            method: "POST",
            headers,
            redirect: "error",
            body: JSON.stringify({ projectId, status: "REQUEST_RELEASE" }),
            signal: AbortSignal.timeout(5000),
          });
        };
        const connection = new URL(session.connectUrl);
        if (
          connection.protocol !== "wss:" ||
          connection.hostname !== "connect.browserbase.com" ||
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
      const now = Date.now();
      const session: RuntimeSession = {
        descriptor: {
          id,
          engine,
          ownerId: options.ownerId,
          workspaceId: options.workspaceId,
          workRunId: options.workRunId,
          chatId: options.chatId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + (options.idleTimeoutMs ?? DEFAULT_IDLE_MS)).toISOString(),
          idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_MS,
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
        releaseRemote,
        onClosed: options.onClosed,
      };
      await audit(this.auditSink, session, "session.created", "success", { engine });
      if (!browser.isConnected()) throw new Error("Browser connection closed");
      this.#sessions.set(id, session);
      browser.once("disconnected", () => {
        if (this.#sessions.has(id))
          void this.close(id, options.ownerId, "disconnected").catch(() => undefined);
      });
      return { ...session.descriptor };
    } catch (error) {
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
      session.descriptor.expiresAt = new Date(now + session.descriptor.idleTimeoutMs).toISOString();
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
