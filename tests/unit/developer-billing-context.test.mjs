import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const file = new URL("../../src/lib/pricing/developer-billing.server.ts", import.meta.url);
let source = await readFile(file, "utf8");
source = source.replace(
  'import { createClient } from "@supabase/supabase-js";',
  'const createClient = () => { throw new Error("unexpected database access"); };',
);
source = source.replace(
  'import { runtimeEnv } from "@/lib/runtime-env.server";',
  "const runtimeEnv = () => undefined;",
);
source = source.replace(
  '"./developer-metering.mjs"',
  JSON.stringify(new URL("../../src/lib/pricing/developer-metering.mjs", import.meta.url).href),
);
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { meterProviderRequest, withDeveloperBilling } = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);
const input = {
  provider: "azure_openai",
  capability: "chat",
  body: {},
  send: async () => new Response("consumer"),
};
test("consumer requests keep their existing accounting and developer activation is off by default", async () => {
  assert.equal(await (await meterProviderRequest(input)).text(), "consumer");
  await assert.rejects(
    withDeveloperBilling(
      { keyId: "11111111-1111-4111-8111-111111111111", requestKey: "idempotency" },
      () => meterProviderRequest(input),
    ),
    /billing_disabled/,
  );
});
test("developer billing context cannot leak into a concurrent consumer request", async () => {
  let release;
  const barrier = new Promise((resolve) => {
    release = resolve;
  });
  const developer = withDeveloperBilling(
    { keyId: "11111111-1111-4111-8111-111111111111", requestKey: "independent" },
    async () => {
      await barrier;
      return meterProviderRequest(input);
    },
  );
  assert.equal(await (await meterProviderRequest(input)).text(), "consumer");
  release();
  await assert.rejects(developer, /billing_disabled/);
  assert.throws(
    () => withDeveloperBilling({ keyId: "client-claim", requestKey: "invalid" }, () => {}),
    /identity_invalid/,
  );
});

test("all provider calls in one authenticated request share the same budget group", async () => {
  let enabled = await readFile(file, "utf8");
  enabled = enabled.replace(
    'import { createClient } from "@supabase/supabase-js";',
    `
 export const captures=[];
 const chain=()=>{const q={then(resolve){return Promise.resolve({data:[]}).then(resolve);},maybeSingle:async()=>({data:{account_id:'account',currency:'USD',id:'version'}})};
 for(const name of ['select','eq','is','gt','lte','order','limit','abortSignal'])q[name]=()=>q;return q;};
 const createClient=()=>({from:chain,rpc:(name,args)=>({abortSignal:async()=>{captures.push(args);return {data:{decision:'admitted'}};}})};`,
  );
  enabled = enabled.replace(
    'import { runtimeEnv } from "@/lib/runtime-env.server";',
    'const runtimeEnv = (name) => name === "KOVA_DEVELOPER_BILLING_ENABLED" ? "true" : "fixture";',
  );
  enabled = enabled.replace(
    /import\s*\{[^}]+\}\s*from "\.\/developer-metering\.mjs";/,
    "const prepareDeveloperQuote=()=>({quote:{},contract:{maximumUsage:{}}}); const runMeteredProvider=(options)=>options.admit();",
  );
  const compiled = ts.transpileModule(enabled, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  await module.withDeveloperBilling(
    { keyId: "11111111-1111-4111-8111-111111111111", requestKey: "one-external-request" },
    () => Promise.all([module.meterProviderRequest(input), module.meterProviderRequest(input)]),
  );
  assert.equal(module.captures.length, 2);
  const keys = module.captures.map((row) => row.p_request_key.split(":"));
  assert.equal(keys[0][0], keys[1][0]);
  assert.deepEqual(
    keys.map((x) => x[1]),
    ["0", "1"],
  );
});
