import assert from "node:assert/strict";
import test from "node:test";
import { acceptanceDigest } from "../../src/lib/generation-acceptance.server.mjs";
import {
  createAcceptanceFixture,
  syntheticAcceptanceBody as body,
} from "../helpers/generation-acceptance.mjs";
const fixture = () => createAcceptanceFixture();

const denied = (fn) =>
  assert.rejects(async () => fn(), {
    message: "generation_acceptance_denied",
    status: 503,
  });

test("disabled guard leaves production body untouched and claims nothing", async () => {
  const f = fixture();
  f.config = { enabled: false };
  const guard = f.build();
  const original = { ...body(), max_output_tokens: 700 };
  assert.equal(
    await guard.openAI({ provider: "openai", path: "/responses", body: original }),
    null,
  );
  assert.equal(await guard.speech({ text: "Unscoped production call" }), null);
  assert.equal(original.max_output_tokens, 700);
  assert.equal(
    guard.run({}, () => "unchanged"),
    "unchanged",
  );
  assert.equal(f.calls.length, 0);
});
test("one request each is admitted with exact reviewed body and integer cost", async () => {
  const f = fixture();
  const guard = f.build();
  const input = { ...body(), max_output_tokens: 700 };
  const admitted = await f.ai(guard, { body: input });
  assert.equal(admitted.body.max_output_tokens, 64);
  assert.equal(input.max_output_tokens, 700);
  assert.equal(admitted.maximumCostNanos, "120084800");
  await f.speech(guard);
  await denied(() => f.ai(guard));
  await denied(() => f.speech(guard));
  assert.deepEqual(
    f.calls.slice(0, 2).map((c) => [c.action, c.limit, c.windowSeconds]),
    [
      ["acceptance_openai", 1, 3600],
      ["acceptance_elevenlabs", 1, 3600],
    ],
  );
});
test("concurrent requests and another instance cannot consume the same durable slot", async () => {
  const f = fixture();
  const results = await Promise.allSettled([f.ai(f.build()), f.ai(f.build())]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await denied(() => f.ai(f.build()));
});
test("failure or cancellation after admission does not refund the slot", async () => {
  const f = fixture();
  const guard = f.build();
  await f.ai(guard);
  // A provider failure is external to admission and cannot reverse its claim.
  await denied(() => f.ai(guard));
  const ctl = new AbortController();
  const g = f.build({
    claim: async (input) => {
      ctl.abort("fixture-secret");
      f.shared.set(input.action, true);
      return { allowed: true, retryAfter: 3000 };
    },
  });
  await denied(() => f.speech(g, { signal: ctl.signal }));
  assert.equal(f.shared.get("acceptance_elevenlabs"), true);
});
test("expiry prevents a fresh fixed-hour bucket from reauthorizing a spent operation", async () => {
  const f = fixture();
  await f.ai(f.build());
  f.time += 3600000;
  await denied(() => f.ai(f.build()));
  assert.equal(f.calls.length, 1);
});
test("expired, not-yet-valid, hour-crossing and bucket-edge manifests are rejected", async () => {
  for (const mutate of [
    (f) => {
      f.time = f.plan.expiresAt;
    },
    (f) => {
      f.time--;
    },
    (f) => {
      f.plan.notBefore += 48 * 60000;
      f.plan.expiresAt = f.plan.notBefore + 180000;
      f.time = f.plan.notBefore;
    },
    (f) => {
      f.plan.notBefore += 47 * 60000;
      f.plan.expiresAt = f.plan.notBefore + 170000;
      f.time = f.plan.notBefore;
    },
  ]) {
    const f = fixture();
    mutate(f);
    f.plan.quote.validUntil = f.plan.expiresAt;
    f.bind();
    await denied(() => f.ai(f.build()));
    assert.equal(f.calls.length, 0);
  }
});
test("expiry after atomic admission and an unsafe database bucket margin deny sending", async () => {
  const f = fixture();
  await denied(() =>
    f.ai(
      f.build({
        claim: async () => {
          f.time = f.plan.expiresAt;
          return { allowed: true, retryAfter: 3000 };
        },
      }),
    ),
  );
  const g = fixture();
  await denied(() => g.ai(g.build({ claim: async () => ({ allowed: true, retryAfter: 181 }) })));
});
test("owner, operation and chat scope must come from the verified application path", async () => {
  const f = fixture();
  const guard = f.build();
  await denied(() => guard.openAI({ provider: "openai", path: "/responses", body: body() }));
  for (const field of ["ownerId", "operationId", "chatId"]) {
    await denied(() =>
      guard.run({ ...f.scope(), [field]: "4".repeat(36) }, () =>
        guard.openAI({ provider: "openai", path: "/responses", body: body() }),
      ),
    );
  }
  const another = f.build();
  await denied(() =>
    guard.run(f.scope(), () =>
      another.openAI({ provider: "openai", path: "/responses", body: body() }),
    ),
  );
  assert.equal(f.calls.length, 0);
});
test("body mutation, model switching, tools, media and excessive bytes cannot use a quote", async () => {
  for (const mutate of [
    (b) => {
      b.instructions += " injected";
    },
    (b) => {
      b.model = "another-model";
    },
    (b) => {
      b.input[0].content += " injected";
    },
    (b) => {
      b.input[0].content = [{ type: "input_image", image_url: "https://fixture.test" }];
    },
    (b) => {
      b.tools = [];
    },
    (b) => {
      b.tool_choice = "auto";
    },
    (b) => {
      b.instructions = "x".repeat(4096);
    },
    (b) => {
      b.max_output_tokens = 63;
    },
    (b) => {
      b.max_output_tokens = NaN;
    },
  ]) {
    const f = fixture();
    const b = body();
    mutate(b);
    await denied(() => f.ai(f.build(), { body: b }));
    assert.equal(f.calls.length, 0);
  }
});
test("non-OpenAI providers, other endpoints and untrusted speech metadata are denied", async () => {
  const f = fixture();
  const g = f.build();
  await denied(() => f.ai(g, { provider: "azure_openai" }));
  await denied(() => f.ai(g, { path: "/embeddings" }));
  for (const data of [
    { ownerId: "another-owner" },
    { chatId: "another-chat" },
    { messageId: "" },
    { voiceId: "anotherVoice" },
    { modelId: "another-model" },
    { text: "x".repeat(121) },
    { text: "" },
    { text: "\uD83D\uDE00" },
  ])
    await denied(() => f.speech(g, data));
  assert.equal(f.calls.length, 0);
});
test("review and receipt hashes, exact token evidence, configuration and rates are mandatory", async () => {
  for (const mutate of [
    (f) => {
      delete f.plan.quote;
    },
    (f) => {
      f.plan.openAI.verifiedInputTokens = 0;
    },
    (f) => {
      f.plan.openAI.tokenCountEvidenceSha256 = "unverified";
    },
    (f) => {
      f.plan.target.configurationEvidenceSha256 = "unverified";
    },
    (f) => {
      f.plan.quote.pricingEvidenceSha256 = "unverified";
    },
    (f) => {
      f.plan.quote.maximumTotal = "120084799";
    },
    (f) => {
      f.plan.quote.inputPerMillion = "0.20";
    },
    (f) => {
      f.plan.quote.speechPerCharacter = "0";
    },
    (f) => {
      f.plan.quote.validUntil = f.plan.expiresAt - 1;
    },
  ]) {
    const f = fixture();
    mutate(f);
    f.bind();
    await denied(() => f.ai(f.build()));
    assert.equal(f.calls.length, 0);
  }
  for (const field of ["expectedPlanSha256", "expectedApprovalReceiptSha256", "approvalReceipt"]) {
    const f = fixture();
    delete f.config[field];
    await denied(() => f.ai(f.build()));
  }
});
test("mutating an externally reviewed fact invalidates its binding", async () => {
  const f = fixture();
  f.plan.quote.speechPerCharacter = "1";
  await denied(() => f.ai(f.build()));
  const g = fixture();
  g.config.approvalReceipt.approvedMaximumCostNanos = "999999999";
  await denied(() => g.ai(g.build()));
});
test("a caller cannot mutate the approved body while durable admission is pending", async () => {
  const f = fixture();
  let release;
  const pendingClaim = new Promise((resolve) => {
    release = resolve;
  });
  const guard = f.build({ claim: () => pendingClaim });
  const original = body();
  const pending = f.ai(guard, { body: original });
  original.input[0].content = "A different request";
  release({ allowed: true, retryAfter: 3000 });
  const admitted = await pending;
  assert.equal(admitted.body.input[0].content, "Reply exactly: Kova speech test.");
});
test("a plan changed during the atomic claim cannot authorize a send", async () => {
  const f = fixture();
  const guard = f.build({
    claim: async () => {
      f.plan.quote.speechPerCharacter = "2";
      return { allowed: true, retryAfter: 3000 };
    },
  });
  await denied(() => f.ai(guard));
});
test("even a quoted body cannot introduce prior context or unknown provider features", async () => {
  for (const extra of [
    { previous_response_id: "response-fixture" },
    { conversation: "fixture" },
    { background: true },
  ]) {
    const f = fixture();
    const request = { ...body(), ...extra };
    f.plan.openAI.bodySha256 = acceptanceDigest(request);
    f.bind();
    await denied(() => f.ai(f.build(), { body: request }));
    assert.equal(f.calls.length, 0);
  }
});
test("claim failures, configuration errors and sensitive abort reasons have static errors", async () => {
  const f = fixture();
  await denied(() =>
    f.ai(
      f.build({
        claim: async () => {
          throw new Error("fixture-secret-key");
        },
      }),
    ),
  );
  await denied(() =>
    f.ai(
      f.build({
        getConfig: () => {
          throw new Error("fixture-secret-key");
        },
      }),
    ),
  );
  const ctl = new AbortController();
  ctl.abort(new Error("fixture-secret-key"));
  await denied(() => f.ai(f.build(), { signal: ctl.signal }));
});
