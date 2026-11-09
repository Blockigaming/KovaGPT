import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {
  chatUsageWindows,
  CHAT_USAGE_WINDOWS,
  isUnlimitedBasicChat,
} from "../../src/lib/plan-usage-policy.mjs";
import {
  appearanceValues,
  applyReadingPreferences,
} from "../../src/lib/appearance-preferences.mjs";

const source = readFileSync("src/routes/index.tsx", "utf8");
const file = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
let assignment;
function visit(node) {
  if (
    ts.isBinaryExpression(node) &&
    node.left.getText(file) === "skipThinkingRef.current" &&
    ts.isConditionalExpression(node.right)
  )
    assignment = node.getText(file);
  ts.forEachChild(node, visit);
}
visit(file);
assert.ok(assignment);
const compiled = ts.transpileModule(assignment, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture({ current = true, quickAnswer = false } = {}) {
  const controller = new AbortController();
  const skipThinkingRef = { current: null };
  const retryGenerationRef = { current: 1 };
  const inFlightRef = { current: true };
  const calls = [];
  const dependencies = {
    controller,
    skipThinkingRef,
    retryGenerationRef,
    inFlightRef,
    quickAnswer,
    voiceRequest: undefined,
    isCurrentRequest: () => current,
    inFlightTargetRef: { current: { assistantMessageId: "reply" } },
    assistantMsg: { id: "reply" },
    USER_STOP_REASON: "user_stop",
    send: (...args) => calls.push(args),
    text: "Original request",
    atts: [],
    retryTool: null,
    nextConvId: "chat",
    priorMessages: [],
    newId: () => "new-attempt",
  };
  new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  return { controller, skipThinkingRef, retryGenerationRef, inFlightRef, calls };
}
test("Skip aborts the old attempt and explicitly requests the original prompt in faster mode", () => {
  const f = fixture();
  f.skipThinkingRef.current();
  assert.equal(f.controller.signal.aborted, true);
  assert.equal(f.retryGenerationRef.current, 2);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0][0], "Original request");
  assert.equal(f.calls[0][6], "new-attempt");
  assert.equal(f.calls[0][9], true);
  assert.equal(f.skipThinkingRef.current, null);
});
test("Skip cannot restart a stale account request or a second quick attempt", () => {
  const stale = fixture({ current: false });
  stale.skipThinkingRef.current();
  assert.equal(stale.calls.length, 0);
  assert.equal(stale.controller.signal.aborted, false);
  assert.equal(fixture({ quickAnswer: true }).skipThinkingRef.current, null);
});
test("imported interface preferences are bounded and cannot inject arbitrary CSS", () => {
  const values = appearanceValues({
    interfaceSize: 900,
    settingsNavigationWidth: -10,
    interfaceAccent: "url(https://invalid.test)",
  });
  assert.equal(values.interfaceSize, 125);
  assert.equal(values.settingsNavigationWidth, 200);
  assert.equal(values.interfaceAccent, "");
  const properties = new Map();
  const root = {
    style: {
      setProperty: (key, value) => properties.set(key, value),
      removeProperty: (key) => properties.delete(key),
    },
    dataset: {},
  };
  applyReadingPreferences(root, {
    interfaceSize: 110,
    settingsNavigationWidth: 320,
    interfaceAccent: "#12abcd",
  });
  assert.equal(root.style.fontSize, "17.6px");
  assert.equal(properties.get("--kova-settings-navigation-width"), "320px");
  assert.equal(properties.get("--primary"), "#12abcd");
  applyReadingPreferences(root, {});
  assert.equal(properties.has("--primary"), false);
});

test("daily message quota rejects with the popup category while unavailable accounting remains a service error", async () => {
  const source = readFileSync("src/lib/message-quota.server.ts", "utf8");
  const file = ts.createSourceFile(
    "quota.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = file.statements
    .find(
      (node) => ts.isFunctionDeclaration(node) && node.name?.text === "enforceDailyMessageQuota",
    )
    .getText(file)
    .replace(/^export /, "");
  const code = ts.transpileModule(declaration, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const enforce = new Function(
    "chatUsageWindows",
    "CHAT_USAGE_WINDOWS",
    "isUnlimitedBasicChat",
    "loose",
    `${code}; return enforceDailyMessageQuota;`,
  )(chatUsageWindows, CHAT_USAGE_WINDOWS, isUnlimitedBasicChat, (value) => value);
  const caller = (result) => ({
    userId: "owner",
    supabaseAdmin: { rpc: () => Promise.resolve(result) },
  });
  const rejected = await enforce(caller({ data: "five_hour", error: null }), "free", false);
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).category, "quota_exceeded");
  const unavailable = await enforce(
    caller({ data: null, error: { code: "unavailable" } }),
    "free",
    false,
  );
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).category, undefined);
  const noRpc = {
    userId: "owner",
    supabaseAdmin: {
      rpc: () => {
        throw Error("included basic chat must not spend an advanced message slot");
      },
    },
  };
  assert.equal(
    await enforce(noRpc, "pro", false, undefined, { modelId: "kova-argon-4.6", mode: "instant" }),
    null,
  );
  for (const [tier, modelId, mode] of [
    ["free", "kova-argon-4.6", "instant"],
    ["plus", "kova-argon-4.6", "instant"],
    ["pro", "kova-argon-4.6", "thinking"],
    ["pro", "kova-neon-4.6", "instant"],
    ["pro", "kova-xenon-5", "instant"],
  ]) {
    const exhausted = caller({ data: tier === "free" ? "five_hour" : "weekly", error: null });
    assert.equal(
      (await enforce(exhausted, tier, mode !== "instant", undefined, { modelId, mode })).status,
      429,
    );
  }
});
