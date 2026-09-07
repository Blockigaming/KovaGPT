import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import { z } from "zod";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
function load(
  path,
  modules,
  fetcher = () => {
    throw new Error("Unexpected fetch");
  },
) {
  const exports = {};
  new Function(
    "exports",
    "require",
    "fetch",
    ts.transpileModule(fs.readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(
    exports,
    (name) => {
      assert.ok(modules[name], name);
      return modules[name];
    },
    fetcher,
  );
  return exports;
}
test("image browser transport pins the bearer token to the initiating account", async () => {
  let calls = 0;
  const session = { user: { id: "another-account" }, access_token: "secret" };
  const api = load(
    "src/lib/image-api-client.ts",
    {
      "@/integrations/supabase/client": {
        supabase: { auth: { getSession: async () => ({ data: { session } }) } },
      },
      "@/lib/endpoint-reliability.mjs": reliability,
    },
    async (_path, init) => {
      calls++;
      assert.equal(init.headers.Authorization, "Bearer secret");
      assert.equal(init.credentials, "omit");
      return Response.json({ editingEnabled: false });
    },
  );
  await assert.rejects(
    api.imageApiRequest(owner, "/api/generate-image", new AbortController().signal),
    /account changed/,
  );
  assert.equal(calls, 0);
  session.user.id = owner;
  assert.equal(
    (await api.imageApiRequest(owner, "/api/generate-image", new AbortController().signal)).body
      .editingEnabled,
    false,
  );
  assert.equal(calls, 1);
});
test("image browser transport aborts a pending session lookup and rejects an oversized source list", async () => {
  const controller = new AbortController();
  let api = load("src/lib/image-api-client.ts", {
    "@/integrations/supabase/client": {
      supabase: { auth: { getSession: () => new Promise(() => {}) } },
    },
    "@/lib/endpoint-reliability.mjs": reliability,
  });
  const pending = api.imageApiRequest(owner, "/api/generate-image", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  api = load(
    "src/lib/image-api-client.ts",
    {
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: owner }, access_token: "token" } },
            }),
          },
        },
      },
      "@/lib/endpoint-reliability.mjs": reliability,
    },
    async () =>
      new Response("x".repeat(65537), { headers: { "Content-Type": "application/json" } }),
  );
  await assert.rejects(
    api.imageApiRequest(owner, "/api/generate-image", new AbortController().signal),
  );
});
test("saving an image rejects a changed account before reading private bytes or performing storage work", async () => {
  const chain = { middleware: () => chain, validator: () => chain, handler: (fn) => fn };
  const api = load("src/lib/library-images.functions.ts", {
    "@tanstack/react-start": { createServerFn: () => chain },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/lockdown-policy.mjs": {},
    "@/lib/library-storage-policy": {},
    "@/lib/safe-image-url": { MAX_SAFE_IMAGE_DATA_URL_CHARS: 12000000 },
    zod: { z },
    "@/lib/library-save-idempotency.mjs": {},
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/account-storage-artifacts.server": {},
    "@/integrations/supabase/client.server": { supabaseAdmin: {} },
    "@/lib/runtime-env.server": {
      runtimeEnv: () => {
        throw new Error("Unexpected environment read");
      },
    },
    "@/lib/library-image-storage.server.mjs": {
      publishLibraryImageBytes: () => {
        throw new Error("Unexpected publication");
      },
    },
  });
  await assert.rejects(
    api.saveImageToLibrary({
      data: { expectedOwnerId: owner, imageUrl: "https://private.invalid/image" },
      context: { userId: "another-account" },
    }),
    /account changed/,
  );
});
