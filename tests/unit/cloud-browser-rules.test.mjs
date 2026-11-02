import test from "node:test";
import assert from "node:assert/strict";
import {
  cloudBrowserOrigin,
  parseCloudBrowserRules,
  assertCloudBrowserDestination,
} from "../../src/lib/cloud-browser-rules.mjs";
import {
  readCloudBrowserRules,
  saveCloudBrowserRules,
} from "../../src/lib/cloud-browser-preferences.server.mjs";
import { parseWorkQuestionOptions } from "../../src/lib/work-question.mjs";
const owner = crypto.randomUUID();
test("site rules canonicalize exact HTTPS origins without granting subdomain or wildcard access", () => {
  assert.equal(cloudBrowserOrigin("EXAMPLE.com"), "https://example.com");
  for (const origin of [
    "http://example.com",
    "https://example.com/private",
    "https://example.com?code=secret",
    "https://user:pass@example.com",
    "https://*.example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://host.internal",
  ])
    assert.throws(() => cloudBrowserOrigin(origin));
  const rules = parseCloudBrowserRules({ sites: [{ origin: "example.com", access: "block" }] });
  assert.throws(() => assertCloudBrowserDestination(rules, "https://example.com/page"), /denied/);
  assert.doesNotThrow(() => assertCloudBrowserDestination(rules, "https://sub.example.com/page"));
  assert.throws(() =>
    parseCloudBrowserRules({ sites: [{ origin: "example.com", access: "allow" }] }),
  );
  assert.throws(() => parseCloudBrowserRules({ sites: [...rules.sites, ...rules.sites] }));
  assert.throws(() => parseCloudBrowserRules({ sites: [], password: "never" }));
});
function fixture() {
  let row = {
    settings: { lockdown_mode: true, unrelated: "preserve" },
    updated_at: "2026-11-01T00:00:00Z",
  };
  let conflict = false,
    unavailable = false;
  const client = {
    from(table) {
      assert.equal(table, "user_preferences");
      let patch,
        mode = "read";
      const filters = {};
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters[key] = value;
          return query;
        },
        abortSignal() {
          return query;
        },
        update(value) {
          mode = "update";
          patch = value;
          return query;
        },
        insert(value) {
          mode = "insert";
          patch = value;
          return query;
        },
        async maybeSingle() {
          if (unavailable) return { error: Error("offline") };
          if (mode === "read") {
            assert.equal(filters.user_id, owner);
            return { data: structuredClone(row) };
          }
          if (mode === "update") {
            assert.equal(filters.user_id, owner);
            assert.equal(filters.updated_at, row.updated_at);
            assert.equal(filters.settings, JSON.stringify(row.settings));
          }
          if (conflict) {
            row.settings.unrelated = "concurrent edit";
            return { data: null };
          }
          row = { settings: patch.settings, updated_at: patch.updated_at };
          return { data: structuredClone(row) };
        },
      };
      return query;
    },
  };
  return {
    client,
    row: () => row,
    conflict: () => {
      conflict = true;
    },
    offline: () => {
      unavailable = true;
    },
  };
}
test("account preferences preserve lockdown and fail on a concurrent write instead of replacing it", async () => {
  const f = fixture();
  assert.deepEqual(await readCloudBrowserRules(f.client, owner), { sites: [] });
  const rules = { sites: [{ origin: "https://example.com", access: "block" }] };
  assert.deepEqual(await saveCloudBrowserRules(f.client, owner, rules), rules);
  assert.equal(f.row().settings.lockdown_mode, true);
  assert.equal(f.row().settings.unrelated, "preserve");
  f.conflict();
  await assert.rejects(saveCloudBrowserRules(f.client, owner, { sites: [] }), /conflict/);
  assert.deepEqual(f.row().settings.cloud_browser, rules);
  assert.equal(f.row().settings.unrelated, "concurrent edit");
  f.offline();
  await assert.rejects(readCloudBrowserRules(f.client, owner), /unavailable/);
});
test("question choices are bounded, optional and distinct after whitespace normalization", () => {
  assert.equal(parseWorkQuestionOptions(undefined), undefined);
  assert.deepEqual(parseWorkQuestionOptions([" Work together ", "Show answer"]), [
    "Work together",
    "Show answer",
  ]);
  for (const value of [
    [],
    ["one"],
    ["same", " same "],
    ["", "two"],
    ["a".repeat(301), "two"],
    ["one", 2],
    ["one\u0000", "two"],
    Array.from({ length: 7 }, (_, index) => String(index)),
  ])
    assert.throws(() => parseWorkQuestionOptions(value));
});
