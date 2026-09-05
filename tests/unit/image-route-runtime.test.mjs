import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { png } from "../helpers/image-fixture.mjs";
import * as policy from "../../src/lib/multimodal/image-request-policy.mjs";
import * as bytes from "../../src/lib/multimodal/image-bytes.mjs";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
function fixture() {
  const state = {
    enabled: false,
    quota: 0,
    generate: 0,
    edit: 0,
    principalChecks: 0,
    sourceChecks: 0,
    revokeAt: Infinity,
    badSource: false,
    returned: { data: [{ b64_json: png(1024, 1024).toString("base64") }] },
  };
  class ProviderError extends Error {
    constructor(details) {
      super(details.error);
      Object.assign(this, details);
    }
  }
  const modules = {
    "@tanstack/react-router": { createFileRoute: () => (value) => value },
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () => ({ userId: owner }),
      assertNotBanned: async () => null,
      assertFeatureEnabled: async () => null,
      getCallerTier: async () => "free",
      enforceQuota: async () => {
        state.quota++;
        return null;
      },
    },
    "@/lib/modes": { DAILY_IMAGE_LIMIT_BY_TIER: { free: 2 } },
    "@/lib/ai/provider.server": {
      AiProviderError: ProviderError,
      missingAiProviderResponse: () => null,
      providerErrorResponse: (error) =>
        Response.json({ error: error.message }, { status: error.status }),
      providerErrorFromResponse: () =>
        new ProviderError({ error: "Invalid provider", status: 502 }),
      imageGenerations: async () => {
        state.generate++;
        return Response.json(state.returned);
      },
      imageEdits: async (_payload, images) => {
        state.edit++;
        assert.equal(images.image.bytes.length, png().length);
        return Response.json(state.returned);
      },
    },
    "@/lib/multimodal/image-workflows.server": {
      normalizeImageSettings: (input) =>
        policy.normalizeImageRequest(input, { editEnabled: state.enabled }),
      imageEditingEnabled: () => state.enabled,
      imageProviderPayload: (settings) => policy.imageRequestFields(settings, "gpt-image-1"),
      imageEditProviderPayload: (settings) => policy.imageRequestFields(settings, "gpt-image-1"),
      imageResultMetadata: (settings) => ({
        operation: settings.operation,
        parentImageId: settings.parentImageId,
      }),
    },
    "@/lib/multimodal/image-request-policy.mjs": policy,
    "@/lib/multimodal/image-bytes.mjs": bytes,
    "@/lib/multimodal/image-source.server.mjs": {
      assertImagePrincipal: async () => {
        if (++state.principalChecks >= state.revokeAt)
          throw new policy.ImageInputError("Account changed", 409);
      },
      loadOwnedImageSource: async () => {
        if (state.badSource) throw new policy.ImageInputError("Source unavailable", 409);
        return {
          bytes: png(),
          contentType: "image/png",
          info: { width: 1, height: 1 },
          recheck: async () => {
            state.sourceChecks++;
          },
        };
      },
    },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/ai/provider-transport.server.mjs": transport,
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/runtime-env.server": { runtimeEnv: () => "https://fixture.supabase.co" },
  };
  const exports = {};
  new Function(
    "exports",
    "require",
    ts.transpileModule(fs.readFileSync("src/routes/api/generate-image.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(exports, (key) => {
    assert.ok(modules[key], key);
    return modules[key];
  });
  return {
    state,
    post: (body) =>
      exports.Route.server.handlers.POST({
        request: new Request("https://kovagpt.test/api/generate-image", {
          method: "POST",
          body: typeof body === "string" ? body : JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      }),
  };
}
test("invalid, oversized, unsupported and unavailable image edits consume no quota or provider call", async () => {
  for (const body of [
    { prompt: "Lake", operation: "variation" },
    { prompt: "Lake", operation: "edit", parentImageId: id },
    { prompt: "Lake", aspectRatio: "16:9" },
    "x".repeat(16385),
    "{invalid",
  ]) {
    const { state, post } = fixture();
    const response = await post(body);
    assert.ok(response.status >= 400);
    assert.equal(state.quota, 0);
    assert.equal(state.generate + state.edit, 0);
  }
  const { state, post } = fixture();
  state.enabled = true;
  state.badSource = true;
  assert.equal((await post({ prompt: "Edit", operation: "edit", parentImageId: id })).status, 409);
  assert.equal(state.quota, 0);
});
test("supported edit returns actual source provenance and checks source and principal again before exposing output", async () => {
  const { state, post } = fixture();
  state.enabled = true;
  const response = await post({ prompt: "Edit", operation: "edit", parentImageId: id });
  assert.equal(response.status, 200);
  assert.equal(state.edit, 1);
  assert.equal(state.generate, 0);
  assert.equal(state.sourceChecks, 2);
  assert.equal(state.principalChecks, 3);
  const result = await response.json();
  assert.equal(result.metadata.operation, "edit");
  assert.equal(result.metadata.parentImageId, id);
  assert.match(result.metadata.sourceSha256, /^[a-f0-9]{64}$/);
  assert.equal(response.headers.get("cache-control"), "no-store");
});
test("account revocation during generation withholds private output and malformed remote output is rejected", async () => {
  let fixtureValue = fixture();
  fixtureValue.state.revokeAt = 3;
  let response = await fixtureValue.post({ prompt: "Lake" });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).imageUrl, undefined);
  fixtureValue = fixture();
  fixtureValue.state.returned = { data: [{ url: "https://elsewhere.invalid/private" }] };
  response = await fixtureValue.post({ prompt: "Lake" });
  assert.equal(response.status, 502);
  assert.equal((await response.json()).imageUrl, undefined);
});
