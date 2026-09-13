import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import * as reliability from "../../src/lib/endpoint-reliability.mjs";
import * as transport from "../../src/lib/ai/provider-transport.server.mjs";
import * as policy from "../../src/lib/library-original-policy.mjs";
const owner = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222",
  gen = "33333333-3333-4333-8333-333333333333";
function load(file, modules, fetcher = () => assert.fail("Unexpected fetch")) {
  const exports = {};
  new Function(
    "exports",
    "require",
    "fetch",
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(
    exports,
    (key) => {
      assert.ok(modules[key], key);
      return modules[key];
    },
    fetcher,
  );
  return exports;
}
function routeFixture() {
  const state = { writes: [], reads: [], fail: false };
  const modules = {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/api-auth.server": {
      requireVerifiedUser: async () => ({ userId: owner, supabaseAdmin: {} }),
      getCallerTier: async () => "free",
      assertNotBanned: async () => null,
      assertFeatureEnabled: async () => null,
    },
    "@/lib/modes": { STORAGE_LIMITS_BYTES: { free: 500 } },
    "@/lib/distributed-rate-limit.server": {
      consumeApplicationRateLimit: async () => ({ allowed: true }),
    },
    "@/lib/endpoint-reliability.mjs": reliability,
    "@/lib/ai/provider-transport.server.mjs": transport,
    "@/lib/library-original-policy.mjs": policy,
    "@/lib/runtime-env.server": { runtimeEnv: () => "https://fixture.supabase.co" },
    "@/lib/library-original-files.server.mjs": {
      publishOriginalLibraryDocument: async (_admin, user, input, options) => {
        if (state.fail) throw new Error("Private SQL contents");
        state.writes.push({ user, input, options });
        policy.validateOriginalDocument(input);
        return { id, generation: gen };
      },
      downloadOriginalLibraryDocument: async (_admin, user, file, generation) => {
        state.reads.push({ user, file, generation });
        return {
          row: { mime_type: "application/pdf", file_name: "Résumé.pdf" },
          bytes: new TextEncoder().encode("%PDF-1.7 private original"),
        };
      },
    },
  };
  const route = load("src/routes/api/library/files.ts", modules).Route;
  return { state, handle: (request) => route.server.handlers[request.method]({ request }) };
}
test("binary original upload preserves bytes and extracted text without allowing an owner mismatch or extra multipart fields", async () => {
  const { state, handle } = routeFixture();
  const make = (extra = false) => {
    const form = new FormData();
    form.set(
      "file",
      new Blob(["%PDF-1.7 private original"], { type: "application/pdf" }),
      "Résumé.pdf",
    );
    form.set("text", "Extracted text");
    if (extra) form.set("unexpected", "no");
    return form;
  };
  let response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, { method: "POST", body: make() }),
  );
  assert.equal(response.status, 409);
  assert.equal(state.writes.length, 0);
  response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, {
      method: "POST",
      headers: { "X-Kova-Owner": owner },
      body: make(true),
    }),
  );
  assert.equal(response.status, 400);
  response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, {
      method: "POST",
      headers: { "X-Kova-Owner": owner },
      body: make(),
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].input.name, "Résumé.pdf");
  assert.equal(new TextDecoder().decode(state.writes[0].input.bytes), "%PDF-1.7 private original");
  assert.equal(state.writes[0].options.storageLimit, 500);
  assert.equal(state.writes[0].options.dailyLimit, undefined);
});
test("original download requires its displayed generation and returns a named private attachment", async () => {
  const { state, handle } = routeFixture();
  let response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, {
      headers: { "X-Kova-Owner": owner },
    }),
  );
  assert.equal(response.status, 409);
  assert.equal(state.reads.length, 0);
  response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}&generation=${gen}`, {
      headers: { "X-Kova-Owner": owner },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    response.headers.get("content-disposition"),
    /attachment; filename\*=UTF-8''R%C3%A9sum%C3%A9.pdf/,
  );
  assert.equal(await response.text(), "%PDF-1.7 private original");
});
test("oversized or malformed original requests fail before publication and private errors are redacted", async () => {
  const { state, handle } = routeFixture();
  let response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, {
      method: "POST",
      headers: {
        "X-Kova-Owner": owner,
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(11 * 1024 * 1024),
      },
      body: "x",
    }),
  );
  assert.equal(response.status, 413);
  assert.equal(state.writes.length, 0);
  response = await handle(
    new Request(`https://kova.test/api/library/files?id=${id}`, {
      method: "POST",
      headers: { "X-Kova-Owner": owner, "Content-Type": "multipart/form-data; boundary=x" },
      body: "invalid",
    }),
  );
  assert.equal(response.status, 400);
});
test("browser original-file transport pins the initiating account and sends the actual File through multipart", async () => {
  let account = "different",
    calls = 0;
  const api = load(
    "src/lib/library-original-client.ts",
    {
      sonner: { toast: { success: () => {} } },
      "@/integrations/supabase/client": {
        supabase: {
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: account }, access_token: "private token" } },
            }),
          },
        },
      },
      "@/lib/endpoint-reliability.mjs": reliability,
      "@/lib/library-original-policy.mjs": policy,
    },
    async (url, init) => {
      calls++;
      assert.equal(init.headers["X-Kova-Owner"], owner);
      assert.equal(init.credentials, "omit");
      assert.ok(init.body instanceof FormData);
      assert.equal(await init.body.get("file").text(), "%PDF-1.7 exact bytes");
      assert.equal(init.body.get("file").name, "Original.pdf");
      return Response.json({ id, generation: gen });
    },
  );
  const file = new File(["%PDF-1.7 exact bytes"], "Original.pdf"),
    signal = new AbortController().signal;
  await assert.rejects(
    api.saveOriginalLibraryFile(owner, id, file, "text", signal),
    /account changed/,
  );
  assert.equal(calls, 0);
  account = owner;
  assert.deepEqual(await api.saveOriginalLibraryFile(owner, id, file, "text", signal), {
    id,
    generation: gen,
  });
  assert.equal(calls, 1);
});
