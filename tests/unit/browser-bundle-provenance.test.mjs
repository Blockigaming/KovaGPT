import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyBrowserBundle } from "../../scripts/verify-browser-bundle.mjs";

const REF = "oztdrjtdglkizlewnulh";

function bundle(content) {
  const directory = mkdtempSync(join(tmpdir(), "kova-browser-bundle-"));
  writeFileSync(join(directory, "app.js"), content);
  return directory;
}

test("accepts exactly one URL for the expected Supabase project", () => {
  assert.deepEqual(
    verifyBrowserBundle({
      directory: bundle(`https://${REF}.supabase.co`),
      expectedProjectRef: REF,
    }),
    { refs: [REF], urlCount: 1 },
  );
});

test("rejects a wrong, missing, or duplicated Supabase project URL", () => {
  for (const content of [
    "no backend here",
    "https://zrzwkqrwurgutrmvalri.supabase.co",
    `https://${REF}.supabase.co https://${REF}.supabase.co`,
  ]) {
    assert.throws(
      () => verifyBrowserBundle({ directory: bundle(content), expectedProjectRef: REF }),
      /Expected exactly one Supabase URL/u,
    );
  }
});

test("rejects sensitive credential patterns", () => {
  for (const secret of [
    "sb_secret_not-for-a-browser",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
    "postgresql://user:password@database.internal/db",
    "-----BEGIN PRIVATE KEY-----",
  ]) {
    assert.throws(
      () =>
        verifyBrowserBundle({
          directory: bundle(`https://${REF}.supabase.co ${secret}`),
          expectedProjectRef: REF,
        }),
      /Browser bundle contains/u,
    );
  }
});
