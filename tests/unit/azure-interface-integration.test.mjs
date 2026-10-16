import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { CORE_LAUNCH_FAMILY_MANAGEMENT } from "../../src/lib/core-launch-policy.mjs";

const read = (path) => readFileSync(path, "utf8");

test("reduced launch cannot mount family creation or invitation controls", () => {
  assert.equal(CORE_LAUNCH_FAMILY_MANAGEMENT, false);
  const source = ts.createSourceFile(
    "SettingsDialog.tsx",
    read("src/components/SettingsDialog.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const expressions = [];
  function visit(node) {
    if (
      ts.isConditionalExpression(node) &&
      node.condition.getText(source) === "!CORE_LAUNCH_FAMILY_MANAGEMENT"
    )
      expressions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(expressions.length, 1);
  const boundary = expressions[0];
  assert.match(boundary.whenTrue.getText(source), /Existing shared\s+plan access is unchanged/);
  assert.doesNotMatch(boundary.whenTrue.getText(source), /FamilySharingPanel|SignInGate/);
  assert.match(boundary.whenFalse.getText(source), /FamilySharingPanel/);
  assert.match(read("src/components/SettingsDialog.tsx"), /getSubscriptionSummary/);
  assert.match(read("src/components/SettingsDialog.tsx"), /familyTierUpgrade/);
});

test("merged Auth dialog keeps the public-origin browser binding and DOT inline recovery", () => {
  const dialog = read("src/components/auth/AuthDialog.tsx");
  assert.match(dialog, /useAuthProviders\(open && !useKovaAuth\)/);
  assert.match(dialog, /new URL\("\/api\/auth\/google\/start", window.location.origin\)/);
  assert.match(dialog, /data-auth-step=\{step\}/);
  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /reportError\("Google sign in could not start/);
  assert.doesNotMatch(dialog, /browserKovaAuthOrigin/);
});

test("Interface settings retain captured-owner deletion and uncertain-outcome protections", () => {
  const settings = read("src/components/SettingsDialog.tsx");
  assert.match(settings, /const deletionUserKey = userKey/);
  assert.match(settings, /currentAuthUserKeyRef.current === deletionUserKey/);
  assert.match(settings, /requestAccountDeletion\(deletionUserKey, "DELETE"\)/);
  assert.match(settings, /Deletion may have started/);
  assert.match(settings, /deleteConfirmation !== "DELETE"/);
});
