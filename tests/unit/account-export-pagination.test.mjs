import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { readAccountExportRows } from "../../src/lib/account-export-pagination.mjs";

test("real PostgREST queries preserve every row across stable composite-key pages", async () => {
  const source = Array.from({ length: 1001 }, (_, index) => ({
    user_id: "owner",
    usage_date: String(index).padStart(4, "0"),
    chats: index,
  }));
  const calls = [];
  const client = createClient("https://export.example", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        assert.equal(url.searchParams.get("user_id"), "eq.owner");
        assert.equal(url.searchParams.get("order"), "user_id.asc,usage_date.asc");
        const offset = Number(url.searchParams.get("offset"));
        const limit = Number(url.searchParams.get("limit"));
        calls.push({ offset, limit });
        return Response.json(source.slice(offset, offset + limit));
      },
    },
  });
  const rows = await readAccountExportRows(
    () => client.from("daily_usage").select("*").eq("user_id", "owner"),
    "daily_usage",
    500,
    2000,
  );
  assert.deepEqual(rows, source);
  assert.deepEqual(calls, [
    { offset: 0, limit: 500 },
    { offset: 500, limit: 500 },
    { offset: 1000, limit: 500 },
  ]);
});

test("a full final page must prove termination and never silently truncates", async () => {
  function query(count, calls) {
    return () => ({
      order() {
        return this;
      },
      async range(from, to) {
        calls.push(from);
        return {
          data: Array.from({ length: count }, (_, id) => ({ id })).slice(from, to + 1),
          error: null,
        };
      },
    });
  }
  const calls = [];
  assert.equal((await readAccountExportRows(query(4, calls), "canvas_documents", 2, 4)).length, 4);
  assert.deepEqual(calls, [0, 2, 4]);
  await assert.rejects(
    readAccountExportRows(query(5, []), "canvas_documents", 2, 4),
    /row_limit_exceeded/,
  );
  await assert.rejects(
    readAccountExportRows(query(1, []), "canvas_documents", 2, 0),
    /row_limit_exceeded/,
  );
});

test("later-page failures and null data cannot produce a successful partial export", async () => {
  for (const next of [
    { data: null, error: null },
    { data: null, error: { message: "private SQL" } },
  ]) {
    await assert.rejects(
      readAccountExportRows(
        () => ({
          order() {
            return this;
          },
          async range(from) {
            return from ? next : { data: [{ id: 1 }, { id: 2 }], error: null };
          },
        }),
        "canvas_documents",
        2,
        10,
      ),
      /account_export_database_unavailable/,
    );
  }
});

test("Google preferences and Site children export through their complete actual primary keys", async () => {
  const keys = {
    google_connection_preferences: ["user_id"],
    kova_site_files: ["version_id", "path"],
    kova_site_aliases: ["site_id", "slug"],
    kova_site_viewers: ["site_id", "viewer_id"],
  };
  const client = createClient("https://export.example", "fixture", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input) => {
        const url = new URL(input);
        const table = url.pathname.split("/").at(-1);
        const expected = keys[table];
        assert.equal(url.searchParams.get("order"), expected.map((key) => `${key}.asc`).join(","));
        return Response.json([Object.fromEntries(expected.map((key) => [key, "fixture-value"]))]);
      },
    },
  });
  for (const table of Object.keys(keys)) {
    const rows = await readAccountExportRows(
      () => client.from(table).select("*"),
      table,
      500,
      1000,
    );
    assert.equal(rows.length, 1);
  }
});
