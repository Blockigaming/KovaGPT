import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveOneShotConsumerModel } from "../../src/lib/consumer-model-selection.mjs";

const DEFAULT = "kova-argon-4.6";
const PREMIUM = "kova-xenon-5";

test("a one-message model override does not change the saved default", () => {
  assert.deepEqual(
    resolveOneShotConsumerModel({
      defaultModel: DEFAULT,
      oneShotModel: PREMIUM,
      tier: "plus",
    }),
    { requestModel: PREMIUM, savedModel: DEFAULT, oneShotModel: PREMIUM },
  );
});

test("the server-bound candidate is limited to models in the user's tier", () => {
  const invalid = resolveOneShotConsumerModel({
    defaultModel: DEFAULT,
    oneShotModel: PREMIUM,
    tier: "free",
  });
  assert.deepEqual(invalid, {
    requestModel: DEFAULT,
    savedModel: DEFAULT,
    oneShotModel: undefined,
  });
  assert.equal(
    resolveOneShotConsumerModel({
      defaultModel: DEFAULT,
      oneShotModel: "invalid-model",
      tier: "pro",
    }).requestModel,
    DEFAULT,
  );
});

test("held one-message requests preserve their temporary choice without changing defaults", () => {
  assert.deepEqual(
    resolveOneShotConsumerModel({
      defaultModel: DEFAULT,
      queuedModel: PREMIUM,
      queuedOneShotModel: PREMIUM,
      tier: "plus",
    }),
    { requestModel: PREMIUM, savedModel: DEFAULT, oneShotModel: PREMIUM },
  );
});

test("a normal queued model change is still persistent", () => {
  assert.deepEqual(
    resolveOneShotConsumerModel({
      defaultModel: DEFAULT,
      queuedModel: PREMIUM,
      tier: "plus",
    }),
    { requestModel: PREMIUM, savedModel: PREMIUM, oneShotModel: undefined },
  );
});

test("one-message override never changes a Kova-specialist conversation", () => {
  assert.deepEqual(
    resolveOneShotConsumerModel({
      defaultModel: DEFAULT,
      oneShotModel: PREMIUM,
      tier: "pro",
      nativeKova: true,
    }),
    { requestModel: undefined, savedModel: undefined, oneShotModel: undefined },
  );
});

test("composer and chat request pass the ephemeral choice to the existing API", () => {
  const composer = readFileSync("src/components/ChatInput.tsx", "utf8");
  const route = readFileSync("src/routes/index.tsx", "utf8");
  assert.match(composer, /triggerSubmit\(model\.id\)/);
  assert.match(composer, /onSubmit\(selectedToolRef\.current, oneShotModel\)/);
  assert.match(route, /resolveOneShotConsumerModel\(/);
  assert.match(route, /hostedModel: requestHostedModel/);
  assert.match(route, /hostedModel: conversationHostedModel/);
});
