import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  createOpenAiServiceClient,
  createOpenAiServices,
  webSearchSources,
} from "../../src/lib/ai/openai-services.server.mjs";
import { createOpenAiServiceHandler } from "../../src/lib/ai/openai-service-handler.server.mjs";
import { createOpenAiWebhookHandler } from "../../src/lib/ai/openai-webhook.server.mjs";
import { hostedChatResult } from "../../src/lib/ai/hosted-chat-result.mjs";
import { consumeChatSse } from "../../src/lib/chat-sse-client.mjs";

const completed = (items = []) => ({
  status: "completed",
  output: [
    ...items,
    {
      type: "message",
      content: [{ type: "output_text", text: "Verified result", annotations: [] }],
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5 },
});
const services = (client) =>
  createOpenAiServices({ client, model: "gpt-5.6-luna", agentModel: "gpt-5.6-sol" });

test("web search requires a completed search and keeps only actual safe citations", async () => {
  const response = completed([
    { type: "web_search_call", status: "completed" },
    {
      type: "message",
      content: [
        {
          type: "output_text",
          annotations: [
            {
              type: "url_citation",
              url: "https://example.com/evidence#section",
              title: "Evidence",
            },
            { type: "url_citation", url: "javascript:alert(1)" },
            { type: "url_citation", url: "https://user:password@example.com/private" },
            { type: "url_citation", url: "https://example.com/evidence" },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(webSearchSources(response), [
    { url: "https://example.com/evidence", title: "Evidence" },
  ]);
  assert.throws(() => webSearchSources(completed()), /search_not_completed/);
  let sent;
  const result = await services({
    responses: {
      create: async (body) => {
        sent = body;
        return response;
      },
    },
  }).search("Example question");
  assert.equal(sent.model, "gpt-5.6-luna");
  assert.equal(sent.store, false);
  assert.equal(sent.tool_choice, "required");
  assert.equal(sent.tools[0].type, "web_search");
  assert.equal(result.sources.length, 1);
});

test("analysis rejects invalid inputs before compute and deletes only its own container after failure", async () => {
  const calls = [];
  const client = {
    containers: {
      create: async (body) => {
        calls.push(["create", body]);
        return { id: "cntr_owned" };
      },
      delete: async (id, options) => {
        calls.push(["delete", id, options.signal.aborted]);
      },
    },
    responses: { create: async () => ({ status: "failed", output: [] }) },
  };
  await assert.rejects(services(client).analyze("x".repeat(65537)), /invalid_service_input/);
  assert.equal(calls.length, 0);
  await assert.rejects(services(client).analyze("Calculate 2 + 2"), /incomplete_provider_response/);
  assert.equal(calls[0][1].memory_limit, "1g");
  assert.deepEqual(calls[0][1].network_policy, { type: "disabled" });
  assert.deepEqual(calls.at(-1), ["delete", "cntr_owned", false]);
});

test("successful analysis verifies execution belongs to the created container before returning text", async () => {
  let deleted = false;
  const client = {
    containers: {
      create: async () => ({ id: "cntr_owned" }),
      delete: async () => {
        deleted = true;
      },
    },
    responses: {
      create: async () =>
        completed([
          { type: "code_interpreter_call", status: "completed", container_id: "cntr_owned" },
        ]),
    },
  };
  const result = await services(client).analyze("Sum 1, 2, 3");
  assert.equal(result.toolCalls, 1);
  assert.equal(result.text, "Verified result");
  assert.equal(deleted, true);
  client.responses.create = async () =>
    completed([
      { type: "code_interpreter_call", status: "completed", container_id: "cntr_unowned" },
    ]);
  await assert.rejects(services(client).analyze("Sum 1, 2, 3"), /analysis_not_completed/);
});

test("file search bounds uploads and deletes the store before the uploaded file even on indexing failure", async () => {
  const calls = [];
  const client = {
    files: {
      create: async (body) => {
        calls.push(["upload", body.expires_after.seconds]);
        return { id: "file-owned" };
      },
      delete: async (id) => calls.push(["deleteFile", id]),
    },
    vectorStores: {
      create: async () => ({ id: "vs_owned" }),
      delete: async (id) => calls.push(["deleteStore", id]),
      files: { createAndPoll: async () => ({ status: "failed" }) },
    },
  };
  await assert.rejects(
    services(client).searchFiles("Find total", [{ name: "data", text: "Amount: 7" }]),
    /file_indexing_failed/,
  );
  assert.deepEqual(calls, [
    ["upload", 3600],
    ["deleteStore", "vs_owned"],
    ["deleteFile", "file-owned"],
  ]);
  calls.length = 0;
  await assert.rejects(
    services(client).searchFiles("Find total", [{ name: "data", text: "x".repeat(32001) }]),
    /invalid_service_input/,
  );
  assert.equal(calls.length, 0);
});

test("file search passes only newly owned IDs to OpenAI and returns a completed answer", async () => {
  let sent;
  const client = {
    files: { create: async () => ({ id: "file-owned" }), delete: async () => {} },
    vectorStores: {
      create: async () => ({ id: "vs_owned" }),
      delete: async () => {},
      files: {
        createAndPoll: async (id, body) => {
          assert.equal(id, "vs_owned");
          assert.equal(body.file_id, "file-owned");
          return { status: "completed" };
        },
      },
    },
    responses: {
      create: async (body) => {
        sent = body;
        return completed([{ type: "file_search_call", status: "completed" }]);
      },
    },
  };
  assert.equal(
    (await services(client).searchFiles("Find total", [{ name: "data", text: "Amount: 7" }])).text,
    "Verified result",
  );
  assert.deepEqual(sent.tools[0].vector_store_ids, ["vs_owned"]);
  assert.equal(sent.store, false);
});

test("cleanup uncertainty cannot be reported as successful execution", async () => {
  const pending = [];
  const provider = createOpenAiServices({
    model: "gpt-5.6-luna",
    reportCleanupFailure: (items) => pending.push(...items),
    client: {
      containers: {
        create: async () => ({ id: "cntr_owned" }),
        delete: async () => {
          throw new Error("unavailable");
        },
      },
      responses: {
        create: async () =>
          completed([
            { type: "code_interpreter_call", status: "completed", container_id: "cntr_owned" },
          ]),
      },
    },
  });
  await assert.rejects(provider.analyze("Calculate 1+1"), /provider_cleanup_unconfirmed/);
  assert.deepEqual(pending, [{ kind: "container", id: "cntr_owned" }]);
});

test("Decisions preserves named typed answers and refuses client model/tool injection", async () => {
  let sent,
    calls = 0;
  const provider = services({
    decisions: {
      create: async (body) => {
        sent = body;
        calls++;
        return {
          answers: [{ name: "is_blue", type: "predicate", probability: 0.9 }],
          usage: { input_tokens: 5 },
        };
      },
    },
  });
  const questions = [{ name: "is_blue", type: "predicate", instructions: "Is the object blue?" }];
  assert.equal((await provider.decisions("Blue object", questions)).answers[0].name, "is_blue");
  assert.equal(sent.model, "gpt-6-luna");
  await assert.rejects(
    provider.decisions("Blue object", [{ ...questions[0], tools: [] }]),
    /invalid_decision_questions/,
  );
  assert.equal(calls, 1);
});

function agentClient(
  events,
  final = {
    session_id: "session_owned",
    turn: { status: "completed" },
    output_text: "Actual answer",
  },
) {
  const calls = [];
  const stream = {
    withResultCollection() {},
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      yield* events;
    },
    async finalResult() {
      return final;
    },
  };
  return {
    calls,
    client: {
      beta: {
        agents: {
          sessions: {
            create: async (body) => {
              calls.push(["create", body]);
              return stream;
            },
            events: { create: async (id) => calls.push(["cancel", id]) },
            delete: async (id) => calls.push(["delete", id]),
          },
        },
      },
    },
  };
}
test("Agents requires the completed root turn and cleans its network-disabled sandbox session", async () => {
  const f = agentClient([
    { type: "agent.session.created", session: { id: "session_owned" } },
    { type: "agent.session.turn.completed", turn: { id: "turn_owned", subagent_id: null } },
  ]);
  assert.equal((await services(f.client).agent("Compute one result")).text, "Actual answer");
  const body = f.calls[0][1];
  assert.equal(body.agent.model, "gpt-5.6-sol");
  assert.equal(body.agent.multi_agent.enabled, false);
  assert.deepEqual(body.environment.network, { access: "disabled" });
  assert.deepEqual(f.calls.at(-1), ["delete", "session_owned"]);
  const broken = agentClient([{ type: "agent.session.created", session: { id: "session_owned" } }]);
  await assert.rejects(services(broken.client).agent("Compute one result"), /agent_incomplete/);
  assert.deepEqual(broken.calls.slice(-2), [
    ["cancel", "session_owned"],
    ["delete", "session_owned"],
  ]);
});

test("hosted browser requires real browser activity and only approves configured public origins", async () => {
  const events = [
    { type: "agent.session.created", session: { id: "session_owned" } },
    { type: "agent.session.requires_action" },
    {
      type: "agent.session.turn.item.done",
      item: { type: "computer_use_call", status: "completed" },
    },
    { type: "agent.session.turn.completed", turn: { id: "turn_owned", subagent_id: null } },
  ];
  const f = agentClient(events);
  const approvals = [];
  f.client.beta.agents.sessions.retrieve = async () => ({
    id: "session_owned",
    required_actions: [
      {
        type: "computer_use_approval_request",
        request_id: "approval_owned",
        request: { type: "browser_origin_access", origin: "https://developers.openai.com" },
      },
    ],
  });
  f.client.beta.agents.sessions.events.create = async (id, body) => approvals.push({ id, body });
  const service = (client, domains = ["developers.openai.com"]) =>
    createOpenAiServices({
      client,
      model: "gpt-5.6-luna",
      agentModel: "gpt-5.6-sol",
      browserDomains: domains,
    });
  const result = await service(f.client).browser("Read the public Agents documentation title");
  assert.equal(result.toolCalls, 1);
  assert.deepEqual(f.calls[0][1].environment.network, {
    access: "restricted",
    allowed_domains: ["developers.openai.com"],
  });
  assert.equal(f.calls[0][1].environment.desktop.enabled, true);
  assert.deepEqual(approvals[0].body.events[0].response, {
    type: "browser_origin_access",
    decision: "approve",
  });
  assert.deepEqual(f.calls.at(-1), ["delete", "session_owned"]);
  for (const request of [
    { type: "browser_authentication" },
    { type: "browser_origin_access", origin: "https://127.0.0.1" },
    { type: "browser_origin_access", origin: "https://developers.openai.com.evil.example" },
    { type: "browser_origin_access", origin: "http://developers.openai.com" },
  ]) {
    const blocked = agentClient(events);
    blocked.client.beta.agents.sessions.retrieve = async () => ({
      id: "session_owned",
      required_actions: [
        {
          type: "computer_use_approval_request",
          request_id: "blocked",
          request,
        },
      ],
    });
    await assert.rejects(
      service(blocked.client).browser("Read a page"),
      /browser_(?:action_required|origin_denied)/,
    );
    assert.deepEqual(blocked.calls.slice(-2), [
      ["cancel", "session_owned"],
      ["delete", "session_owned"],
    ]);
  }
  const noActivity = agentClient(
    events.filter(
      (event) =>
        !["agent.session.requires_action", "agent.session.turn.item.done"].includes(event.type),
    ),
  );
  await assert.rejects(service(noActivity.client).browser("Read a page"), /browser_not_used/);
  const unconfigured = agentClient([]);
  await assert.rejects(
    service(unconfigured.client, []).browser("Read a page"),
    /browser_domains_not_configured/,
  );
  assert.deepEqual(unconfigured.calls, []);
});

function fixture({
  tier = "plus",
  revalidate = async () => true,
  execute = async () => ({ text: "result" }),
} = {}) {
  const calls = [],
    seen = new Set();
  const handle = createOpenAiServiceHandler({
    requireVerifiedUser: async () => ({ userId: "owner", revalidateSession: revalidate }),
    assertNotBanned: async () => null,
    getCallerTier: async () => tier,
    enforceQuota: async () => {
      calls.push("quota");
      return null;
    },
    consumeRateLimit: async (input) => {
      calls.push("rate");
      if (input.action === "openai_service_request") {
        if (seen.has(input.identity)) return { allowed: false, status: "limited" };
        seen.add(input.identity);
      }
      return { allowed: true };
    },
    env: (name) =>
      ({ KOVA_OPENAI_SERVICES_ENABLED: "true", OPENAI_API_KEY: "synthetic-test-key" })[name],
    services: () => ({ analyze: execute, moderate: execute }),
  });
  const request = (body = { operation: "analysis", input: "Count samples" }, headers = {}) =>
    new Request("https://kovagpt.com/api/ai/services", {
      method: "POST",
      headers: {
        origin: "https://kovagpt.com",
        "content-type": "application/json",
        "x-kova-service-owner": "owner",
        "idempotency-key": "request-12345",
        ...headers,
      },
      body: JSON.stringify(body),
    });
  return { handle, request, calls };
}
test("service route rejects cross-origin, stale owner, unverified cost scope and overrides before provider work", async () => {
  const f = fixture();
  assert.equal(
    (await f.handle(f.request(undefined, { origin: "https://other.example" }))).status,
    403,
  );
  assert.equal(
    (await f.handle(f.request(undefined, { "x-kova-service-owner": "other" }))).status,
    409,
  );
  assert.equal(
    (await f.handle(f.request({ operation: "analysis", input: "test", model: "override" }))).status,
    400,
  );
  assert.deepEqual(f.calls, []);
  const free = fixture({ tier: "free" });
  assert.equal((await free.handle(free.request())).status, 403);
  assert.deepEqual(free.calls, []);
});
test("service route reserves once and never retries a failed billable request", async () => {
  let calls = 0;
  const f = fixture({
    execute: async () => {
      calls++;
      throw new Error("private provider detail");
    },
  });
  const first = await f.handle(f.request());
  assert.equal(first.status, 503);
  assert.doesNotMatch(await first.text(), /private provider/);
  assert.equal((await f.handle(f.request())).status, 409);
  assert.equal(calls, 1);
});
test("service route withholds completed output after session revocation", async () => {
  let checks = 0;
  const f = fixture({ revalidate: async () => ++checks < 3 });
  const response = await f.handle(f.request());
  assert.equal(response.status, 401);
  assert.doesNotMatch(await response.text(), /"result"/);
});

test("webhook verifies real SDK signatures, rejects stale/bad signatures and fails closed on receipt loss", async () => {
  const client = createOpenAiServiceClient("synthetic-test-key-not-real");
  const secret = "whsec_" + Buffer.from("synthetic webhook test material").toString("base64");
  const body = JSON.stringify({
    id: "evt_test_123",
    type: "response.completed",
    data: { id: "resp_test_123" },
    created_at: Math.floor(Date.now() / 1000),
  });
  const id = "evt_test_123",
    timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", Buffer.from(secret.slice(6), "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  let available = true,
    duplicate = false;
  const handler = createOpenAiWebhookHandler({
    env: () => secret,
    verify: (...args) => client.webhooks.unwrap(...args),
    consumeRateLimit: async () => ({
      allowed: available && !duplicate,
      status: available ? "limited" : "unavailable",
    }),
  });
  const request = (sig = signature, stamp = timestamp) =>
    new Request("https://kovagpt.com/api/openai/webhook", {
      method: "POST",
      headers: { "webhook-id": id, "webhook-timestamp": stamp, "webhook-signature": `v1,${sig}` },
      body,
    });
  assert.equal((await handler(request())).status, 200);
  assert.equal((await handler(request("invalid"))).status, 401);
  assert.equal((await handler(request(signature, "1"))).status, 401);
  duplicate = true;
  assert.equal((await (await handler(request())).json()).duplicate, true);
  available = false;
  assert.equal((await handler(request())).status, 503);
});

test("SDK transport pins credential origin and handles empty deletion responses", async () => {
  let redirected;
  const client = createOpenAiServiceClient("synthetic-test-key-not-real", async (_input, init) => {
    redirected = init.redirect;
    return new Response(null, { status: 204 });
  });
  await client.containers.delete("cntr_owned");
  assert.equal(redirected, "error");
});

test("hosted analysis uses the normal composer SSE parser with real token usage and terminal completion", async () => {
  const events = [];
  const response = hostedChatResult({
    text: "Computed 6",
    usage: { input_tokens: 12, output_tokens: 5 },
  });
  await consumeChatSse(response.body, { onEvent: (event) => events.push(event) });
  assert.equal(events[0].choices[0].delta.content, "Computed 6");
  assert.equal(events.at(-1).usage.prompt_tokens, 12);
  assert.equal(events.at(-1).choices[0].finish_reason, "stop");
  assert.throws(() => hostedChatResult({ text: "Incomplete" }), /hosted_chat_result_invalid/);
});
