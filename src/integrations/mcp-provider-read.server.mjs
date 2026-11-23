import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createBoundedProviderStream,
  readProviderJsonObject,
} from "../lib/provider-response.server.mjs";
import { CONNECTION_FLOWS, TANA_MCP_RESOURCE } from "./connection-flows.mjs";
import { approvedMcpServers, fetchApprovedMcp } from "./approved-mcp-servers.server.mjs";
import { unpackKeyCredential } from "./key-connection-credential.server.mjs";

const PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION, "2025-06-18", "2025-03-26"]);
const MAX_REPLY_BYTES = 256_000;
const MAX_TOOL_PAGES = 4;

function parseRpcMessage(value, expectedId) {
  if (value?.jsonrpc !== "2.0" || value.id !== expectedId || value.method !== undefined)
    throw new Error("invalid_mcp_response");
  if (
    value.error ||
    !value.result ||
    typeof value.result !== "object" ||
    Array.isArray(value.result)
  )
    throw new Error("mcp_request_failed");
  return value.result;
}

async function readRpcSse(response, expectedId, signal) {
  const stream = await createBoundedProviderStream(response, MAX_REPLY_BYTES, signal);
  if (!stream) throw new Error("invalid_mcp_response");
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffered = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error("invalid_mcp_response");
      buffered += decoder.decode(value, { stream: true });
      const messages = buffered.split(/\r?\n\r?\n/u);
      buffered = messages.pop();
      for (const message of messages) {
        const data = message
          .split(/\r?\n/u)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /u, ""))
          .join("\n");
        if (!data) continue;
        const payload = JSON.parse(data);
        // Ignore notifications. An MCP server cannot prompt this client to
        // make other requests, call tools, or interact with the user.
        if (payload?.id === undefined) continue;
        return parseRpcMessage(payload, expectedId);
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function createMcpClient({ url, token, fetchImpl, beforeRequest }) {
  if (typeof token !== "string" || !/^[A-Za-z0-9._~+\/=-]{8,8192}$/u.test(token))
    throw new Error("invalid_connection_credential");
  const signal = AbortSignal.timeout(14_000);
  let version;
  let session;
  async function send(method, params, notification = false) {
    const id = notification ? undefined : randomUUID();
    await beforeRequest?.();
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(version ? { "MCP-Protocol-Version": version } : {}),
        ...(session ? { "Mcp-Session-Id": session } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", method, id, params }),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      const errors = {
        401: "connection_reauthorization_required",
        403: "connection_permission_required",
        429: "connection_rate_limited",
      };
      throw new Error(errors[response.status] ?? "mcp_request_failed");
    }
    if (notification) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status !== 202 && response.status !== 204)
        throw new Error("invalid_mcp_response");
      return;
    }
    if (method === "initialize") {
      session = response.headers.get("mcp-session-id");
      if (session !== null && !/^[!-~]{1,128}$/u.test(session)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("invalid_mcp_response");
      }
    }
    const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (type === "text/event-stream") return readRpcSse(response, id, signal);
    if (type !== "application/json") {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("invalid_mcp_response");
    }
    return parseRpcMessage(await readProviderJsonObject(response, MAX_REPLY_BYTES), id);
  }
  return {
    send,
    async start() {
      const result = await send("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "KovaGPT", version: "1.0.0" },
      });
      if (!SUPPORTED_VERSIONS.has(result.protocolVersion) || !result.capabilities?.tools)
        throw new Error("mcp_tools_unavailable");
      version = result.protocolVersion;
      await send("notifications/initialized", undefined, true);
    },
    async close() {
      if (!session || !version || signal.aborted) return;
      try {
        await beforeRequest?.();
        const response = await fetchImpl(url, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
            "MCP-Protocol-Version": version,
            "Mcp-Session-Id": session,
          },
          redirect: "error",
          signal: AbortSignal.any([signal, AbortSignal.timeout(1_000)]),
        });
        await response.body?.cancel();
      } catch {
        // Session cleanup is best-effort. A revoked grant sends no more traffic.
      }
    },
  };
}

