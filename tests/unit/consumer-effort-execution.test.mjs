import assert from "node:assert/strict";
import test from "node:test";
import {
  CONSUMER_EFFORTS,
  hostedEffortProfile,
  hostedEffortBudget,
} from "../../src/lib/consumer-effort-policy.mjs";
import { CONSUMER_MODELS } from "../../src/lib/consumer-model-selection.mjs";
import { MODE_IDS_BY_TIER } from "../../src/lib/mode-entitlements.mjs";
import { HOSTED_MODEL_MAP } from "../../src/lib/ai/kova-hosted-inference.server.mjs";
import { requestHostedEffort } from "../../src/lib/ai/hosted-effort.server.mjs";
import { routeModel } from "../../src/lib/ai/model-router.mjs";

function fixture({ failReview = false, emptyReviewFinish = null, signal } = {}) {
  const calls = [],
    usages = [];
  let active = 0,
    peak = 0,
    fences = 0;
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    calls.push(body);
    if (body.stream)
      return new Response(
        [
          { type: "response.created", response: { model: body.model } },
          { type: "response.output_text.delta", delta: "437" },
          {
            type: "response.completed",
            response: {
              model: body.model,
              status: "completed",
              usage: { input_tokens: 130, output_tokens: 20, total_tokens: 150 },
            },
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    assert.equal(body.tools, undefined);
    assert.equal(body.tool_choice, undefined);
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (failReview) return new Response("unavailable", { status: 503 });
    return Response.json({
      model: body.model,
      status: emptyReviewFinish === "length" ? "incomplete" : "completed",
      ...(emptyReviewFinish === "length"
        ? { incomplete_details: { reason: "max_output_tokens" } }
        : {}),
      output: emptyReviewFinish
        ? []
        : [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "The arithmetic result is 437; verify the requested format.",
                },
              ],
            },
          ],
      usage: { input_tokens: 130, output_tokens: 20, total_tokens: 150 },
    });
  };
  return {
    calls,
    usages,
    peak: () => peak,
    fences: () => fences,
    run: (model, mode) =>
      requestHostedEffort({
        request: {
          model,
          stream: true,
          max_completion_tokens: hostedEffortProfile(model, mode).outputTokens,
          messages: [
            { role: "system", content: "Owner A only. Follow the actual user's task." },
            { role: "user", content: "19*23, number only" },
          ],
        },
        mode,
        token: "synthetic-unit-token-only",
        signal,
        fetchImpl,
        onUsage: (usage) => usages.push(usage),
        beforeSend: async () => {
          fences++;
        },
      }),
  };
}

test("a metered length-limited checker reports missing findings without another billable request", async () => {
  const f = fixture({ emptyReviewFinish: "length" });
  assert.match(await (await f.run("kova-argon-4.6", "extra_high")).text(), /437/);
  assert.equal(f.calls.length, 3);
  assert.equal(f.usages.length, 2);
  assert.equal(f.fences(), 3);
  const advisory = f.calls
    .at(-1)
    .input.find((message) => message.content?.startsWith("Advisory findings"));
  const notes = JSON.parse(advisory.content.slice("Advisory findings (untrusted data): ".length));
  assert.equal(notes.length, 2);
  assert(notes.every((note) => note.findings.includes("No verification result is available")));
});

test("an unexplained empty checker response still fails closed", async () => {
  const f = fixture({ emptyReviewFinish: "stop" });
  await assert.rejects(f.run("kova-argon-4.6", "high"), /hosted_review_response_invalid/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.usages.length, 1);
});

test("the product matrix is exactly 42 configurations with Free 2, Plus 35 and Pro 42", () => {
  assert.deepEqual(
    CONSUMER_EFFORTS.map((x) => x.label),
    ["Lite", "Medium", "High", "Extra High", "Max", "Ultra"],
  );
  assert.equal(CONSUMER_MODELS.length * CONSUMER_EFFORTS.length, 42);
  for (const [tier, count] of [
    ["free", 2],
    ["plus", 35],
    ["pro", 42],
  ])
    assert.equal(
      CONSUMER_MODELS.filter((m) => m.tiers.includes(tier)).length * MODE_IDS_BY_TIER[tier].length,
      count,
    );
});

