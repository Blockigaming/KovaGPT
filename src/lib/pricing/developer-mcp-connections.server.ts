import { developerRateError } from "./developer-http-errors.mjs";
import { approvedMcpServers } from "@/integrations/approved-mcp-servers.server.mjs";
import { unpackKeyCredential } from "@/integrations/key-connection-credential.server.mjs";
import { decryptCredential } from "@/integrations/credential-vault.server";
import { readMcpConnection } from "@/integrations/mcp-provider-read.server.mjs";
import { runtimeEnv } from "@/lib/runtime-env.server";
import { consumeApplicationRateLimit } from "@/lib/distributed-rate-limit.server";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { developerUuid } from "./developer-platform-policy.mjs";
import {
  authenticateDeveloper,
  developerDatabase,
  developerEnabled,
  developerFailure,
  developerJson,
  type DeveloperIdentity,
} from "./developer-platform.server";

const schemaReady = () =>
  runtimeEnv("KOVA_DEVELOPER_WORKSPACE_V2") === "true" &&
  runtimeEnv("KOVA_DEVELOPER_MCP_CONNECTIONS_SCHEMA_READY") === "true";
export const developerMcpReadEnabled = () =>
  schemaReady() &&
  runtimeEnv("KOVA_DEVELOPER_MCP_CONNECTIONS_ENABLED") === "true" &&
  approvedMcpServers().size > 0;
