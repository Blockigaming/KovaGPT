import { DEVELOPER_ENDPOINTS } from "./developer-reference.mjs";

const str = (maxLength = 32000) => ({ type: "string", minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
const choices = (...values) => ({ enum: values });
const arr = (items, maxItems, minItems = 1) => ({ type: "array", items, minItems, maxItems });
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const union = (...schemas) => ({ oneOf: schemas });
const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean" };
const model = { ...str(80), minLength: 2, pattern: "^[a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)*$" };
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const name = { ...str(64), pattern: "^[A-Za-z0-9_-]+$" };
const quoteToken = { ...str(2048), pattern: "^[A-Za-z0-9_-]+\\.[a-f0-9]{64}$" };
const role = choices("user", "assistant", "system", "developer");
const effort = choices("none", "minimal", "low", "medium", "high", "xhigh");
const revision = integer(0, 200);
const fileIds = { ...arr(uuid, 4), uniqueItems: true };
const conversation = obj({ id: uuid, revision });
const png = { ...str(50000), pattern: "^data:image/png;base64," };
const nativeObject = { type: "object", additionalProperties: true };
const jsonSchema = {
  ...nativeObject,
  description:
    "Bounded JSON Schema subset; all object properties required, additionalProperties false, local references only. Server validates nesting and size.",
};
const functionTool = obj(
  {
    type: choices("function"),
    name,
    description: str(2000),
    parameters: jsonSchema,
    strict: { const: true },
  },
  ["type", "name", "parameters", "strict"],
);
const responseInput = union(str(), arr(nativeObject, 100));
const responses = obj(
  {
    model,
    input: responseInput,
    max_output_tokens: integer(1, 32768),
    instructions: str(8000),
    stream: boolean,
    tools: union(
      arr(functionTool, 32, 0),
      arr(obj({ type: choices("web_search"), search_context_size: choices("low") }), 1),
    ),
    max_tool_calls: integer(1, 3),
    reasoning: obj({ effort }),
    text: obj({
      format: obj(
        {
          type: choices("json_schema"),
          name,
          strict: { const: true },
          schema: jsonSchema,
          description: str(2000),
        },
        ["type", "name", "strict", "schema"],
      ),
    }),
    tool_choice: union(
      choices("auto", "none", "required"),
      obj({ type: choices("function"), name }),
    ),
    parallel_tool_calls: boolean,
    file_ids: fileIds,
    conversation,
  },
  ["model", "input", "max_output_tokens"],
);
const chatFields = {
  model,
  messages: arr(obj({ role, content: str() }), 100),
  stream: boolean,
  reasoning_effort: effort,
};
const chat = union(
  ...["max_tokens", "max_completion_tokens"].map((key) =>
    obj({ ...chatFields, [key]: integer(1, 32768) }, ["model", "messages", key]),
  ),
);
const decisionBase = { name, instructions: str(2000) };
const question = union(
  obj({ ...decisionBase, type: choices("predicate") }),
  obj({
    ...decisionBase,
    type: choices("choice"),
    choices: arr(obj({ value: union(str(160), boolean), description: str(500) }, ["value"]), 10, 2),
  }),
  obj({
    ...decisionBase,
    type: choices("score"),
    levels: arr(obj({ label: str(160), description: str(500) }, ["label"]), 10, 2),
  }),
);
const paid = {
  responses,
  "chat/completions": chat,
  images: obj(
    {
      model,
      prompt: str(16000),
      n: integer(1, 4),
      size: { type: "string", pattern: "^(auto|[0-9]{3,4}x[0-9]{3,4})$" },
      quality: choices("low", "medium", "high"),
      image: png,
    },
    ["model", "prompt", "size", "quality"],
  ),
  embeddings: obj(
    { model, input: union(str(8000), arr(str(8000), 32)), dimensions: integer(1, 4096) },
    ["model", "input"],
  ),
  moderations: obj({ model, input: str(8000) }),
  search: obj({
    model,
    query: str(8000),
    max_output_tokens: integer(1, 32768),
    max_tool_calls: integer(1, 3),
  }),
  decisions: obj({ model, input: str(16000), questions: arr(question, 16) }),
  "agent-turns": obj(
    {
      agent_id: uuid,
      version: integer(1, 20),
      input: str(16000),
      skills: arr(obj({ id: uuid, version: integer(1, 20) }), 4),
      conversation,
    },
    ["agent_id", "version", "input"],
  ),
  analysis: obj(
    { model, input: str(16000), max_output_tokens: integer(1, 2048), file_ids: fileIds },
    ["model", "input", "max_output_tokens"],
  ),
  "computer-use": obj({
    model,
    input: str(8000),
    screenshot: png,
    max_output_tokens: integer(1, 2048),
  }),
  browser: obj(
    {
      model,
      url: { ...str(2048), format: "uri", pattern: "^https://" },
      navigate: {
        type: "array",
        minItems: 1,
        maxItems: 2,
        uniqueItems: true,
        items: { ...str(2048), format: "uri", pattern: "^https://" },
        description: "Additional distinct pages on the same approved origin.",
      },
    },
    ["model", "url"],
  ),
  "audio/transcriptions": obj({
    model,
    audio: { type: "string", pattern: "^data:audio/wav;base64," },
  }),
  "audio/translations": obj({
    model,
    audio: { ...str(640000), contentEncoding: "base64" },
    target_language: choices("en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh"),
  }),
  realtime: union(
    obj({
      model,
      input: str(1000),
      output_modality: choices("text", "audio"),
      max_output_tokens: integer(1, 512),
    }),
    obj({
      model,
      audio: {
        type: "string",
        contentEncoding: "base64",
        maxLength: 320000,
        description: "24 kHz mono PCM16 raw bytes, 0.1–5 seconds.",
      },
      output_modality: choices("text", "audio"),
      max_output_tokens: integer(1, 512),
    }),
  ),
  "audio/speech": obj(
    { model, input: str(1000), voice: choices("default"), response_format: choices("mp3") },
    ["model", "input", "voice"],
  ),
};
const op = (operation, fields, required = Object.keys(fields)) =>
  obj({ operation: choices(operation), ...fields }, ["operation", ...required]);
const vector = arr({ type: "number", minimum: -1000000, maximum: 1000000 }, 1536);
const vectorEntry = {
  entry_id: { ...str(80), pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
  vector,
  text: str(2048),
  file_id: uuid,
};
const entryRequired = ["entry_id", "vector", "text"];
const definition = (fields) =>
  union(
    op("create", { id: uuid, definition: fields }),
    op("update", { id: uuid, definition: fields, expected_version: integer(1, 19) }),
  );
const {
  file_ids: _files,
  conversation: _conversation,
  max_tool_calls: _calls,
  ...backgroundFields
} = responses.properties;
const background = obj(
  {
    ...backgroundFields,
    input: union(str(), arr(nativeObject, 16)),
    max_output_tokens: integer(1, 2048),
    stream: { const: false },
    tools: arr(functionTool, 4),
  },
  responses.required,
);
const batchInputs = {
  "chat/completions": obj(
    {
      ...chatFields,
      messages: arr(obj({ role, content: str(8000) }), 16),
      max_completion_tokens: integer(1, 2048),
      stream: { const: false },
    },
    ["model", "messages", "max_completion_tokens"],
  ),
  "agent-turns": paid["agent-turns"],
  responses: background,
  moderations: paid.moderations,
  embeddings: obj({
    model,
    input: union(str(8000), arr(str(8000), 2)),
    dimensions: integer(1, 1024),
  }),
  decisions: paid.decisions,
  search: obj({ ...paid.search.properties, max_output_tokens: integer(1, 2048) }),
  analysis: obj({ model, input: str(16000), max_output_tokens: integer(1, 2048) }),
};
const budget = {
  id: uuid,
  currency,
  maximum_charge: { type: "number", exclusiveMinimum: 0, maximum: 1000000 },
};
const batch = (scheduled, research = false) => {
  const inputs = research ? { search: paid.search } : batchInputs;
  const item = union(
    ...Object.entries(inputs).map(([operation, input]) =>
      obj(
        {
          id: uuid,
          operation: choices(operation),
          input,
          quote_token: quoteToken,
          ...(scheduled ? { run_at: { type: "string", format: "date-time" } } : {}),
        },
        [
          "id",
          "input",
          "quote_token",
          ...(operation === "chat/completions" ? [] : ["operation"]),
          ...(scheduled ? ["run_at"] : []),
        ],
      ),
    ),
  );
  return union(
    op("create", { ...budget, items: arr(item, research ? 4 : 8, research ? 2 : 1) }),
    op("cancel", { id: uuid }),
    ...(scheduled ? [op("pause", { id: uuid }), op("resume", { id: uuid })] : []),
  );
};
const bodies = {
  ...paid,
  "realtime-sessions": obj({ origin: { ...str(512), format: "uri", pattern: "^https://" } }, []),
  quotes: union(...Object.entries(paid).map(([operation, input]) => op(operation, { input }))),
  files: obj({
    filename: { ...str(125), pattern: "^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\\.(txt|md|csv|json)$" },
    mimeType: choices("text/plain", "text/markdown", "text/csv", "application/json"),
    text: str(32768),
  }),
  "file-search": obj({ query: str(256), file_ids: fileIds, limit: integer(1, 10) }, [
    "query",
    "file_ids",
  ]),
  "vector-stores": union(
    op("create", { name: str(80), model, dimensions: integer(1, 1536) }),
    op("upsert", { store_id: uuid, model, ...vectorEntry }, [
      "store_id",
      "model",
      ...entryRequired,
    ]),
    op("upsert_batch", { store_id: uuid, model, entries: arr(obj(vectorEntry, entryRequired), 8) }),
    op("search", { store_id: uuid, model, vector, limit: integer(1, 20) }, [
      "store_id",
      "model",
      "vector",
    ]),
  ),
  conversations: union(
    op("create", { id: uuid, title: str(160) }),
    op("append", {
      id: uuid,
      expected_revision: revision,
      item: obj({ id: uuid, role, content: str(8192) }),
    }),
    op("remove", { id: uuid, expected_revision: revision, item_id: uuid }),
  ),
  agents: definition(
    obj({ name: str(160), model, instructions: str(8000), max_output_tokens: integer(1, 8192) }),
  ),
  skills: definition(obj({ name: str(160), description: str(512), instructions: str(4000) })),
  webhooks: union(
    op("create", {
      id: uuid,
      url: { ...str(1024), format: "uri" },
      events: { ...arr(choices("request.settled", "request.rejected"), 2), uniqueItems: true },
    }),
    op("rotate", { id: uuid, expected_generation: integer(1, 999) }),
    op("test", { id: uuid, event_id: uuid }),
  ),
  batches: batch(false),
  automations: batch(true),
  "research-runs": batch(false, true),
  "response-jobs": union(
    op("create", { ...budget, input: background, quote_token: quoteToken }),
    op("cancel", { id: uuid }),
  ),
};
const query = {
  "realtime-sessions": { id: uuid },
  models: { id: model },
  usage: { id: uuid, limit: integer(1, 100), offset: integer(0, 10000) },
  files: { id: uuid, page: integer(0, 4) },
  "vector-stores": {
    id: uuid,
    entries: { const: "true" },
    page: integer(0, 19),
    entry_id: vectorEntry.entry_id,
  },
  conversations: { id: uuid, item_id: uuid },
  agents: { id: uuid, version: integer(1, 20) },
  skills: { id: uuid, version: integer(1, 20) },
  webhooks: { id: uuid, deliveries: { const: "true" } },
  batches: { id: uuid, item_id: uuid },
  automations: { id: uuid, item_id: uuid },
  "research-runs": { id: uuid },
  "response-jobs": { id: uuid },
};
const open = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: true,
});
const list = (data) => open({ object: { const: "list" }, data: { type: "array", items: data } });
const output = {
  "realtime-sessions": open(
    {
      object: { const: "realtime.session" },
      id: uuid,
      state: choices("issued", "connected", "closed"),
      redeem_by: str(80),
      expires_at: str(80),
      turns: integer(0, 8),
      maximum_turns: { const: 8 },
      transport: { const: "/api/developer/realtime/socket" },
      protocol: { const: "kova.realtime.v1" },
      client_secret: str(90),
    },
    [
      "object",
      "id",
      "state",
      "redeem_by",
      "expires_at",
      "turns",
      "maximum_turns",
      "transport",
      "protocol",
    ],
  ),
  quotes: obj({
    quoteToken,
    pricingVersion: str(160),
    currency,
    maximumCharge: { type: "number", minimum: 0 },
    expiresAt: { type: "integer" },
  }),
  models: list(
    open({
      id: model,
      capability: str(80),
      reasoning_efforts: { type: "array", items: effort },
      web_search: boolean,
      inline_image_input: boolean,
      image_edits: boolean,
    }),
  ),
  responses: open(
    { id: str(256), model, status: str(64), output: { type: "array", items: nativeObject } },
    ["id", "model", "output"],
  ),
  "chat/completions": open({
    id: str(256),
    object: choices("chat.completion"),
    model,
    choices: { type: "array", items: nativeObject },
  }),
  embeddings: open({
    object: { const: "list" },
    model,
    data: {
      type: "array",
      items: open({
        index: { type: "integer" },
        embedding: { type: "array", items: { type: "number" } },
      }),
    },
  }),
  images: open({ data: { type: "array", items: nativeObject } }),
  moderations: open({ id: str(256), model, results: { type: "array", items: nativeObject } }),
  realtime: open(
    {
      id: str(256),
      model,
      status: choices("completed", "incomplete", "cancelled", "failed"),
      usage: nativeObject,
      text: { type: "string" },
      audio: { type: "string", contentEncoding: "base64" },
      transcript: { type: "string" },
      format: { const: "pcm16" },
      sample_rate: { const: 24000 },
    },
    ["id", "model", "status", "usage"],
  ),
  "audio/speech": open({
    id: str(256),
    model,
    audio: { type: "string", contentEncoding: "base64" },
    format: { const: "mp3" },
    generated: { const: true },
    usage: open({ speech_character_credits: { type: "integer", minimum: 0 } }),
  }),
  "audio/translations": open({
    id: str(256),
    model,
    status: { const: "completed" },
    target_language: str(2),
    text: { type: "string" },
    audio: { type: "string", contentEncoding: "base64" },
    format: { const: "pcm16" },
    sample_rate: { const: 24000 },
    usage: open({
      translation_seconds: { type: "number", minimum: 0.2, maximum: 10 },
      accounting: { const: "closed_input_frames" },
    }),
  }),
  "audio/transcriptions": open({
    id: str(256),
    model,
    text: { type: "string" },
    usage: nativeObject,
  }),
  analysis: open({ id: str(256), model, text: { type: "string" }, usage: nativeObject }),
  "file-search": open({
    object: { const: "list" },
    search_type: { const: "lexical" },
    offset_unit: { const: "unicode_code_point" },
    data: {
      type: "array",
      items: open({
        file_id: uuid,
        filename: str(125),
        content_digest: str(64),
        start: { type: "integer" },
        end: { type: "integer" },
        score: { type: "number" },
        snippet: { type: "string" },
      }),
    },
  }),
  decisions: open({
    model,
    answers: {
      type: "array",
      items: open({ name, type: choices("predicate", "choice", "score", "refusal") }),
    },
    usage: nativeObject,
  }),
  "computer-use": open({
    id: str(256),
    object: { const: "computer.proposal" },
    model,
    screenshot: open({ width: { type: "integer" }, height: { type: "integer" } }),
    requires_human_review: { const: true },
    status: choices("complete", "proposed", "blocked"),
    actions: { type: "array", items: nativeObject, maxItems: 1 },
    text: { type: "string" },
    usage: nativeObject,
  }),
  browser: open({
    id: uuid,
    object: { const: "browser.snapshot" },
    navigation: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: obj({ url: str(2048), title: str(180), text: str(10000) }),
    },
    url: { type: "string", format: "uri" },
    title: { type: "string" },
    text: { type: "string" },
    screenshot: { type: "string" },
    observed_at: { type: "string", format: "date-time" },
    model,
    usage: open({ browser_sessions_60s: { const: 1 } }),
  }),
  "agent-turns": open({ id: str(256), model, output: { type: "array", items: nativeObject } }),
  search: open({ id: str(256), model, output: { type: "array", items: nativeObject } }),
};
const amount = { type: ["number", "string", "null"] };
const usageRow = open({
  id: uuid,
  public_model: model,
  capability: str(80),
  currency,
  settlement_state: str(80),
  maximum_reserved_charge: amount,
  final_customer_charge: amount,
  created_at: { type: "string", format: "date-time" },
  settled_at: { type: ["string", "null"] },
  ...Object.fromEntries(
    [
      "input_tokens",
      "cached_input_tokens",
      "image_input_tokens",
      "output_tokens",
      "web_search_calls",
      "moderation_requests",
      "transcription_seconds",
      "speech_character_credits",
      "translation_seconds",
      "realtime_text_input_tokens",
      "realtime_cached_text_tokens",
      "realtime_audio_input_tokens",
      "realtime_cached_audio_tokens",
      "realtime_text_output_tokens",
      "realtime_audio_output_tokens",
      "container_1g_sessions",
      "browser_sessions_60s",
    ].map((key) => [key, { type: ["number", "null"], minimum: 0 }]),
  ),
});
output.usage = union(
  open({
    object: { const: "usage" },
    data: usageRow,
    amount_unit: { const: "currency_minor_unit" },
  }),
  open({
    object: { const: "list" },
    data: { type: "array", items: usageRow },
    has_more: boolean,
    next_offset: { type: ["integer", "null"] },
    amount_unit: { const: "currency_minor_unit" },
  }),
);
const error = obj({ error: open({ code: str(128), message: str(1024) }) });
const header = (name, schema, required, description) => ({
  name,
  in: "header",
  schema,
  required,
  description,
});
const json = (schema) => ({ "application/json": { schema } });
export function developerOpenApi() {
  const paths = {};
  for (const entry of DEVELOPER_ENDPOINTS) {
    const key = entry.path.slice("/api/v1/".length);
    const methods = {};
    for (const method of entry.methods) {
      const parameters = [];
      if (method === "GET" || method === "DELETE") {
        const fields =
          method === "GET"
            ? query[key]
            : { id: uuid, ...(key === "vector-stores" ? { entry_id: vectorEntry.entry_id } : {}) };
        for (const [name, schema] of Object.entries(fields ?? {}))
          parameters.push({
            name,
            in: "query",
            schema,
            required: (method === "DELETE" || key === "realtime-sessions") && name === "id",
          });
      }
      if (method === "POST" && paid[key])
        parameters.push(
          header(
            "X-Kova-Quote",
            quoteToken,
            true,
            "Unexpired signed quote for exact operation and input.",
          ),
        );
      if (method === "POST" && (paid[key] || key === "files" || key === "vector-stores"))
        parameters.push(
          header(
            "Idempotency-Key",
            str(128),
            key !== "vector-stores",
            "Stable retry key; required for paid execution, uploads and vector store creation.",
          ),
        );
      const schema =
        output[key] ??
        open(
          {
            id: uuid,
            object: str(80),
            status: str(80),
            data: { type: "array", items: nativeObject },
            deleted: boolean,
          },
          [],
        );
      const content = json(schema);
      if (["responses", "chat/completions"].includes(key))
        content["text/event-stream"] = {
          schema: { type: "string" },
          description: "When stream is true; inspect terminal events.",
        };
      const responses = {
        200: {
          description:
            "Successful operation; response shape depends on operation and provider contract.",
          content,
        },
        default: {
          description:
            "Rejected, unavailable or uncertain request. Inspect the error code before retrying.",
          content: json(error),
        },
      };
      for (const status of ["400", "401", "403", "404", "409", "413", "429", "503"])
        responses[status] = {
          description: "Request rejected or service unavailable; inspect the structured error.",
          content: json(error),
        };
      if (
        method === "POST" &&
        [
          "files",
          "vector-stores",
          "conversations",
          "agents",
          "skills",
          "realtime-sessions",
        ].includes(key)
      )
        responses["201"] = { description: "Resource created.", content };
      if (
        method === "POST" &&
        ["batches", "automations", "research-runs", "response-jobs", "webhooks"].includes(key)
      )
        responses["202"] = {
          description: "Accepted for asynchronous work; not proof of completion or settlement.",
          content,
        };
      const requestBody =
        method === "POST" ? { required: true, content: json(bodies[key]) } : undefined;
      if (requestBody && key === "files")
        requestBody.content["multipart/form-data"] = {
          schema: obj({
            file: {
              type: "string",
              format: "binary",
              description: "Single UTF-8 text file, up to 32 KiB.",
            },
          }),
        };
      methods[method.toLowerCase()] = {
        operationId: method.toLowerCase() + "_" + key.replace(/[^a-z0-9]/g, "_"),
        summary: entry.title,
        description: entry.request + " " + entry.behavior,
        security: [{ DeveloperKey: [] }],
        ...(parameters.length ? { parameters } : {}),
        ...(requestBody ? { requestBody } : {}),
        responses,
      };
    }
    paths[entry.path] = methods;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "KovaGPT developer API",
      version: "1.0.0-preview",
      description:
        "Source contract preview, not activation or price approval. Server-side byte limits, model contracts, ownership, cross-field rules and settlement checks remain authoritative. Provider and resource response schemas describe stable fields, not every possible field.",
    },
    servers: [{ url: "https://kovagpt.com" }],
    paths,
    components: {
      securitySchemes: {
        DeveloperKey: {
          type: "http",
          scheme: "bearer",
          description: "Scoped server-side developer API key.",
        },
      },
    },
  };
}