async function findTool(client, name) {
  let cursor;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const list = await client.send("tools/list", cursor ? { cursor } : {});
    if (!Array.isArray(list.tools)) throw new Error("invalid_mcp_response");
    const matches = list.tools.filter((tool) => tool?.name === name);
    if (matches.length > 1) throw new Error("mcp_tool_changed");
    const tool = matches[0];
    if (tool) return tool;
    if (
      typeof list.nextCursor !== "string" ||
      !list.nextCursor ||
      list.nextCursor.length > 512 ||
      list.nextCursor === cursor
    )
      break;
    cursor = list.nextCursor;
  }
  throw new Error("connection_permission_required");
}

async function findReadTool(client, { tool: name, queryField, isTana }) {
  const tool = await findTool(client, name);
  const schema = tool.inputSchema;
  const parameter = schema?.properties?.[queryField];
  const required = schema?.required ?? [];
  if (
    tool.annotations?.destructiveHint === true ||
    (isTana ? tool.annotations?.readOnlyHint === false : tool.annotations?.readOnlyHint !== true) ||
    schema?.type !== "object" ||
    !Object.hasOwn(schema.properties ?? {}, queryField) ||
    !Array.isArray(required) ||
    required.some((name) => name !== queryField) ||
    (isTana
      ? parameter?.type !== "array" || parameter.items?.type !== "string"
      : parameter?.type !== "string")
  )
    throw new Error("mcp_tool_changed");
}

const TANA_CONFIG = {
  url: TANA_MCP_RESOURCE,
  tool: "searchItems",
  queryField: "queries",
  isTana: true,
};

async function readMcpTool(config, token, query, fetchImpl, beforeRequest) {
  const client = createMcpClient({ url: config.url, token, fetchImpl, beforeRequest });
  try {
    await client.start();
    await findReadTool(client, config);
    const value = config.isTana ? [query] : query;
    const result = await client.send("tools/call", {
      name: config.tool,
      arguments: { [config.queryField]: value },
    });
    if (result.isError || !Array.isArray(result.content)) throw new Error("mcp_tool_read_failed");
    const content = result.content.filter(
      (item) => item?.type === "text" && typeof item.text === "string",
    );
    const texts = content.length ? content.map((item) => item.text) : [];
    if (!texts.length && result.structuredContent && typeof result.structuredContent === "object") {
      texts.push(JSON.stringify(result.structuredContent));
    }
    return {
      service: CONNECTION_FLOWS[config.isTana ? "tana" : "custom-mcp"].label,
      results: texts.slice(0, 10).map((snippet, index) => ({
        id: String(index + 1),
        title: config.isTana ? "Tana search result" : "MCP read result",
        snippet: snippet.slice(0, 2_000),
        url: null,
      })),
      limited:
        texts.length > 10 ||
        texts.some((value) => value.length > 2_000) ||
        result.content.length > content.length,
    };
  } finally {
    await client.close();
  }
}

export async function verifyTanaRead(token, fetchImpl = fetch, beforeRequest) {
  await readMcpTool(TANA_CONFIG, token, "Kova connection check", fetchImpl, beforeRequest);
}

function assertTanaArguments(value, depth = 0) {
  if (depth > 8) throw new Error("invalid_tana_proposal");
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "constructor", "prototype", "autoapprove"].includes(key.toLowerCase()))
      throw new Error("invalid_tana_proposal");
    assertTanaArguments(child, depth + 1);
  }
}

async function withTanaProposalTool(token, fetchImpl, beforeRequest, useTool) {
  const client = createMcpClient({ url: TANA_MCP_RESOURCE, token, fetchImpl, beforeRequest });
  try {
    await client.start();
    const tool = await findTool(client, "createItems");
    const schema = tool.inputSchema;
    if (
      tool.annotations?.readOnlyHint === true ||
      tool.annotations?.destructiveHint === true ||
      schema?.type !== "object" ||
      !schema.properties ||
      Array.isArray(schema.properties) ||
      JSON.stringify(schema).length > 16_000
    )
      throw new Error("mcp_tool_changed");
    return await useTool(client, schema);
  } finally {
    await client.close();
  }
}

