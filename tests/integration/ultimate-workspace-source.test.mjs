import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Writing Workspace keeps bounded local versions and exports portable formats", () => {
  const source = read("src/routes/write.tsx");
  assert.match(source, /kova\.write\.versions\.v1/);
  assert.match(source, /\.slice\(0, 20\)/);
  assert.match(source, />\s*Save version\s*</);
  assert.match(source, /Version restored/);
  assert.match(source, /text\/html/);
  assert.match(source, /Download HTML/);
  assert.doesNotMatch(source, /\bconfirm\(/);
});

test("destructive workspace actions use accessible application dialogs", () => {
  for (const path of [
    "src/routes/write.tsx",
    "src/routes/memory.tsx",
    "src/routes/library.tsx",
    "src/routes/projects.tsx",
    "src/routes/apps.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /ConfirmActionDialog/);
    assert.doesNotMatch(source, /\bconfirm\(/);
  }
});

test("GitHub disconnect targets the selected account and withholds unsafe bulk removal", () => {
  const source = read("src/routes/apps.tsx");
  assert.match(source, /setDisconnectAccount\(\{ id: account\.id, login: account\.login \}\)/);
  assert.match(source, /const accountId = disconnectAccount\.id/);
  assert.match(source, /removeData: false/);
  assert.match(source, /account-scoped data removal is not available yet/);
  assert.doesNotMatch(source, /data\.accounts\[0\]\.id|removeData: true/);
  assert.match(source, /\["connected", "degraded"\]\.includes\(account\.status\)/);
  assert.match(source, /activeAccountIds\.has\(installation\.account_id\)/);
  assert.match(source, /activeInstallationIds\.has\(String\(repo\.installation_id\)\)/);
  assert.match(source, /!activeAccounts\.length/);
  assert.match(source, /Connect again/);
});

test("dialog positioning is not overwritten by the shared menu transform animation", () => {
  const styles = read("src/styles.css");
  assert.doesNotMatch(styles, /:where\(\[role="dialog"\],[^\n]+\)\[data-state="open"\]/);
  assert.match(styles, /:where\(\[role="menu"\], \[role="listbox"\]\)\[data-state="open"\]/);
});
