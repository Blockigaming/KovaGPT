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
