import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { developerOpenApi } from "../../src/lib/developer-openapi.mjs";
import { DEVELOPER_ENDPOINTS } from "../../src/lib/developer-reference.mjs";

const spec = developerOpenApi();
test("every versioned API method has a unique operation and bearer and error contracts", () => {
  assert.equal(spec.openapi, "3.1.0");
  assert.deepEqual(Object.keys(spec.paths).sort(), DEVELOPER_ENDPOINTS.map((e) => e.path).sort());
  const ids = new Set();
  for (const endpoint of DEVELOPER_ENDPOINTS) {
    const methods = spec.paths[endpoint.path];
    assert.deepEqual(
      Object.keys(methods).sort(),
      endpoint.methods.map((m) => m.toLowerCase()).sort(),
    );
    for (const [method, operation] of Object.entries(methods)) {
      assert.ok(!ids.has(operation.operationId));
      ids.add(operation.operationId);
      assert.deepEqual(operation.security, [{ DeveloperKey: [] }]);
      assert.equal(
        operation.responses["401"].content["application/json"].schema.properties.error.properties
          .code.type,
        "string",
      );
      if (method === "post") assert.ok(operation.requestBody.content["application/json"].schema);
    }
  }
});
test("paid operations and quote schemas agree with the JavaScript SDK operation union", async () => {
  const source = await readFile(
    new URL("../../sdk/javascript/index.d.mts", import.meta.url),
    "utf8",
  );
  const sdk = [...source.match(/export type Operation =([\s\S]*?);/)[1].matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .sort();
  const quote =
    spec.paths["/api/v1/quotes"].post.requestBody.content["application/json"].schema.oneOf;
  assert.deepEqual(quote.map((s) => s.properties.operation.enum[0]).sort(), sdk);
  for (const s of quote) {
    const endpoint = spec.paths["/api/v1/" + s.properties.operation.enum[0]].post;
    assert.deepEqual(endpoint.requestBody.content["application/json"].schema, s.properties.input);
    assert.deepEqual(
      endpoint.parameters
        .filter((p) => p.required)
        .map((p) => p.name)
        .sort(),
      ["Idempotency-Key", "X-Kova-Quote"],
    );
  }
  assert.ok(spec.paths["/api/v1/responses"].post.responses["200"].content["text/event-stream"]);
  assert.ok(spec.paths["/api/v1/files"].post.requestBody.content["multipart/form-data"]);
  assert.equal(
    spec.paths["/api/v1/audio/speech"].post.requestBody.content["application/json"].schema
      .properties.voice.enum[0],
    "default",
  );
  assert.equal(
    spec.paths["/api/v1/realtime"].post.requestBody.content["application/json"].schema.oneOf.length,
    2,
  );
});

test("research contract describes distinct autonomous and reviewed envelopes and settled citations", () => {
  const route = spec.paths["/api/v1/research-runs"];
  const [manual, autonomous, cancel] =
    route.post.requestBody.content["application/json"].schema.oneOf;
  assert.equal(manual.properties.items.minItems, 2);
  assert.equal(autonomous.properties.items.maxItems, 1);
  assert.equal(autonomous.properties.items.items.properties.input.properties.research.const, true);
  assert.equal(cancel.properties.operation.enum[0], "cancel");
  const run = route.get.responses[200].content["application/json"].schema.oneOf[0];
  assert.deepEqual(run.properties.mode.enum, ["autonomous", "queries"]);
  assert.ok(run.properties.items.items.properties.citations);
});

test("versioned resource responses distinguish definitions, summaries and deletion receipts", () => {
  const schema = (route, method, status = 200) =>
    spec.paths["/api/v1/" + route][method].responses[status].content["application/json"].schema;
  for (const [route, kind] of [
    ["agents", "agent"],
    ["skills", "skill"],
    ["prompts", "prompt"],
  ]) {
    const detail = schema(route, "post", 201);
    assert.equal(detail.properties.object.const, kind + ".definition");
    assert.deepEqual(schema(route, "post"), detail);
    assert.deepEqual(schema(route, "get").oneOf[1], detail);
    assert.equal(detail.additionalProperties, false);
    assert.equal(detail.properties.owner_id, undefined);
    assert.equal(schema(route, "delete").properties.deleted.const, true);
    const summary = schema(route, "get").oneOf[0].properties.data.items;
    assert.equal(summary.properties.definition, undefined);
    assert.equal(summary.properties.version.maximum, 20);
  }
});

test("conversation and vector mutations document their distinct resource receipts", () => {
  const schema = (route, method, status = 200) =>
    spec.paths["/api/v1/" + route][method].responses[status].content["application/json"].schema;
  const conversation = schema("conversations", "post", 201);
  assert.equal(conversation.properties.items.maxItems, 100);
  assert.equal(conversation.properties.revision.maximum, 200);
  assert.equal(schema("conversations", "post").oneOf[1].properties.deleted.const, true);
  const vector = schema("vector-stores", "get").oneOf;
  assert.equal(vector[2].properties.data.maxItems, 25);
  assert.equal(vector[3].properties.embedding.maxItems, 1536);
  assert.equal(schema("vector-stores", "post").oneOf[0].properties.embedding, undefined);
  assert.equal(schema("vector-stores", "post").oneOf[2].properties.search_type.const, "cosine");
});

test("webhook secrets are mutation-only and completed response jobs require settled output", () => {
  const webhook = spec.paths["/api/v1/webhooks"];
  const schema = (operation, status = 200) =>
    operation.responses[status].content["application/json"].schema;
  assert.equal(schema(webhook.get).anyOf[2].properties.signing_secret, undefined);
  assert.ok(schema(webhook.post, 201).required.includes("signing_secret"));
  assert.ok(schema(webhook.post).required.includes("signing_secret"));
  assert.equal(schema(webhook.post, 202).properties.signing_secret, undefined);
  assert.equal(schema(webhook.post, 202).properties.status.enum.includes("pending"), true);
  const job = schema(spec.paths["/api/v1/response-jobs"].post, 202).oneOf;
  assert.equal(job[0].properties.settlement_state.const, "settled");
  assert.equal(job[0].properties.output.type, "object");
  assert.equal(job[1].properties.output.type, "null");
  assert.equal(job[1].properties.status.enum.includes("completed"), false);
});

test("every public method has a non-generic success schema and mutation-only session credentials", () => {
  for (const methods of Object.values(spec.paths))
    for (const operation of Object.values(methods)) {
      const successes = Object.entries(operation.responses).filter(([status]) =>
        /^2[0-9]{2}$/.test(status),
      );
      assert.ok(successes.length);
      for (const [, response] of successes) {
        const schema = response.content["application/json"].schema;
        assert.ok(
          schema.required?.length || schema.oneOf?.length || schema.anyOf?.length,
          operation.operationId,
        );
      }
    }
  for (const kind of ["browser", "realtime"]) {
    const route = spec.paths["/api/v1/" + kind + "-sessions"];
    for (const method of ["get", "delete"])
      assert.equal(
        route[method].responses[200].content["application/json"].schema.properties.client_secret,
        undefined,
      );
    assert.equal(route.post.responses[200], undefined);
    assert.ok(
      route.post.responses[201].content["application/json"].schema.required.includes(
        "client_secret",
      ),
    );
  }
  assert.ok(
    spec.paths["/api/v1/models"].get.responses[200].content[
      "application/json"
    ].schema.required.includes("pricingVersion"),
  );
});

test("file, batch, automation and MCP receipts reflect their separate operations", () => {
  const schema = (route, method, status = 200) =>
    spec.paths["/api/v1/" + route][method].responses[status].content["application/json"].schema;
  assert.equal(schema("files", "get").oneOf[0].properties.maximumBytes.const, 2097152);
  assert.equal(schema("files", "get").oneOf[0].properties.data.maxItems, 25);
  assert.equal(schema("files", "get").oneOf[1].properties.content.maxLength, 32768);
  assert.equal(schema("files", "post", 201).properties.content, undefined);
  assert.equal(schema("files", "delete").properties.deleted.const, true);
  for (const [route, kind] of [
    ["batches", "batch"],
    ["automations", "automation"],
  ]) {
    const [list, detail, item] = schema(route, "get").oneOf;
    assert.equal(list.properties.data.items.properties.resource_kind.const, kind);
    assert.equal(detail.properties.items.items.properties.authorization, undefined);
    assert.equal(item.properties.lease_token, undefined);
    assert.equal(item.properties.authorization, undefined);
    assert.equal(schema(route, "post", 202).properties.resource_kind.const, kind);
    assert.ok(schema(route, "post").oneOf[1].required.includes("canceled_at"));
  }
  assert.equal(
    schema("automations", "post").oneOf[2].properties.paused_at.type.includes("null"),
    true,
  );
  assert.equal(
    schema("mcp-connections", "get").properties.data.items.properties.read_only.const,
    true,
  );
  assert.equal(schema("mcp-connections", "post").properties.object.const, "mcp.read_result");
  assert.equal(
    schema("research-runs", "get").oneOf[1].properties.data.items.properties.resource_kind.const,
    "research",
  );
});
