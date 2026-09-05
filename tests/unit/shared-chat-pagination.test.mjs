import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const source = await readFile("src/lib/shared-chats.functions.ts", "utf8");
const script = ts.transpileModule(
  source.replace(/^import .*;\n/gmu, "").replace(/^export /gmu, ""),
  { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } },
).outputText;
const context = {
  z,
  console: { error() {}, warn() {} },
  requireSupabaseAuth: {},
  createServerFn: () => ({
    middleware() {
      return this;
    },
    validator() {
      return this;
    },
    handler(fn) {
      return fn;
    },
  }),
};
vm.runInNewContext(`${script}\nglobalThis.listInbox = listSharedWithMe;`, context);

const caller = "123e4567-e89b-42d3-a456-426614174000";
const sender = "123e4567-e89b-42d3-a456-426614174001";
const otherUser = "123e4567-e89b-42d3-a456-426614174002";
const snapshot = { messages: [{ role: "assistant", content: "Shared response" }] };
const makeRow = (index, overrides = {}) => ({
  id: String(index).padStart(5, "0"),
  owner_user_id: sender,
  recipient_user_id: caller,
  title: `Snapshot ${index}`,
  status: "pending",
  created_at: "2026-09-04T00:00:00.000Z",
  snapshot,
  ...overrides,
});

function database(rows, failAtOffset = null) {
  const requests = [];
  const supabase = createClient("https://example.supabase.co", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer caller-token" },
      fetch: async (input, init) => {
        const query = new URL(input).searchParams;
        const offset = Number(query.get("offset"));
        const limit = Number(query.get("limit"));
        requests.push({ offset, limit });
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer caller-token");
        assert.equal(query.get("owner_user_id"), `neq.${caller}`);
        assert.equal(query.get("status"), "neq.revoked");
        assert.equal(query.get("order"), "created_at.desc,id.desc");
        assert.ok(limit <= 200, "requests must use bounded pages");
        if (offset === failAtOffset) {
          return Response.json({ message: "database unavailable" }, { status: 500 });
        }
        // Model the existing owner/recipient RLS before applying PostgREST filters.
        const visible = rows
          .filter((row) => row.owner_user_id === caller || row.recipient_user_id === caller)
          .filter((row) => row.owner_user_id !== caller && row.status !== "revoked")
          .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
        return Response.json(visible.slice(offset, offset + limit));
      },
    },
  });
  return { supabase, requests };
}

test("received inbox spans all pages despite a larger, newer sent history", async () => {
  const received = Array.from({ length: 405 }, (_, i) => makeRow(i));
  const sent = Array.from({ length: 250 }, (_, i) =>
    makeRow(1_000 + i, { owner_user_id: caller, recipient_user_id: otherUser }),
  );
  const { supabase, requests } = database([
    ...sent,
    ...received,
    makeRow(2_000, { status: "revoked" }),
    makeRow(2_001, { recipient_user_id: otherUser }),
  ]);
  const inbox = await context.listInbox({ context: { supabase, userId: caller } });
  assert.equal(inbox.length, 405);
  assert.deepEqual(
    Array.from(inbox, (row) => row.id),
    received.map((row) => row.id).reverse(),
  );
  assert.deepEqual(requests, [
    { offset: 0, limit: 200 },
    { offset: 200, limit: 200 },
    { offset: 400, limit: 200 },
  ]);
});

test("a malformed full page cannot hide older valid received snapshots", async () => {
  const { supabase, requests } = database([
    makeRow(0),
    ...Array.from({ length: 200 }, (_, i) => makeRow(i + 1, { snapshot: { messages: [] } })),
  ]);
  const inbox = await context.listInbox({ context: { supabase, userId: caller } });
  assert.deepEqual(
    Array.from(inbox, (row) => row.id),
    ["00000"],
  );
  assert.equal(requests.length, 2);
});

test("a later page failure fails the inbox load instead of reporting partial success", async () => {
  const { supabase } = database(
    Array.from({ length: 201 }, (_, i) => makeRow(i)),
    200,
  );
  await assert.rejects(
    context.listInbox({ context: { supabase, userId: caller } }),
    /Chats shared with you could not be loaded/u,
  );
});
