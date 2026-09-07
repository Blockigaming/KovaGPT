import {
  authenticateMcpOAuth,
  mcpOAuthResponseHeaders,
  mcpOAuthAnonymousChallenge,
} from "./mcp-oauth.server";
import {
  authenticateDeveloper,
  developerFailure,
  developerJson,
  developerQuote,
  executeDeveloper,
} from "./developer-platform.server";
import { readBoundedJsonObject } from "@/lib/bounded-json.server.mjs";
import { developerFileTools, executeDeveloperMcpFile } from "./developer-mcp-files.server";
const versions = ["2025-11-25", "2025-03-26"];
const inputSchema = {
  type: "object",
  properties: {
    model: { type: "string" },
    input: {
      anyOf: [
        { type: "string" },
        {
          type: "array",
          maxItems: 100,
          items: { anyOf: [{ type: "string" }, { type: "object" }] },
        },
      ],
    },
    instructions: { type: "string" },
    file_ids: { type: "array", maxItems: 4, items: { type: "string", format: "uuid" } },
    max_output_tokens: { type: "integer", minimum: 1, maximum: 32768 },
    prompt: { type: "string" },
    n: { type: "integer", minimum: 1, maximum: 4 },
    size: { type: "string" },
    quality: { enum: ["low", "medium", "high"] },
    dimensions: { type: "integer", minimum: 1, maximum: 4096 },
    tools: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        properties: {
          type: { const: "function" },
          name: { type: "string" },
          description: { type: "string" },
          parameters: { type: "object" },
          strict: { const: true },
        },
        required: ["type", "name", "parameters", "strict"],
        additionalProperties: false,
      },
    },
    tool_choice: {
      anyOf: [
        { enum: ["auto", "none", "required"] },
        {
          type: "object",
          properties: { type: { const: "function" }, name: { type: "string" } },
          required: ["type", "name"],
          additionalProperties: false,
        },
      ],
    },
    parallel_tool_calls: { type: "boolean" },
    text: {
      type: "object",
      properties: {
        format: {
          type: "object",
          properties: {
            type: { const: "json_schema" },
            name: { type: "string" },
            description: { type: "string" },
            strict: { const: true },
            schema: { type: "object" },
          },
          required: ["type", "name", "strict", "schema"],
          additionalProperties: false,
        },
      },
      required: ["format"],
      additionalProperties: false,
    },
  },
  required: ["model"],
};
const definitions = [
  ...developerFileTools,
  {
    name: "kova_quote",
    description:
      "Create a two-minute signed maximum-price quote. This does not start generation or spend credit.",
    inputSchema: {
      type: "object",
      properties: {
        operation: { enum: ["responses", "images", "embeddings"] },
        input: inputSchema,
      },
      required: ["operation", "input"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  ...[
    ["kova_generate_text", "responses", "chat"],
    ["kova_generate_image", "images", "image_generation"],
    ["kova_embed", "embeddings", "embeddings"],
  ].map(([name, operation, scope]) => ({
    name,
    operation,
    scope,
    description: `Execute ${operation} with a previously accepted signed quote and a unique retry key; this spends prepaid API credit.`,
    inputSchema: {
      type: "object",
      properties: {
        input: inputSchema,
        quoteToken: { type: "string" },
        requestKey: { type: "string", maxLength: 128 },
      },
      required: ["input", "quoteToken", "requestKey"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  })),
];
export async function handleDeveloperMcp(request: Request) {
  const challenge = mcpOAuthAnonymousChallenge(request);
  if (challenge) return challenge;
  return mcpOAuthResponseHeaders(request, await handleMcpMessage(request));
}
async function handleMcpMessage(request: Request) {
  try {
    const identity = request.headers.get("authorization")?.startsWith("Bearer kmcp_")
      ? await authenticateMcpOAuth(request)
      : await authenticateDeveloper(request);
    const protocol = request.headers.get("mcp-protocol-version");
    if (protocol && !versions.includes(protocol))
      return developerJson({ error: "unsupported_protocol_version" }, 400);
    if (request.method !== "POST")
      return new Response(null, {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      });
    if (request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json")
      return developerJson({ error: "json_required" }, 415);
    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("application/json") || !accept.includes("text/event-stream"))
      return developerJson({ error: "mcp_accept_required" }, 406);
    const body = await readBoundedJsonObject(request, 70000);
    const id = body.id;
    const error = (code: number, message: string) =>
      developerJson({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
    if (
      body.jsonrpc !== "2.0" ||
      typeof body.method !== "string" ||
      (id !== undefined && typeof id !== "string" && !Number.isSafeInteger(id))
    )
      return error(-32600, "Invalid request");
    if (id === undefined)
      return body.method === "notifications/initialized"
        ? new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } })
        : error(-32600, "Notification unsupported");
    const params = body.params as Record<string, unknown> | undefined;
    let result: unknown;
    if (body.method === "initialize") {
      const negotiated =
        typeof params?.protocolVersion === "string" && versions.includes(params.protocolVersion)
          ? params.protocolVersion
          : versions[0];
      result = {
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: { name: "KovaGPT Developer MCP", version: "1.0.0" },
        instructions:
          "Authenticate with owner-approved OAuth access or a scoped KovaGPT developer bearer key. Quote before execution; use a stable unique requestKey when retrying.",
      };
    } else if (body.method === "ping") result = {};
    else if (body.method === "tools/list")
      result = {
        tools: definitions
          .filter((tool) => !("scope" in tool) || identity.capabilities.includes(tool.scope))
          .map(({ name, description, inputSchema, annotations }) => ({
            name,
            description,
            inputSchema,
            annotations,
          })),
      };
    else if (body.method === "tools/call") {
      const tool = definitions.find((item) => item.name === params?.name);
      const args = params?.arguments as Record<string, unknown> | undefined;
      if (!tool || !args || typeof args !== "object" || Array.isArray(args))
        return error(-32602, "Invalid tool arguments");
      if ("scope" in tool && !identity.capabilities.includes(tool.scope))
        return error(-32602, "Tool scope unavailable");
      try {
        if (
          args.input &&
          typeof args.input === "object" &&
          (args.input as Record<string, unknown>).stream === true
        )
          throw new Error("developer_mcp_stream_invalid");
        const output =
          "fileOperation" in tool
            ? await executeDeveloperMcpFile(identity, tool.fileOperation, args)
            : tool.name === "kova_quote"
              ? await developerQuote(identity, String(args.operation), args.input)
              : await (
                  await executeDeveloper(
                    identity,
                    "operation" in tool ? tool.operation : "",
                    args.input,
                    String(args.requestKey ?? ""),
                    typeof args.quoteToken === "string" ? args.quoteToken : null,
                    request.signal,
                  )
                ).json();
        result = {
          content: [{ type: "text", text: JSON.stringify(output) }],
          structuredContent: output,
        };
      } catch (cause) {
        const failure = await developerFailure(cause).json();
        result = { isError: true, content: [{ type: "text", text: failure.error.message }] };
      }
    } else return error(-32601, "Method not found");
    return developerJson({ jsonrpc: "2.0", id, result });
  } catch (error) {
    return developerFailure(error);
  }
}
