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
import { withDeveloperRealtimeEvents } from "./developer-realtime-policy.mjs";
import {
  createRealtimeConnection,
  parseRealtimeSessionRequest,
  realtimeGrant,
  realtimeOrigin,
  REALTIME_SOCKET_PATH,
  REALTIME_SOCKET_PROTOCOL,
} from "./developer-realtime-session.mjs";

function enabled() {
  return (
    developerEnabled() &&
    runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_ENABLED") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSION_SCHEMA_READY") === "true" &&
    runtimeEnv("KOVA_DEVELOPER_REALTIME_SESSIONS_ENABLED") === "true" &&
    Boolean(runtimeEnv("OPENAI_API_KEY"))
  );
}
function requireEnabled() {
  if (!enabled()) throw Error("developer_realtime_unavailable");
}
async function session(operation: string, id: string, input: Record<string, unknown>) {
  if (operation !== "disconnect") requireEnabled();
  const db = developerDatabase();
  const { data, error } = await db
    .rpc("manage_developer_realtime_sessions_v1", {
      p_operation: operation,
      p_id: id,
      p_input: input,
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
function publicSession(data: Record<string, unknown>) {
  return {
    object: "realtime.session",
    id: data.id,
    state: data.state,
    redeem_by: data.redeem_by,
    expires_at: data.expires_at,
    turns: data.turns,
    maximum_turns: 8,
    transport: REALTIME_SOCKET_PATH,
    protocol: REALTIME_SOCKET_PROTOCOL,
  };
}
export async function handleDeveloperRealtimeSessions(request: Request) {
  try {
    requireEnabled();
    const identity = await authenticateDeveloper(request);
    if (!identity.capabilities.includes("realtime")) throw Error("developer_scope_required");
    await rate(`developer:${identity.id}`, "developer_realtime_sessions", 12);
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
      const { data } = await session("issue", grant.id, {
        ...binding,
        origin: parsed.origin,
        grant_digest: grant.digest,
      });
      return developerJson({ ...publicSession(data), client_secret: grant.token }, 201);
    }
    const { data } = await session(parsed.operation, parsed.id, binding);
    return developerJson(publicSession(data));
  } catch (error) {
    return developerFailure(error);
  }
}
async function socketIdentity(
  id: string,
  connection: string,
  operation = "check",
  turn?: string,
): Promise<DeveloperIdentity> {
  const { data, db } = await session(operation, id, {
    connection_id: connection,
    ...(turn ? { turn_id: turn } : {}),
  });
  if (!Array.isArray(data.capabilities) || !data.capabilities.includes("realtime"))
    throw Error("developer_scope_required");
  if (!(await readAccountIdentity(db, data.owner_id)))
    throw Error("developer_realtime_unauthorized");
  await assertLockdownAllows(db, data.owner_id, "agent");
  return {
    id: data.api_key_id,
    account_id: data.account_id,
    project_id: data.project_id,
    ownerId: data.owner_id,
    capabilities: data.capabilities,
    db,
  };
}
export function createDeveloperRealtimeSocket(
  origin: string | null,
  transport: {
    send: (event: Record<string, unknown>) => void;
    close: (code: number, reason: string) => void;
  },
) {
  requireEnabled();
  const boundOrigin = realtimeOrigin(origin);
  return createRealtimeConnection<DeveloperIdentity>({
    ...transport,
    claim: async (id, digest, connection) => {
      const { data } = await session("claim", id, {
        grant_digest: digest,
        connection_id: connection,
        origin: boundOrigin,
      });
      try {
        await socketIdentity(id, connection);
        return { id, expiresAt: Date.parse(data.expires_at) };
      } catch (error) {
        await session("disconnect", id, { connection_id: connection }).catch(() => {});
        throw error;
      }
    },
    check: (id, connection) => socketIdentity(id, connection),
    quote: async (identity, input) => {
      await rate(`developer:${identity.id}`, "developer_realtime_socket_quote", 30);
      return developerQuote(identity, "realtime", input);
    },
    begin: async (id, connection, turn) => {
      try {
        return await socketIdentity(id, connection, "begin", turn);
      } catch (error) {
        await session("disconnect", id, { connection_id: connection }).catch(() => {});
        throw error;
      }
    },
    execute: async (identity, input, key, token, signal, delta) => {
      await rate(`developer:${identity.id}`, "developer_realtime_socket_turn", 16);
      return withDeveloperRealtimeEvents(delta, async () => {
        const response = await executeDeveloper(identity, "realtime", input, key, token, signal);
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw Error("developer_realtime_unavailable");
        }
        return response.json();
      });
    },
    finish: (id, connection, turn) =>
      session("finish", id, { connection_id: connection, turn_id: turn }),
    disconnect: (id, connection) => session("disconnect", id, { connection_id: connection }),
  });
}
export function developerRealtimeSessionsEnabled() {
  return enabled();
}
