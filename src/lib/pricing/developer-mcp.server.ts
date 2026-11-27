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
  executeDeveloperFileSearch,
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
const model = { type: "string", minLength: 2, maxLength: 80 };
const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const integer = (maximum: number) => ({ type: "integer", minimum: 1, maximum });
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const fileSearchTool = {
  name: "kova_search_files",
  fileOperation: "search",
  scope: "files",
  description:
    "Search up to four explicitly selected private developer text files in this project. Returns source snippets, not generated answers. No inference quote is required.",
  inputSchema: objectSchema(
    {
      query: text(256),
      file_ids: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        uniqueItems: true,
        items: { type: "string", format: "uuid" },
      },
      limit: integer(10),
    },
    ["query", "file_ids"],
  ),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
};
const paidTools = [
  { name: "kova_generate_text", operation: "responses", scope: "chat", schema: inputSchema },
  {
    name: "kova_generate_image",
    operation: "images",
    scope: "image_generation",
    schema: inputSchema,
  },
  { name: "kova_embed", operation: "embeddings", scope: "embeddings", schema: inputSchema },
  {
    name: "kova_search",
    operation: "search",
    scope: "chat",
    schema: objectSchema(
      { model, query: text(8000), max_output_tokens: integer(32768), max_tool_calls: integer(3) },
      ["model", "query", "max_output_tokens", "max_tool_calls"],
    ),
  },
  {
    name: "kova_moderate",
    operation: "moderations",
    scope: "moderation",
    schema: objectSchema({ model, input: text(8000) }, ["model", "input"]),
  },
  {
    name: "kova_decide",
    operation: "decisions",
    scope: "decisions",
    schema: objectSchema(
      {
        model,
        input: text(16000),
        questions: {
          type: "array",
          minItems: 1,
          maxItems: 16,
          items: {
            type: "object",
            properties: {
              type: { enum: ["predicate", "choice", "score"] },
              name: text(64),
              instructions: text(2000),
              choices: {
                type: "array",
                minItems: 2,
                maxItems: 10,
                items: objectSchema(
                  {
                    value: { anyOf: [{ type: "string", maxLength: 160 }, { type: "boolean" }] },
                    description: text(500),
                  },
                  ["value"],
                ),
              },
              levels: {
                type: "array",
                minItems: 2,
                maxItems: 10,
                items: objectSchema({ label: text(160), description: text(500) }, ["label"]),
              },
            },
            required: ["type", "name", "instructions"],
            additionalProperties: false,
          },
        },
      },
      ["model", "input", "questions"],
    ),
  },
  {
    name: "kova_analyze",
    operation: "analysis",
    scope: "file_analysis",
    schema: objectSchema(
      {
        model,
        input: text(16000),
        max_output_tokens: integer(2048),
        file_ids: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          uniqueItems: true,
          items: { type: "string", format: "uuid" },
        },
      },
      ["model", "input", "max_output_tokens"],
    ),
  },
  {
    name: "kova_speech",
    operation: "audio/speech",
    scope: "audio_speech",
    schema: objectSchema(
      { model, input: text(1000), voice: { const: "default" }, response_format: { const: "mp3" } },
      ["model", "input", "voice"],
    ),
  },
  {
    name: "kova_browse",
    operation: "browser",
    scope: "cloud_browser",
    schema: objectSchema(
      {
        model,
        url: { ...text(2048), format: "uri" },
        navigate: {
          type: "array",
          minItems: 1,
          maxItems: 2,
          uniqueItems: true,
          items: { ...text(2048), format: "uri" },
        },
      },
      ["model", "url"],
    ),
  },
  {
    name: "kova_propose_computer_action",
    operation: "computer-use",
    scope: "computer_use",
    schema: objectSchema(
      {
        model,
        input: text(8000),
        screenshot: { ...text(50000), pattern: "^data:image/png;base64," },
        max_output_tokens: integer(2048),
      },
      ["model", "input", "screenshot", "max_output_tokens"],
    ),
  },
  {
    name: "kova_agent_turn",
    operation: "agent-turns",
    scope: "chat",
    schema: objectSchema(
      { agent_id: { type: "string", format: "uuid" }, version: integer(20), input: text(16000) },
      ["agent_id", "version", "input"],
    ),
  },
];
function definitionsForScopes(scopes: string[]) {
  const permitted = paidTools.filter((tool) => scopes.includes(tool.scope));
  return [
    ...[...developerFileTools, fileSearchTool].filter((tool) => scopes.includes(tool.scope)),
    ...(permitted.length
      ? [
          {
            name: "kova_quote",
            description:
              "Create a two-minute signed maximum-price quote for an authorized operation. This does not spend credit. Model eligibility and feature gates apply.",
            inputSchema: objectSchema(
              {
                operation: { enum: permitted.map((tool) => tool.operation) },
                input: { type: "object" },
              },
              ["operation", "input"],
            ),
            annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
          },
        ]
      : []),
    ...permitted.map(({ schema, ...tool }) => ({
      ...tool,
      description: `Execute ${tool.operation} with a previously accepted signed quote and a unique retry key; this spends prepaid API credit. Model eligibility and feature gates apply.`,
      inputSchema: objectSchema({ input: schema, quoteToken: text(32768), requestKey: text(128) }, [
        "input",
        "quoteToken",
        "requestKey",
      ]),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    })),
  ];
}
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
    const body = await readBoundedJsonObject(request, 70000, request.signal);
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
    const definitions = definitionsForScopes(identity.capabilities);
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
        tools: definitions.map(({ name, description, inputSchema, annotations }) => ({
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
      if (
        tool.name === "kova_quote" &&
        !paidTools.some(
          (item) => item.operation === args.operation && identity.capabilities.includes(item.scope),
        )
      )
        return error(-32602, "Tool scope unavailable");
      if (!("fileOperation" in tool)) {
        const allowed =
          tool.name === "kova_quote"
            ? ["operation", "input"]
            : ["input", "quoteToken", "requestKey"];
        if (
          Object.keys(args).length !== allowed.length ||
          allowed.some((key) => !Object.hasOwn(args, key))
        )
          return error(-32602, "Invalid tool arguments");
        if (
          tool.name !== "kova_quote" &&
          (typeof args.quoteToken !== "string" || typeof args.requestKey !== "string")
        )
          return error(-32602, "Invalid tool arguments");
      }
      try {
        if (
          args.input &&
          typeof args.input === "object" &&
          (args.input as Record<string, unknown>).stream === true
        )
          throw new Error("developer_mcp_stream_invalid");
        request.signal.throwIfAborted();
        let output: unknown;
        if ("fileOperation" in tool) {
          output =
            tool.fileOperation === "search"
              ? await executeDeveloperFileSearch(identity, args, request.signal)
              : await executeDeveloperMcpFile(identity, tool.fileOperation, args);
        } else if (tool.name === "kova_quote") {
          output = await developerQuote(identity, String(args.operation), args.input);
        } else {
          const response = await executeDeveloper(
            identity,
            "operation" in tool ? tool.operation : "",
            args.input,
            String(args.requestKey ?? ""),
            typeof args.quoteToken === "string" ? args.quoteToken : null,
            request.signal,
          );
          if (!response.ok) {
            await response.body?.cancel().catch(() => {});
            throw new Error("developer_provider_unavailable");
          }
          output = await response.json();
        }
        request.signal.throwIfAborted();
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
