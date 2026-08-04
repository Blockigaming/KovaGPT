import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { chromium, firefox, webkit } from "playwright";
import { audit } from "./audit";
import { runtimeError } from "./errors";
import { authorizeNavigationRequest } from "./permissions";
import type {
  AuditSink,
  BrowserEngine,
  CreateSessionOptions,
  EngineProvider,
  PermissionPolicy,
  RuntimeSession,
} from "./types";
import { BrowserArtifactStore } from "./artifacts";

const DEFAULT_LIFETIME_MS = 30 * 60_000;
const DEFAULT_IDLE_MS = 5 * 60_000;

export class PlaywrightEngineProvider implements EngineProvider {
  get(engine: BrowserEngine) {
    return { chromium, firefox, webkit }[engine];
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
    const now = Date.now();
    const engine = options.engine ?? "chromium";
    const storagePath = await this.artifacts.initializeSession(id);
    let browser;
    try {
      // A process per session is intentional: contexts isolate cookies/storage while the
      // process boundary prevents accidental cross-user browser reuse.
      browser = await this.engines.get(engine).launch({ headless: true });
      const context = await browser.newContext({
        acceptDownloads: false,
        serviceWorkers: "block",
      });
      const permissions = freezePermissions(options.permissions);
      await context.route("**/*", async (route) => {
        const request = route.request();
        if (request.isNavigationRequest() && request.resourceType() === "document") {
          try {
            await authorizeNavigationRequest(permissions, request.url());
          } catch {
            await route.abort("blockedbyclient");
            return;
          }
        }
        await route.continue();
      });
      const session: RuntimeSession = {
        descriptor: {
          id,
          engine,
          ownerId: options.ownerId,
          workspaceId: options.workspaceId,
          workRunId: options.workRunId,
          chatId: options.chatId,
          createdAt: new Date(now).toISOString(),
          expiresAt: new Date(now + (options.lifetimeMs ?? DEFAULT_LIFETIME_MS)).toISOString(),
          idleTimeoutMs: options.idleTimeoutMs ?? DEFAULT_IDLE_MS,
          lastUsedAt: new Date(now).toISOString(),
          permissions,
        },
        browser,
        context,
        tabs: new Map(),
        storagePath,
      };
      this.#sessions.set(id, session);
      await audit(this.auditSink, session, "session.created", "success", { engine });
      return { ...session.descriptor };
    } catch (error) {
      await browser?.close();
      await this.artifacts.removeSession(id);
      throw error;
    }
  }

  get(sessionId: string, ownerId: string) {
    const session = this.#sessions.get(sessionId);
    if (!session || session.descriptor.ownerId !== ownerId)
      throw runtimeError("session_not_found", "Browser session not found");
    if (this.expired(session)) {
      void this.close(sessionId, ownerId, "expired");
      throw runtimeError("session_expired", "Browser session has expired");
    }
    session.descriptor.lastUsedAt = new Date().toISOString();
    return session;
  }

  async close(sessionId: string, ownerId: string, reason = "requested") {
    const session = this.#sessions.get(sessionId);
    if (!session || session.descriptor.ownerId !== ownerId)
      throw runtimeError("session_not_found", "Browser session not found");
    if (session.closing) return session.closing;
    session.closing = (async () => {
      this.#sessions.delete(sessionId);
      try {
        await audit(this.auditSink, session, "session.closed", "success", { reason });
      } finally {
        await Promise.allSettled([session.context.close(), session.browser.close()]);
        await this.artifacts.removeSession(sessionId);
        await rm(session.storagePath, { recursive: true, force: true });
      }
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
    return (
      now >= Date.parse(session.descriptor.expiresAt) ||
      now - Date.parse(session.descriptor.lastUsedAt) >= session.descriptor.idleTimeoutMs
    );
  }
}

function freezePermissions(policy: PermissionPolicy): Readonly<PermissionPolicy> {
  return Object.freeze({
    ...policy,
    grants: Object.freeze([...policy.grants]),
    allowedOrigins: policy.allowedOrigins ? Object.freeze([...policy.allowedOrigins]) : undefined,
    deniedOrigins: policy.deniedOrigins ? Object.freeze([...policy.deniedOrigins]) : undefined,
  });
}
