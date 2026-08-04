import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../supabase/migrations/20260731120000_feedback_submissions_hardening.sql",
    import.meta.url,
  ),
  "utf8",
);
const server = readFileSync(
  new URL("../../src/lib/feedback.functions.ts", import.meta.url),
  "utf8",
);

test("response feedback migration enforces authenticated owner isolation", () => {
  assert.match(migration, /alter column owner_id set not null/i);
  assert.match(migration, /for insert to authenticated[\s\S]*auth\.uid\(\) = owner_id/i);
  assert.match(
    migration,
    /for update to authenticated[\s\S]*using \(auth\.uid\(\) = owner_id\)[\s\S]*with check \(auth\.uid\(\) = owner_id\)/i,
  );
  assert.match(migration, /for delete to authenticated[\s\S]*auth\.uid\(\) = owner_id/i);
  assert.match(migration, /revoke all on public\.feedback_submissions from anon/i);
});

test("response feedback is deduplicated, bounded, timestamped, and safely reported", () => {
  assert.match(migration, /unique index[\s\S]*\(owner_id, message_id\)/i);
  assert.match(migration, /duplicate_key ~ '\^\[0-9a-f\]\{64\}\$'/i);
  assert.match(migration, /char_length\(context_excerpt\) <= 2000/i);
  assert.match(migration, /before update[\s\S]*set_feedback_submission_updated_at/i);
  assert.match(server, /\.max\(2_000\)/);
  assert.match(server, /Feedback could not be saved\./);
  assert.doesNotMatch(server, /error\.message|error\.details|error\.hint/);
});