export function tanaProposalSchema(token, fetchImpl = fetch, beforeRequest) {
  return withTanaProposalTool(token, fetchImpl, beforeRequest, (_client, schema) =>
    JSON.stringify(schema, (key, value) => (key === "description" ? undefined : value), 2),
  );
}

export async function runTanaProposal(token, argumentsJson, fetchImpl = fetch, beforeRequest) {
  const input = JSON.parse(argumentsJson);
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("invalid_tana_proposal");
  assertTanaArguments(input);
  return withTanaProposalTool(token, fetchImpl, beforeRequest, async (client, schema) => {
    if (Object.keys(input).some((key) => !Object.hasOwn(schema.properties, key)))
      throw new Error("invalid_tana_proposal");
    const args = Object.hasOwn(schema.properties, "autoApprove")
      ? { ...input, autoApprove: false }
      : input;
    if (!z.fromJSONSchema(schema).safeParse(args).success) throw new Error("invalid_tana_proposal");
    const result = await client.send("tools/call", { name: "createItems", arguments: args });
    if (result.isError === true) return null;
    let session = result.structuredContent?.sessionUri;
    if (!session && Array.isArray(result.content)) {
      for (const entry of result.content.slice(0, 6)) {
        if (entry?.type !== "text" || typeof entry.text !== "string" || entry.text.length > 16_000)
          continue;
        try {
          session = JSON.parse(entry.text)?.sessionUri;
        } catch {
          continue;
        }
        if (session) break;
      }
    }
    return typeof session === "string" &&
      /^(?:tana:|https:\/\/(?:home\.)?tana\.inc\/)[!-~]{1,220}$/u.test(session)
      ? session
      : null;
  });
}

export async function runReviewedMcpWrite(
  credential,
  operation,
  text,
  beforeRequest,
  transport = fetchApprovedMcp,
) {
  if (typeof text !== "string" || !text.trim() || text.length > 2000)
    throw new Error("invalid_connection_query");
  const { apiKey, serverId, writeFingerprint } = unpackKeyCredential("custom-mcp", credential);
  const server = approvedMcpServers().get(serverId);
  const write = server?.write;
  if (!write || write.fingerprint !== writeFingerprint || operation !== write.tool)
    throw new Error("connection_permission_required");
  const client = createMcpClient({
    url: server.url,
    token: apiKey,
    fetchImpl: transport,
    beforeRequest,
  });
  try {
    await client.start();
    const tool = await findTool(client, write.tool);
    const schema = tool.inputSchema;
    if (
      tool.annotations?.readOnlyHint !== false ||
      tool.annotations?.destructiveHint !== false ||
      schema?.type !== "object" ||
      Object.keys(schema.properties ?? {}).length !== 1 ||
      !Object.hasOwn(schema.properties, write.field) ||
      schema.properties[write.field]?.type !== "string" ||
      !Array.isArray(schema.required) ||
      schema.required.length !== 1 ||
      schema.required[0] !== write.field
    )
      throw new Error("mcp_tool_changed");
    const result = await client.send("tools/call", {
      name: write.tool,
      arguments: { [write.field]: text },
    });
    return result.isError !== true && result.structuredContent?.ok === true;
  } finally {
    await client.close();
  }
}

export function readMcpConnection(
  id,
  query,
  credential,
  fetchImpl,
  beforeRequest,
  customTransport = fetchApprovedMcp,
) {
  if (
    typeof query !== "string" ||
    !query.trim() ||
    query.length > 300 ||
    /[\u0000-\u001f\u007f]/u.test(query)
  )
    throw new Error("invalid_connection_query");
  if (id === "tana")
    return readMcpTool(TANA_CONFIG, credential, query.trim(), fetchImpl, beforeRequest);
  const { apiKey, serverId, bindingHash } = unpackKeyCredential(id, credential);
  const config = approvedMcpServers().get(serverId);
  if (!config || config.fingerprint !== bindingHash)
    throw new Error("connection_changed_or_expired");
  return readMcpTool(config, apiKey, query.trim(), customTransport, beforeRequest);
}