const fail = (code = "developer_mcp_connection_invalid"): never => {
  throw new Error(code);
};
const exact = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
async function manage(
  db: ReturnType<typeof developerDatabase>,
  owner: string,
  project: string,
  key: string | null,
  operation: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { data, error } = await db
    .rpc("manage_developer_mcp_connections_v1", {
      p_owner: owner,
      p_project: project,
      p_key: key,
      p_operation: operation,
      p_input: input,
    })
    .abortSignal(AbortSignal.any([signal, AbortSignal.timeout(5000)]));
  if (error || !data)
    fail(
      error?.message?.match(
        /^developer_(?:mcp_connection_(?:invalid|not_found|quota_exceeded)|scope_required)$/,
      )?.[0] ?? "developer_mcp_connection_unavailable",
    );
  return data;
}
function currentServer(row: { server_id: string; tool_name: string; binding_hash: string }) {
  const server = approvedMcpServers().get(row.server_id);
  return server && server.fingerprint === row.binding_hash && server.tool === row.tool_name
    ? server
    : null;
}
export async function manageOwnerMcpConnections(
  db: ReturnType<typeof developerDatabase>,
  owner: string,
  project: string,
  operation: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  if (!schemaReady()) fail("developer_mcp_connection_unavailable");
  if (operation === "revoke")
    return manage(db, owner, project, null, "revoke", { id: developerUuid(input.id) }, signal);
  const list = await manage(db, owner, project, null, "owner_list", {}, signal);
  const accounts = (
    list.accounts as { id: string; server_id: string; account_label: string }[]
  ).flatMap((row) => {
    const config = approvedMcpServers().get(row.server_id);
    return config
      ? [
          {
            ...row,
            tool_name: config.tool,
            binding: config.fingerprint,
            origin: new URL(config.url).origin,
          },
        ]
      : [];
  });
  if (operation === "owner_list")
    return { enabled: developerMcpReadEnabled(), accounts, keys: list.keys, grants: list.grants };
  if (operation !== "grant" || !developerMcpReadEnabled() || input.approved !== true) fail();
  const account = accounts.find(
    (row) => row.id === input.linkedAccountId && row.binding === input.binding,
  );
  if (!account) return fail("developer_mcp_connection_not_found");
  return manage(
    db,
    owner,
    project,
    null,
    "grant",
    {
      id: developerUuid(input.id),
      keyId: developerUuid(input.keyId),
      linkedAccountId: account.id,
      binding: account.binding,
      serverId: account.server_id,
      tool: account.tool_name,
      approved: true,
    },
    signal,
  );
}
export async function executeDeveloperMcpConnection(
  identity: DeveloperIdentity,
  operation: "list" | "invoke",
  input: Record<string, unknown>,
  signal: AbortSignal,
) {
  if (!developerEnabled() || !developerMcpReadEnabled())
    fail("developer_mcp_connection_unavailable");
  if (!identity.capabilities.includes("mcp_read")) fail("developer_scope_required");
  await assertLockdownAllows(identity.db, identity.ownerId, "connector_read");
  const rate = await consumeApplicationRateLimit({
    identity: `developer:${identity.id}`,
    action: "developer_mcp_read",
    limit: 10,
    windowSeconds: 60,
  });
  const rateError = developerRateError(rate);
  if (rateError) throw rateError;
  const rpc = (op: string, data: Record<string, unknown>) =>
    manage(identity.db, identity.ownerId, identity.project_id, identity.id, op, data, signal);
  if (operation === "list") {
    if (!exact(input, [])) fail();
    const rows = await rpc("list", {});
    return {
      object: "list",
      data: (
        rows as {
          id: string;
          server_id: string;
          tool_name: string;
          binding_hash: string;
          expires_at: string;
        }[]
      ).flatMap((row) =>
        currentServer(row)
          ? [
              {
                id: row.id,
                server_id: row.server_id,
                tool_name: row.tool_name,
                expires_at: row.expires_at,
                read_only: true,
              },
            ]
          : [],
      ),
    };
  }
  if (
    operation !== "invoke" ||
    !exact(input, ["id", "tool", "query", "approved"]) ||
    input.approved !== true ||
    typeof input.tool !== "string" ||
    typeof input.query !== "string" ||
    !input.query.trim() ||
    input.query.length > 300 ||
    /[\u0000-\u001f\u007f]/u.test(input.query)
  )
    return fail();
  const binding = { id: developerUuid(input.id), tool: input.tool };
  const row = await rpc("authorize", binding);
  if (!currentServer(row)) fail("developer_mcp_connection_not_found");
  const credential = await decryptCredential(row.credential);
  const unpacked = unpackKeyCredential("custom-mcp", credential);
  if (unpacked.serverId !== row.server_id || unpacked.bindingHash !== row.binding_hash)
    fail("developer_mcp_connection_not_found");
  const ownerRate = await consumeApplicationRateLimit({
    identity: `user:${identity.ownerId}`,
    action: "developer_mcp_external_read",
    limit: 20,
    windowSeconds: 60,
  });
  const ownerRateError = developerRateError(ownerRate);
  if (ownerRateError) throw ownerRateError;
  const beforeRequest = async () => {
    signal.throwIfAborted();
    if (!developerMcpReadEnabled()) fail("developer_mcp_connection_unavailable");
    const active = await rpc("authorize", binding);
    if (
      !currentServer(active) ||
      active.credential !== row.credential ||
      active.binding_hash !== row.binding_hash
    )
      fail("developer_mcp_connection_not_found");
    signal.throwIfAborted();
  };
  try {
    const result = await readMcpConnection(
      "custom-mcp",
      input.query,
      credential,
      undefined,
      beforeRequest,
      undefined,
      signal,
    );
    await beforeRequest();
    return {
      object: "mcp.read_result",
      id: binding.id,
      tool: binding.tool,
      results: result.results.map((item) => ({
        ...item,
        snippet: item.snippet.replaceAll(unpacked.apiKey, "[redacted]"),
      })),
      limited: result.limited,
    };
  } catch {
    return fail("developer_mcp_connection_unavailable");
  }
}
export async function handleDeveloperMcpConnections(request: Request) {
  try {
    const identity = await authenticateDeveloper(request);
    if (new URL(request.url).search) fail();
    if (request.method === "GET")
      return developerJson(
        await executeDeveloperMcpConnection(identity, "list", {}, request.signal),
      );
    if (
      request.method !== "POST" ||
      request.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
    )
      fail();
    const input = await readBoundedJsonObject(request, 4096, request.signal);
    return developerJson(
      await executeDeveloperMcpConnection(identity, "invoke", input, request.signal),
    );
  } catch (error) {
    return developerFailure(error);
  }
}
