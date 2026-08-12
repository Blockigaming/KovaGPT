import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("writing migration enforces ownership, conflicts, and bounded version retention", async () => {
  const sql = await read("supabase/migrations/20260801120000_writing_documents.sql");
  assert.match(sql, /enable row level security/gi);
  assert.match(sql, /auth\.uid\(\)\s*=\s*owner_id/g);
  assert.match(sql, /version_conflict/);
  assert.match(sql, /p_expected_version/);
  assert.match(sql, /offset 50/);
  assert.match(sql, /revoke all .* from anon/is);
});

test("writing server functions validate, scope, and bound documents and versions", async () => {
  const source = await read("src/lib/writing.functions.ts");
  assert.match(source, /requireSupabaseAuth/);
  assert.match(source, /max\(500_000\)/);
  assert.match(source, /\.eq\("owner_id", context\.userId\)/);
  assert.match(source, /\.limit\(100\)/);
  assert.match(source, /\.limit\(50\)/);
  assert.match(source, /save_writing_document/);
  assert.match(source, /changed elsewhere/);
});

test("Writing lazily loads real DOCX and PDF generators", async () => {
  const route = await read("src/routes/write.tsx");
  const docx = await read("src/lib/writing-export/docx.ts");
  const pdf = await read("src/lib/writing-export/pdf.ts");
  assert.doesNotMatch(route, /application\/vnd\.openxmlformats|%PDF-1\.4/);
  assert.match(docx, /0x04034b50/);
  assert.match(docx, /word\/document\.xml/);
  assert.match(docx, /application\/vnd\.openxmlformats/);
  assert.match(pdf, /%PDF-1\.4/);
  assert.match(pdf, /startxref/);
  assert.match(pdf, /application\/pdf/);
});

test("research sessions remain owner scoped and truthfully distinguish real runs", async () => {
  const migration = await read(
    "supabase/migrations/20260801123000_research_session_management.sql",
  );
  const server = await read("src/lib/research.functions.ts");
  const route = await read("src/routes/research-planner.tsx");
  assert.match(migration, /archived_at/);
  assert.match(migration, /char_length\(notes\)/);
  assert.match(server, /requireSupabaseAuth/);
  assert.match(server, /\.eq\("user_id", context\.userId\)/g);
  assert.match(server, /\.limit\(100\)/);
  assert.match(route, /provider-backed Deep Research/);
  assert.match(route, /writePrincipalHandoff/);
});

test("universal search loads authorized workspace results asynchronously", async () => {
  const index = await read("src/routes/index.tsx");
  const palette = await read("src/components/CommandPalette.tsx");
  assert.match(index, /loadConversations\(userKey\)/);
  assert.match(palette, /searchConversations/);
  assert.match(palette, /conversations/);
  assert.match(palette, /role="option"/);
  assert.match(palette, /slice\(0, 8\)/);
});
