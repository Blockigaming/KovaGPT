import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const pending = new URL("../../supabase/pending/", import.meta.url);
const canonical = new URL("../../supabase/migrations/", import.meta.url);

test("developer migration sources are canonical, ordered and included in the release manifest", async () => {
  const names = [
    "developer_workspace_v2.sql",
    "developer_credit_lots_v2.sql",
    "developer_credit_lot_integration_v2.sql",
    "developer_vector_stores_v1.sql",
    "developer_conversations_v1.sql",
    "developer_agents_v1.sql",
    "developer_skills_v1.sql",
    "developer_webhooks_v1.sql",
    "developer_batches_v1.sql",
    "developer_mcp_connections_v1.sql",
    "developer_prompts_v1.sql",
    "developer_uploads_v1.sql",
    "developer_webhook_retry_v1.sql",
  ];
  const files = await readdir(canonical);
  const manifest = JSON.parse(
    await readFile(new URL("../../release-migrations.json", import.meta.url), "utf8"),
  );
  let previous = "";
  for (const name of names) {
    const matches = files.filter((file) => file.endsWith(`_${name}`));
    assert.equal(matches.length, 1, name);
    const [file] = matches;
    assert.match(file, /^\d{14}_developer_.*\.sql$/);
    assert.ok(file.slice(0, 14) > previous, name);
    previous = file.slice(0, 14);
    const sql = await readFile(new URL(file, canonical), "utf8");
    assert.equal(sql, await readFile(new URL(name, pending), "utf8"), name);
    const functions = (sql.match(/^create (?:or replace )?function /gm) ?? []).length;
    assert.equal((sql.match(/\$\$/g) ?? []).length, functions * 2, name);
    assert.doesNotMatch(sql, /(?:\bas \$\s*$|^(?:end )?\$;\s*$)/m);
    assert.equal(
      manifest.migrations.find((entry) => entry.filename === file)?.sha256,
      createHash("sha256").update(sql).digest("hex"),
      file,
    );
  }
});
