import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ACADEMY_ACCOUNT_PERSISTENCE_ENABLED } from "../../src/lib/academy-state-policy.mjs";
import { ACCOUNT_EXPORT_DIRECT_TABLES } from "../../src/lib/account-export-policy.mjs";

const read = (path) => readFileSync(path, "utf8");
const migration = "20261012052309_academy_learning_state.sql";

test("paused Academy proposal is preserved exactly outside the launch migration path", () => {
  assert.equal(ACADEMY_ACCOUNT_PERSISTENCE_ENABLED, false);
  assert.equal(existsSync(`supabase/migrations/${migration}`), false);
  assert.equal(
    createHash("sha256")
      .update(read(`docs/release-proposals/deferred-interface/${migration}`))
      .digest("hex"),
    "ae71de43cbc27874a3209fb4552ef9f2b1818cfb04ae89f2b2daae620b5ab8be",
  );
  const manifest = JSON.parse(read("release-migrations.json"));
  assert.equal(
    manifest.migrations.some((entry) => entry.filename === migration),
    false,
  );
  assert.equal(manifest.count, manifest.migrations.length);
  const contract = JSON.parse(read("database-contract.json"));
  assert.equal(contract.migrationCount, manifest.count);
  assert.equal(contract.views.includes("academy_learning_export_rows"), false);
  assert.equal(contract.tables.includes("academy_learning_state"), false);
  assert.equal(
    ACCOUNT_EXPORT_DIRECT_TABLES.some(([table]) => table.startsWith("academy_")),
    false,
  );
});

test("paused Academy renders truthful device-only status, never account save controls", () => {
  const source = ts.createSourceFile(
    "AcademyPractice.tsx",
    read("src/components/public/AcademyPractice.tsx"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const expressions = [];
  function visit(node) {
    if (
      ts.isConditionalExpression(node) &&
      node.condition.getText(source) === "!ACADEMY_ACCOUNT_PERSISTENCE_ENABLED"
    )
      expressions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(expressions.length, 1);
  assert.match(expressions[0].whenTrue.getText(source), /paused for this launch/);
  assert.match(expressions[0].whenTrue.getText(source), /not\s+saved\s+to your account/);
  assert.doesNotMatch(expressions[0].whenTrue.getText(source), /<button|saveCurrent|refresh/);
  assert.match(expressions[0].whenFalse.getText(source), /Save current notes to account/);
  assert.match(source.text, /Export current notes/);
  assert.match(source.text, /DeviceRecoveryStatus/);
});
