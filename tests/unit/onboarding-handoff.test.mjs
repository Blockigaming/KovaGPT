import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeOnboardingHandoff,
  stageOnboardingHandoff,
} from "../../src/lib/onboarding-handoff.ts";

test("onboarding handoffs are principal-bound and consumed once", () => {
  stageOnboardingHandoff({
    ownerId: "account-a",
    responseLength: "long",
    starter: "Help me plan this project",
  });

  assert.equal(consumeOnboardingHandoff("account-b"), null);
  assert.equal(consumeOnboardingHandoff("account-a"), null);

  const expected = {
    ownerId: "account-a",
    responseLength: "short",
    starter: "Summarize these notes",
  };
  stageOnboardingHandoff(expected);
  assert.deepEqual(consumeOnboardingHandoff("account-a"), expected);
  assert.equal(consumeOnboardingHandoff("account-a"), null);
});
