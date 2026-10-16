import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const { readCollectionPage } = loadUiModule(
  process.env.KOVA_COLLECTION_HELPER ?? "src/lib/read-bounded-collection.ts",
  { zod: { z } },
  { AbortSignal, TextEncoder, Error },
);
function load(path, name) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((n) => [...n.declarationList.declarations])
    .find((n) => n.name.getText(source) === name);
  const fn = declaration.initializer.arguments[0].getText(source);
  const js = ts.transpileModule("const fn=" + fn, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("readCollectionPage", "loose", "table", "t", js + ";return fn;")(
    readCollectionPage,
    (client) => client,
    (client, name) => client.from(name),
    (client, name) => client.from(name),
  );
}
for (const [name, path] of [
  ["listContextPacks", "src/lib/workspace.functions.ts"],
  ["listMemoryCenter", "src/lib/workspace.functions.ts"],
  ["listPromptTemplates", "src/lib/professional.functions.ts"],
  ["listResearchTemplates", "src/lib/professional.functions.ts"],
]) {
  test(`${name} returns one bounded page with explicit continuation and authorized query scope`, async () => {
    const rows = Array.from({ length: 50003 }, (_, n) => ({
      id: String(n).padStart(8, "0"),
      name: `record-${n}`,
      title: `record-${n}`,
      user_id: "actor",
      summary: "memory",
      content: "project memory",
      project_id: "project",
      created_at: "2026-10-12T00:00:00Z",
      updated_at: "2026-10-12T00:00:00Z",
      items: [],
    }));
    const queryScopes = [];
    const client = {
      from(table) {
        let after = null,
          limit = 1000,
          owner = null;
        const query = {
          select(_columns, options) {
            assert.equal(options?.count, undefined, "do not count the full remaining collection");
            return query;
          },
          eq(key, value) {
            if (key === "user_id") owner = value;
            return query;
          },
          gt(_key, value) {
            after = value;
            return query;
          },
          order() {
            return query;
          },
          limit(value) {
            limit = value;
            return query;
          },
          abortSignal(signal) {
            assert.equal(signal.aborted, false);
            return query;
          },
          then(resolve, reject) {
            queryScopes.push({ table, owner });
            const left = rows.filter((row) => after === null || row.id > after);
            return Promise.resolve({
              data: left.slice(0, Math.min(limit, 17)),
              count: left.length,
              error: null,
            }).then(resolve, reject);
          },
        };
        return query;
      },
    };
    const handler = load(path, name);
    let cursor = null;
    const seen = new Set();
    for (let action = 0; action < 3; action++) {
      const previousCalls = queryScopes.length;
      const result = await handler({
        data: { cursor },
        context: { supabase: client, userId: "actor" },
      });
      assert.equal(
        queryScopes.length - previousCalls,
        1,
        "each explicit action issues exactly one query",
      );
      assert.ok(
        result.items.length <=
          (name === "listContextPacks" ? 1 : name === "listPromptTemplates" ? 20 : 10),
      );
      for (const item of result.items) {
        assert.equal(seen.has(item.id), false);
        seen.add(item.id);
      }
      assert.ok(result.cursor, "large collection has a continuation");
      cursor = result.cursor;
    }
    for (const request of queryScopes)
      if (request.table !== "project_memory") assert.equal(request.owner, "actor");
  });
}
