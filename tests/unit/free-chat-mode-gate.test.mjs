import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freeModeUpgradeRequired } from "../../src/lib/ai/model-router.mjs";

const source = readFileSync(new URL("../../src/routes/api/chat.ts", import.meta.url), "utf8");
const start = source.indexOf("            if (auth && freeModeUpgradeRequired(");
const end = source.indexOf("            // A custom Kova supplies", start);
assert.ok(start > 0 && end > start);
// Execute the route's exact early-response block in isolation. Mode parsing,
// auth and tier lookup are upstream; these inputs represent their resolved values.
const runGate = new Function(
  "auth",
  "callerTier",
  "mode",
  "getMode",
  "freeModeUpgradeRequired",
  source.slice(start, end),
);
const getMode = (mode) => ({ id: mode ?? "instant" });

test("Free locked modes return a stable upgrade response before downstream work", async () => {
  for (const mode of ["medium", "high", "extra_high", "max", "ultra"]) {
    const response = runGate({}, "free", mode, getMode, freeModeUpgradeRequired);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), {
      error: "This mode requires a paid plan. Upgrade to use this mode.",
      code: "mode_not_entitled",
      upgradeUrl: "/pricing",
      retryable: false,
    });
  }
});

test("Free Default and Thinking, guests and paid tiers retain their downstream behavior", () => {
  for (const mode of [undefined, "instant", "thinking"]) {
    assert.equal(runGate({}, "free", mode, getMode, freeModeUpgradeRequired), undefined);
  }
  for (const tier of ["plus", "pro"]) {
    assert.equal(runGate({}, tier, "thinking", getMode, freeModeUpgradeRequired), undefined);
  }
  assert.equal(runGate(null, "free", "thinking", getMode, freeModeUpgradeRequired), undefined);
});

test("legacy gate remains after the Models-v2 fail-closed gate and before all costly work", () => {
  assert.ok(source.indexOf('code: "kova_model_not_entitled"') < start);
  assert.ok(source.indexOf('code: "kova_model_runtime_unverified"') < start);
  for (const marker of [
    "const missingProvider = capture ? null : missingAiProviderResponse()",
    'preflight.run("image_quota"',
    'preflight.run("chat_quota"',
    "const routeDecision = routeAiModel(",
    "return handleImageRequest(imagePrompt",
  ]) {
    assert.ok(source.indexOf(marker) > end, marker);
  }
  assert.match(source, /if \(missingProvider\) return missingProvider;/);
});

test("guest attachments are denied before custom context, provider or quota work", async () => {
  const guestStart = source.indexOf("            if (!auth && currentAttachments.length > 0)");
  const guestEnd = source.indexOf(
    "            // Reject an explicitly locked Free mode",
    guestStart,
  );
  assert.ok(guestStart > 0 && guestEnd > guestStart && guestEnd < start);
  const gate = new Function("auth", "currentAttachments", source.slice(guestStart, guestEnd));
  for (const attachments of [[{ type: "file" }], [{ type: "image" }]]) {
    const response = gate(null, attachments);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "authentication_required");
  }
  assert.equal(gate(null, []), undefined);
  assert.equal(gate({}, [{ type: "file" }]), undefined);
});
