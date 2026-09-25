import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DAY15_CHAT_DATA_QUERY_SHA256,
  DAY15_CHAT_DATA_SQL,
  validateDay15ChatDataViolations,
} from "../../scripts/release/day15-chat-data-violations.mjs";

const sample = () => ({
  chat_branches: {
    bad_chat_id: 0,
    bad_conversation_id: 0,
    negative_message_index: 0,
    oversized_message_id_array: 0,
    self_parent: 0,
    wrong_parent_scope: 0,
    multiple_active: 0,
  },
  chat_custom_rules: { bad_chat_id: 0, bad_instruction: 0, missing_owner: 0 },
  chat_message_versions: {
    bad_chat_id: 0,
    bad_message_id: 0,
    bad_source: 0,
    retired_regeneration: 0,
    oversized_instruction: 0,
    oversized_or_missing_content: 0,
    bad_selection_pair: 0,
    wrong_branch_scope: 0,
    multiple_accepted: 0,
  },
  chat_pinned_files: {
    bad_chat_id: 0,
    bad_status: 0,
    retired_ready: 0,
    bad_source_project: 0,
    missing_owner: 0,
  },
});

test("Day-15 compatibility query returns only aggregate counts in one read-only snapshot", () => {
  assert.equal(
    DAY15_CHAT_DATA_QUERY_SHA256,
    createHash("sha256").update(DAY15_CHAT_DATA_SQL).digest("hex"),
  );
  assert.match(
    DAY15_CHAT_DATA_SQL,
    /^begin transaction isolation level repeatable read read only;/u,
  );
  assert.match(DAY15_CHAT_DATA_SQL, /count\(\*\) filter/u);
  assert.match(DAY15_CHAT_DATA_SQL, /from public\.chat_branches/u);
  const targetMigration = readFileSync(
    new URL(
      "../../supabase/migrations/20260904230332_canonical_chat_workspace_lineage_reconciliation.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(targetMigration, /check \(cardinality\(message_ids\) <= 512\)/u);
  assert.match(
    DAY15_CHAT_DATA_SQL,
    /cardinality\(b\.message_ids\) > 512\)::integer as oversized_message_id_array/u,
  );
  assert.doesNotMatch(DAY15_CHAT_DATA_SQL, /array_length\(b\.message_ids, 1\)/u);
  assert.match(DAY15_CHAT_DATA_SQL, /from public\.chat_custom_rules/u);
  assert.match(DAY15_CHAT_DATA_SQL, /from public\.chat_message_versions/u);
  assert.match(DAY15_CHAT_DATA_SQL, /from public\.chat_pinned_files/u);
  assert.doesNotMatch(DAY15_CHAT_DATA_SQL, /(?:array_agg|jsonb_agg|grouping sets|select\s+\*)/iu);
  assert.doesNotMatch(
    DAY15_CHAT_DATA_SQL,
    /\b(?:insert|update|delete|alter|drop|create|truncate|grant|revoke|copy)\s+(?:into|table|schema|function|public\.)/iu,
  );
  assert.match(DAY15_CHAT_DATA_SQL, /as violation_counts\s+from branch_counts/u);
});

test("Day-15 count validation fails closed on extra data, missing checks and tampered counts", () => {
  const result = validateDay15ChatDataViolations(sample());
  assert.equal(result.observedViolationCount, 0);
  assert.equal(result.schemaProofPromoted, false);
  const positive = sample();
  positive.chat_message_versions.retired_regeneration = 2;
  assert.equal(validateDay15ChatDataViolations(positive).observedViolationCount, 2);
  for (const change of [
    (c) => {
      c.chat_branches.bad_chat_id = -1;
    },
    (c) => {
      c.chat_branches.bad_chat_id = "0";
    },
    (c) => {
      c.chat_branches.bad_chat_id = 0.5;
    },
    (c) => {
      delete c.chat_custom_rules.bad_instruction;
    },
    (c) => {
      c.chat_message_versions.message_content = "secret";
    },
    (c) => {
      c.customer_id = "secret";
    },
    (c) => {
      c.chat_pinned_files.bad_status = Infinity;
    },
  ]) {
    const counts = sample();
    change(counts);
    assert.throws(() => validateDay15ChatDataViolations(counts));
  }
});
