import assert from "node:assert/strict";
import test from "node:test";
import {
  parseDeveloperCredential,
  parseDeveloperInput,
  parseDeveloperLimits,
  developerRequestKey,
} from "../../src/lib/pricing/developer-platform-policy.mjs";
test("only a complete opaque key and bounded visible retry key cross developer admission", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(parseDeveloperCredential(`Bearer kova_${id}_${"a".repeat(43)}`).keyId, id);
  for (const input of [
    null,
    "Bearer user-jwt",
    `Bearer kova_${id}_${"a".repeat(42)}`,
    `Bearer kova_${id}_${"a".repeat(43)} extra`,
  ])
    assert.throws(() => parseDeveloperCredential(input), /unauthorized/);
  assert.equal(developerRequestKey("request-123"), "request-123");
  for (const input of ["", "a".repeat(129), "a\nb", " key"])
    assert.throws(() => developerRequestKey(input), /required/);
});
test("native Responses input is bounded, text-only and never retained at the provider", () => {
  const input = { model: "kova-fast", input: "Summarize this text.", max_output_tokens: 100 };
  const parsed = parseDeveloperInput("responses", input);
  assert.equal(parsed.body.store, false);
  assert.equal(parsed.capability, "chat");
  assert.equal(
    parseDeveloperInput("responses", { ...input, stream: true }).capability,
    "streaming",
  );
  for (const extra of [
    { store: true },
    { previous_response_id: "resp_other" },
    { account_id: "another" },
    { usage: { input: 0 } },
    { price: 0 },
    { base_url: "https://attacker.invalid" },
  ])
    assert.throws(() => parseDeveloperInput("responses", { ...input, ...extra }), /field_invalid/);
  assert.throws(
    () =>
      parseDeveloperInput("responses", {
        ...input,
        input: [{ type: "input_image", image_url: "https://private" }],
      }),
    /responses_invalid/,
  );
  assert.throws(
    () => parseDeveloperInput("responses", { ...input, input: "x".repeat(32001) }),
    /responses_invalid/,
  );
  assert.throws(
    () => parseDeveloperInput("responses", { ...input, max_output_tokens: 0 }),
    /limit_invalid/,
  );
});
test("image parameters and embedding batches stay inside server-reviewed contracts", () => {
  const image = {
    model: "kova-image",
    prompt: "A blue bird",
    size: "1024x1024",
    quality: "medium",
  };
  assert.equal(parseDeveloperInput("images", image).body.n, 1);
  assert.throws(() => parseDeveloperInput("images", { ...image, n: 5 }), /limit_invalid/);
  assert.throws(
    () => parseDeveloperInput("images", { ...image, image_url: "https://private" }),
    /field_invalid/,
  );
  assert.equal(
    parseDeveloperInput("embeddings", { model: "kova-embedding", input: ["a", "b"] }).body.input
      .length,
    2,
  );
  assert.throws(
    () =>
      parseDeveloperInput("embeddings", { model: "kova-embedding", input: Array(33).fill("x") }),
    /batch_invalid/,
  );
  assert.throws(
    () =>
      parseDeveloperInput("embeddings", {
        model: "kova-embedding",
        input: Array(32).fill("x".repeat(8000)),
      }),
    /too_large/,
  );
});
test("spending ceilings require ordered positive limits and bounded integral concurrency", () => {
  const limits = { request: 10, daily: 100, monthly: 1000, concurrent: 2 };
  assert.deepEqual(parseDeveloperLimits(limits), limits);
  for (const patch of [
    { request: -1 },
    { request: 101 },
    { daily: 1001 },
    { monthly: Infinity },
    { concurrent: 1.5 },
    { concurrent: 9 },
    { extra: 2 },
  ])
    assert.throws(() => parseDeveloperLimits({ ...limits, ...patch }), /limits_invalid/);
});
