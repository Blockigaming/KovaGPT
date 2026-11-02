import assert from "node:assert/strict";
import test from "node:test";
import { createChatProgressResponse } from "../../src/lib/chat-progress.server.mjs";
import { consumeChatSse } from "../../src/lib/chat-sse-client.mjs";
import { messageActivitiesFromDelta } from "../../src/lib/message-activity-list.mjs";
import { providerActivityDeltas } from "../../src/lib/ai/provider-activity.mjs";
import { activityHostname } from "../../src/lib/activity-display.mjs";
import { publicWorkActivity } from "../../src/lib/work-progress.mjs";
import {
  portalPlanChange,
  portalPlanChangesReady,
} from "../../scripts/release/billing-portal-plan-change.mjs";
const frame = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("progress reaches the client before a deferred connector finishes, in narration/row order", async () => {
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const response = createChatProgressResponse(async ({ emit }) => {
    emit({ kind: "progress", activity_id: "intro", label: "I’m checking GitHub." });
    emit({
      kind: "activity",
      activity_id: "github-1",
      tool: "github_search",
      label: "Searching GitHub…",
      status: "running",
      hostname: "github.com",
    });
    await pending;
    emit({
      kind: "activity",
      activity_id: "github-1",
      tool: "github_search",
      label: "Checked GitHub",
      status: "done",
      hostname: "github.com",
    });
    emit({ kind: "progress", activity_id: "review", label: "I have the result. I’ll review it." });
    return new Response(frame({ content: "Final answer" }) + "data: [DONE]\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  let activities = [],
    answer = "";
  const reading = consumeChatSse(response.body, {
    onEvent(event) {
      const delta = event.choices[0].delta;
      if (delta.kind) activities = messageActivitiesFromDelta(activities, delta);
      else answer += delta.content;
    },
  });
  await settle();
  assert.equal(answer, "");
  assert.deepEqual(
    activities.map((row) => row.presentation ?? row.status),
    ["commentary", "running"],
  );
  finish();
  await reading;
  assert.equal(activities.length, 3);
  assert.equal(activities[1].status, "done");
  assert.equal(activities[2].presentation, "commentary");
  assert.equal(answer, "Final answer");
});
test("Stop aborts work and closes immediately while a connector has no result", async () => {
  let signal;
  const response = createChatProgressResponse(async (progress) => {
    signal = progress.signal;
    await new Promise(() => {});
  });
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel("user-stop");
  assert.equal(signal.aborted, true);
});
test("a preflight HTTP failure becomes a typed stream error, never a completed answer", async () => {
  const response = createChatProgressResponse(async () =>
    Response.json(
      { error: "Sign in to use KovaGPT.", code: "authentication_required" },
      { status: 401 },
    ),
  );
  await assert.rejects(
    consumeChatSse(response.body),
    (error) => error.status === 401 && error.code === "authentication_required",
  );
});
test("each observed website gets its own safe update; private URLs and reasoning never leak", () => {
  const rows = providerActivityDeltas({
    type: "response.output_item.done",
    item: {
      id: "call-1",
      type: "web_search_call",
      status: "completed",
      action: {
        type: "search",
        sources: [
          { url: "https://github.com/a?token=secret" },
          { url: "https://docs.google.com/document/private" },
        ],
      },
    },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hostname, "github.com");
  assert.equal(
    providerActivityDeltas({
      type: "response.output_item.done",
      item: {
        id: "many-sources",
        type: "web_search_call",
        status: "completed",
        action: {
          type: "search",
          sources: Array.from({ length: 40 }, (_, i) => ({ url: `https://site${i}.com` })),
        },
      },
    }).length,
    40,
  );
  assert.doesNotMatch(JSON.stringify(rows), /secret|private|token/);
  assert.deepEqual(
    providerActivityDeltas({ type: "response.reasoning_text.delta", delta: "private reasoning" }),
    [],
  );
  assert.equal(
    providerActivityDeltas({
      type: "response.output_item.added",
      item: {
        id: "open-1",
        type: "web_search_call",
        status: "in_progress",
        action: { type: "open_page", url: "https://example.com/path" },
      },
    })[0].status,
    "running",
  );
  for (const value of [
    "https://user:password@example.com",
    "https://localhost",
    "http://127.0.0.1",
    "https://a.internal",
    "javascript:alert(1)",
  ])
    assert.equal(activityHostname(value), undefined);
});
test("Work progress is a public projection with a stable browser operation identity", () => {
  const run = {
    revision: 4,
    effect: { id: "effect-a", status: "started" },
    approval: {
      action: "browser_interact",
      canonicalInput: JSON.stringify({
        url: "https://github.com/private?token=hidden",
        text: "password",
      }),
    },
  };
  const row = publicWorkActivity(run, "effect_started");
  assert.equal(row.hostname, "github.com");
  assert.equal(row.status, "running");
  assert.doesNotMatch(JSON.stringify(row), /hidden|password|private/);
  const done = publicWorkActivity(
    { ...run, effect: { ...run.effect, status: "completed" } },
    "step_completed",
    { browserAction: true },
  );
  assert.equal(done.activityId, row.activityId);
  assert.equal(done.status, "done");
});
test("the reviewed portal repair enables the two plan choices without changing payment or trial terms", () => {
  const config = {
    active: true,
    livemode: true,
    features: {
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["quantity"],
        proration_behavior: "always_invoice",
        trial_update_behavior: "end_trial",
      },
    },
  };
  const catalog = ["price_1UAzhHAEZlsb6DBYWw2oUCeO", "price_1UEw6FAEZlsb6DBYuksCKOBR"].map(
    (id, index) => ({
      id,
      product: `product-${index}`,
      active: true,
      livemode: true,
      currency: "usd",
      recurring: { interval: "month", interval_count: 1 },
    }),
  );
  const patch = portalPlanChange(config, catalog);
  assert.deepEqual(patch.features.subscription_update.default_allowed_updates, [
    "quantity",
    "price",
  ]);
  assert.deepEqual(Object.keys(patch.features.subscription_update), [
    "default_allowed_updates",
    "products",
  ]);
  assert.equal(portalPlanChangesReady(config, catalog), false);
  assert.equal(portalPlanChangesReady(config, []), false);
  assert.throws(() => portalPlanChange(config, [catalog[0], catalog[0]]), /catalog_mismatch/);
  assert.equal(
    portalPlanChangesReady(
      {
        ...config,
        features: {
          subscription_update: {
            ...config.features.subscription_update,
            ...patch.features.subscription_update,
          },
        },
      },
      catalog,
    ),
    true,
  );
  assert.throws(
    () =>
      portalPlanChange(
        config,
        catalog.map((p) => ({ ...p, active: false })),
      ),
    /catalog_mismatch/,
  );
});