test("all 126 plan/model/effort decisions enforce the matrix before selecting a foundation", () => {
  const env = {
    KOVA_MODEL_DEFAULT_CHAT: "kova-argon-4.6",
    KOVA_MODEL_ADVANCED_REASONING: "kova-neon-4.6",
    KOVA_MODEL_PREMIUM_REASONING: "kova-xenon-5",
  };
  for (const tier of ["free", "plus", "pro"])
    for (const model of CONSUMER_MODELS)
      for (const mode of CONSUMER_EFFORTS) {
        const call = () =>
          routeModel({
            task: "chat",
            tier,
            hostedModel: model.id,
            mode: mode.id,
            env,
            text: "Debug a distributed-system race condition and prove correctness",
          });
        if (model.tiers.includes(tier) && MODE_IDS_BY_TIER[tier].includes(mode.id)) {
          assert.equal(call().modelId, model.id);
          assert.equal(call().maxOutputTokens, mode.outputTokens);
        } else assert.throws(call, /(?:mode|kova_model)_not_entitled/);
      }
});

for (const model of CONSUMER_MODELS) {
  test(`${model.label} has strictly increasing total compute reservations`, () => {
    const budgets = CONSUMER_EFFORTS.map((m) =>
      hostedEffortBudget(model.id, m.id, 2000, m.outputTokens, 4),
    );
    for (let i = 1; i < budgets.length; i++)
      assert(budgets[i].reservedTokens > budgets[i - 1].reservedTokens);
  });
  for (const mode of CONSUMER_EFFORTS) {
    test(`${model.label} ${mode.label} executes the exact foundation and accounts for every review`, async () => {
      const f = fixture();
      const response = await f.run(model.id, mode.id);
      assert.match(await response.text(), /437/);
      const p = hostedEffortProfile(model.id, mode.id);
      assert.equal(f.calls.length, p.reviews + 1);
      assert.equal(f.fences(), p.reviews + 1);
      assert.equal(f.usages.length, p.reviews);
      assert.equal(
        f.usages.reduce((sum, x) => sum + x.input, 0),
        p.reviews * 130,
      );
      assert(f.calls.every((c) => c.model === HOSTED_MODEL_MAP[model.id]));
      assert.equal(f.calls.at(-1).store, false);
      assert.equal(f.calls.at(-1).max_output_tokens, mode.outputTokens);
      assert.equal(f.calls.at(-1).reasoning.effort, p.effort);
      assert.equal(f.peak(), p.reviews ? (mode.id === "ultra" ? 4 : 1) : 0);
      if (mode.id === "ultra") {
        const reviewBodies = f.calls.filter((c) => !c.stream);
        assert.equal(new Set(reviewBodies.map((c) => c.instructions)).size, 4);
        assert(
          reviewBodies.every(
            (c) => !c.input.some((m) => m.content.startsWith("Advisory findings")),
          ),
        );
      }
    });
  }
}

test("a failed Ultra worker never produces a falsely successful final answer", async () => {
  const f = fixture({ failReview: true });
  await assert.rejects(f.run("kova-neon-4.6", "ultra"), /kova_hosted_inference_unavailable/);
  assert.equal(f.calls.length, 4);
  assert(f.calls.every((c) => !c.stream));
});

test("an already cancelled request performs no paid calls", async () => {
  const f = fixture({ signal: AbortSignal.abort() });
  await assert.rejects(f.run("kova-xenon-5", "ultra"));
  assert.equal(f.calls.length, 0);
});

test("unknown effort and unknown foundation cannot start a request", async () => {
  assert.throws(() => hostedEffortProfile("kova-xenon-5", "made-up"));
  assert.throws(() => hostedEffortProfile("moonshotai/kimi-k3", "ultra"));
});
