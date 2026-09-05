import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import {
  readAccountExportRows,
  createAccountExportReadBudget,
} from "../../src/lib/account-export-pagination.mjs";

test("large Work and document pages share a cumulative byte cap and stop every reader after rejection", async () => {
  const budget = createAccountExportReadBudget(2 * 1024 * 1024);
  const calls = [];
  const query = (table) => () => ({
    order() {
      return this;
    },
    async range(from, to) {
      calls.push({ table, from, to });
      return {
        data: Array.from({ length: to - from + 1 }, (_, i) => ({
          id: from + i,
          state: "a".repeat(256 * 1024),
        })),
        error: null,
      };
    },
  });
  await assert.rejects(
    readAccountExportRows(query("work_execution_runs"), "work_execution_runs", 500, 100000, budget),
    /too_large/,
  );
  assert.deepEqual(calls, [{ table: "work_execution_runs", from: 0, to: 7 }]);
  await assert.rejects(
    readAccountExportRows(query("canvas_documents"), "canvas_documents", 500, 100000, budget),
    /too_large/,
  );
  assert.equal(
    calls.length,
    1,
    "another collector must not fetch after the shared allocation budget is exhausted",
  );
});

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

test("Google preferences, Site children and Work events export through their complete actual primary keys", async () => {
  const keys = {
    google_connection_preferences: ["user_id"],
    work_execution_events: ["run_id", "revision"],
    scheduled_task_event_source_export_rows: ["grant_id"],
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
