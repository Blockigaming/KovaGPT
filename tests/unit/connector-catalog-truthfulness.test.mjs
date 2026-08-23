import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/connectors-catalog.ts", "utf8");

function entries() {
  const start = source.indexOf("export const CONNECTOR_CATALOG: ConnectorItem[] = [");
  const end = source.indexOf("\n];", start);
  assert.ok(start > 0 && end > start, "connector catalog array must be parseable");
  return source
    .slice(start, end)
    .split(/\n(?=  \{\n)/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.startsWith("{"))
    .map((chunk) => ({
      raw: chunk,
      id: /id:\s*"([^"]+)"/.exec(chunk)?.[1],
      label: /label:\s*"([^"]+)"/.exec(chunk)?.[1],
      status: /status:\s*"([^"]+)"/.exec(chunk)?.[1],
      legacyProvider: /legacyProvider:\s*"([^"]+)"/.exec(chunk)?.[1] ?? null,
    }));
}

test("every catalog entry has an id, label, and known lifecycle status", () => {
  const items = entries();
  assert.ok(items.length > 100, "catalog should still list the full service directory");
  for (const item of items) {
    assert.ok(item.id, `entry missing id: ${item.raw.slice(0, 80)}`);
    assert.ok(item.label, `entry missing label: ${item.id}`);
    assert.ok(
      ["live", "setup_required", "planned"].includes(item.status),
      `entry ${item.id} has unknown status ${item.status}`,
    );
  }
});

test("catalog ids are unique so Apps and Settings cannot render duplicates", () => {
  const ids = entries().map((item) => item.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicates, [], `duplicate connector ids: ${duplicates.join(", ")}`);
});

test("only connectors with a wired provider flow may claim live status", () => {
  const dishonest = entries()
    .filter((item) => item.status === "live" && !item.legacyProvider)
    .map((item) => item.id);
  assert.deepEqual(
    dishonest,
    [],
    `these entries claim to be live with no connect flow: ${dishonest.join(", ")}`,
  );
});

test("the vast majority of catalog entries are honestly marked as not yet available", () => {
  const items = entries();
  const live = items.filter((item) => item.status === "live");
  assert.ok(live.length > 0, "at least one connector must actually work");
  assert.ok(
    live.length < 20,
    `only genuinely wired connectors may be live, found ${live.length}`,
  );
});

test("no UI surface offers a fake notification signup for unavailable connectors", () => {
  for (const file of ["src/components/SettingsDialog.tsx", "src/routes/apps.tsx"]) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      /Notify me/,
      `${file} must not promise notifications it never sends`,
    );
  }
});
