import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { readAccountIdentity } from "@/lib/account-identity.server.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import {
  authenticateDeveloper,
  developerDatabase,
  developerEnabled,
  developerFailure,
  developerJson,
  developerQuote,
  executeDeveloper,
  type DeveloperIdentity,
} from "./developer-platform.server";
import { withDeveloperBrowserChannel } from "./developer-browser-interactive.mjs";
import { developerBrowserEnabled } from "./developer-browser.server";
import { withDeveloperRealtimeEvents } from "./developer-realtime-policy.mjs";
import {
  createRealtimeConnection,
  parseRealtimeSessionRequest,
  realtimeGrant,
  realtimeOrigin,
  REALTIME_SOCKET_PATH,
  REALTIME_SOCKET_PROTOCOL,
} from "./developer-realtime-session.mjs";

type SessionKind = "realtime" | "browser";
export const BROWSER_SOCKET_PATH = "/api/developer/browser/socket";
export const BROWSER_SOCKET_PROTOCOL = "kova.browser.v1";
const sessionScope = (kind: SessionKind) => (kind === "browser" ? "cloud_browser" : "realtime");
function enabled(kind: SessionKind = "realtime") {
  if (kind === "browser")
    return (
      developerEnabled() &&
      developerBrowserEnabled() &&
      runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSION_SCHEMA_READY") === "true" &&
      runtimeEnv("KOVA_DEVELOPER_BROWSER_INTERACTIVE_ENABLED") === "true"
    );
  return (
    developerEnabled() &&
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_ENABLED") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSION_SCHEMA_READY") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSIONS_ENABLED") === "true" &&
    Boolean(runtimeEnv("OPENAI_API_KEY"))
  );
}
function requireEnabled(kind: SessionKind = "realtime") {
  if (!enabled(kind)) throw Error("developer_realtime_unavailable");
}
async function session(
  operation: string,
  id: string,
  input: Record<string, unknown>,
  kind: SessionKind = "realtime",
) {
  if (operation !== "disconnect") requireEnabled(kind);
  const db = developerDatabase();
  const { data, error } = await db
    .rpc("manage_developer_realtime_sessions_v1", {
      p_operation: operation,
      p_id: id,
      p_input: { ...input, session_kind: kind },
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (error || !data || data.id !== id) {
    const code = error?.message;
    throw Error(
      typeof code === "string" &&
        /^developer_(?:realtime_(?:not_found|invalid|quota_exceeded|conflict)|scope_required)$/.test(
          code,
        )
        ? code
        : "developer_realtime_unavailable",
    );
  }
  return { data, db };
}
async function rate(identity: string, action: string, limit: number) {
  if (!(await consumeApplicationRateLimit({ identity, action, limit, windowSeconds: 60 })).allowed)
    throw Error("developer_rate_limit");
}
function publicSession(data: Record<string, unknown>, kind: SessionKind) {
  return {
    object: kind === "browser" ? "browser.session" : "realtime.session",
    id: data.id,
    state: data.state,
    redeem_by: data.redeem_by,
    expires_at: data.expires_at,
    turns: data.turns,
    maximum_turns: kind === "browser" ? 1 : 8,
    transport: kind === "browser" ? BROWSER_SOCKET_PATH : REALTIME_SOCKET_PATH,
    protocol: kind === "browser" ? BROWSER_SOCKET_PROTOCOL : REALTIME_SOCKET_PROTOCOL,
  };
}
export async function handleDeveloperRealtimeSessions(
  request: Request,
  kind: SessionKind = "realtime",
) {
  try {
    requireEnabled(kind);
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes(sessionScope(kind)))
      throw Error("developer_scope_required");
    await rate(`developer:${identity.id}`, `developer_${kind}_sessions`, 12);
    if (
      request.method === "POST" &&
      request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json"
    )
      throw Error("developer_json_required");
    const parsed = parseRealtimeSessionRequest(
      request.method,
      new URL(request.url).searchParams,
      request.method === "POST"
        ? await readBoundedJsonObject(request, 2048, request.signal)
        : undefined,
    );
    const binding = {
      owner_id: identity.ownerId,
      api_key_id: identity.id,
      project_id: identity.project_id,
    };
    if (parsed.operation === "issue") {
      const grant = realtimeGrant();
      const { data } = await session(
        "issue",
        grant.id,
        {
          ...binding,
          origin: parsed.origin,
          grant_digest: grant.digest,
        },
        kind,
      );
      return developerJson({ ...publicSession(data, kind), client_secret: grant.token }, 201);
    }
    const { data } = await session(parsed.operation, parsed.id, binding, kind);
    return developerJson(publicSession(data, kind));
  } catch (error) {
    return developerFailure(error);
  }
}
async function socketIdentity(
  id: string,
  connection: string,
  operation = "check",
  turn?: string,
  kind: SessionKind = "realtime",
): Promise<DeveloperIdentity> {
  const { data, db } = await session(
    operation,
    id,
    {
      connection_id: connection,
      ...(turn ? { turn_id: turn } : {}),
    },
    kind,
  );
  if (!Array.isArray(data.capabilities) || !data.capabilities.includes(sessionScope(kind)))
    throw Error("developer_scope_required");
  if (!(await readAccountIdentity(db, data.owner_id)))
    throw Error("developer_realtime_unauthorized");
  await assertLockdownAllows(db, data.owner_id, "agent");
  return {
    id: data.api_key_id,
    account_id: data.account_id,
    project_id: data.project_id,
    ownerId: data.owner_id,
    capabilities:
      kind === "browser" && runtimeEnv("KOVA_DEVELOPER_COMPUTER_USE_ENABLED") !== "true"
        ? data.capabilities.filter((scope: string) => scope !== "computer_use")
        : data.capabilities,
    db,
  };
}
export function createDeveloperRealtimeSocket(
  origin: string | null,
  transport: {
    send: (event: Record<string, unknown>) => void;
    close: (code: number, reason: string) => void;
  },
  kind: SessionKind = "realtime",
) {
  requireEnabled(kind);
  const boundOrigin = realtimeOrigin(origin);
  return createRealtimeConnection<DeveloperIdentity>({
    ...transport,
    kind,
    claim: async (id, digest, connection) => {
      const { data } = await session(
        "claim",
        id,
        {
          grant_digest: digest,
          connection_id: connection,
          origin: boundOrigin,
        },
        kind,
      );
      try {
        await socketIdentity(id, connection, "check", undefined, kind);
        return { id, expiresAt: Date.parse(data.expires_at) };
      } catch (error) {
        await session("disconnect", id, { connection_id: connection }, kind).catch(() => {});
        throw error;
      }
    },
    check: (id, connection) => socketIdentity(id, connection, "check", undefined, kind),
    quote: async (identity, input) => {
      await rate(`developer:${identity.id}`, `developer_${kind}_socket_quote`, 30);
      return developerQuote(identity, kind, input);
    },
    begin: async (id, connection, turn) => {
      try {
        return await socketIdentity(id, connection, "begin", turn, kind);
      } catch (error) {
        await session("disconnect", id, { connection_id: connection }, kind).catch(() => {});
        throw error;
      }
    },
    execute: async (identity, input, key, token, signal, delta, channel) => {
      await rate(`developer:${identity.id}`, `developer_${kind}_socket_turn`, 16);
      const run = async () => {
        const response = await executeDeveloper(identity, kind, input, key, token, signal);
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Error("developer_realtime_unavailable");
        }
        return response.json();
      };
      if (kind === "browser") {
        if (!channel) throw Error("developer_browser_session_required");
        return withDeveloperBrowserChannel(channel, run);
      }
      return withDeveloperRealtimeEvents(delta, run);
    },
    prepareComputer: async (identity, view, fields, signal) => {
      signal.throwIfAborted();
      await rate(`developer:${identity.id}`, "developer_browser_computer_quote", 12);
      if (
        view.width !== 840 ||
        view.height !== 540 ||
        typeof view.screenshot !== "string" ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(view.screenshot) ||
        view.screenshot.length > 350000
      )
        throw Error("developer_computer_invalid");
      const { default: sharp } = await import("sharp");
      const source = sharp(Buffer.from(view.screenshot.split(",")[1], "base64"), {
        limitInputPixels: 840 * 540,
      });
      const metadata = await source.metadata();
      if (metadata.width !== 840 || metadata.height !== 540 || metadata.format !== "jpeg")
        throw Error("developer_computer_invalid");
      const image = await source
        .resize(420, 270, { fit: "fill" })
        .png({ palette: true, colours: 64 })
        .toBuffer();
      if (image.length > 32768) throw Error("developer_computer_invalid");
      signal.throwIfAborted();
      const input = { ...fields, screenshot: "data:image/png;base64," + image.toString("base64") };
      return { input, quote: await developerQuote(identity, "computer-use", input) };
    },
    executeComputer: async (identity, input, key, token, signal) => {
      signal.throwIfAborted();
      await rate(`developer:${identity.id}`, "developer_browser_computer_turn", 8);
      signal.throwIfAborted();
      const response = await executeDeveloper(identity, "computer-use", input, key, token, signal);
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw Error("developer_computer_unavailable");
      }
      return response.json();
    },
    finish: (id, connection, turn) =>
      session("finish", id, { connection_id: connection, turn_id: turn }, kind),
    disconnect: (id, connection) => session("disconnect", id, { connection_id: connection }, kind),
  });
}
export function developerRealtimeSessionsEnabled(kind: SessionKind = "realtime") {
  return enabled(kind);
}
