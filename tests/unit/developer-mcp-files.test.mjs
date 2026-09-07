import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import ts from "typescript";
let source = await readFile(
  new URL("../../src/lib/pricing/developer-mcp-files.server.ts", import.meta.url),
  "utf8",
);
source = source.replace(
  'import { runtimeEnv } from "@/lib/runtime-env.server";',
  'export let enabled=false;export const setEnabled=value=>{enabled=value};const runtimeEnv=()=>enabled?"true":"false";',
);
source = source.replaceAll(/"\.\/([^"\n]+\.mjs)"/g, (_, path) =>
  JSON.stringify(new URL(`../../src/lib/pricing/${path}`, import.meta.url).href),
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { executeDeveloperMcpFile, developerFileTools, setEnabled } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const file = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const calls = [];
  const identity = {
    id: "key",
    ownerId: "owner",
    project_id: "project",
    capabilities: ["files"],
    db: {
      rpc: (name, args) => ({
        abortSignal: async () => {
          calls.push({ name, args });
          return { data: { id: file }, error: null };
        },
      }),
    },
  };
  return { identity, calls };
}
test("MCP file tools expose accurate permissions and reuse the already-authenticated project identity", async () => {
  const f = fixture();
  setEnabled(false);
  for (const operation of ["list", "get", "delete"])
    await executeDeveloperMcpFile(f.identity, operation, operation === "list" ? {} : { id: file });
  assert.deepEqual(
    f.calls.map((call) => call.args.p_operation),
    ["list", "get", "delete"],
  );
  assert.ok(
    f.calls.every(
      (call) =>
        call.args.p_owner === "owner" &&
        call.args.p_key === "key" &&
        call.args.p_project === "project",
    ),
  );
  assert.equal(
    developerFileTools.find((tool) => tool.fileOperation === "delete").annotations.destructiveHint,
    true,
  );
  assert.ok(
    developerFileTools.every(
      (tool) => tool.scope === "files" && tool.annotations.openWorldHint === false,
    ),
  );
  await assert.rejects(
    executeDeveloperMcpFile({ ...f.identity, capabilities: ["chat"] }, "get", { id: file }),
    /scope_required/,
  );
  await assert.rejects(
    executeDeveloperMcpFile(f.identity, "get", { id: file, project_id: "other" }),
    /field_invalid/,
  );
  assert.equal(f.calls.length, 3);
});
test("MCP uploads preserve the creation gate, bounded payload and exact idempotency digest", async () => {
  const f = fixture();
  const args = {
    file: { filename: "data.csv", mimeType: "text/csv", text: "A,1" },
    requestKey: "stable",
  };
  setEnabled(false);
  await assert.rejects(executeDeveloperMcpFile(f.identity, "create", args), /files_disabled/);
  assert.equal(f.calls.length, 0);
  setEnabled(true);
  await executeDeveloperMcpFile(f.identity, "create", args);
  assert.equal(
    f.calls[0].args.p_input.requestDigest,
    createHash("sha256").update("stable").digest("hex"),
  );
  for (const changed of [
    { ...args, requestKey: "" },
    { ...args, file: { ...args.file, text: "é".repeat(16385) } },
    { ...args, file: { ...args.file, url: "https://private.invalid" } },
  ])
    await assert.rejects(
      executeDeveloperMcpFile(f.identity, "create", changed),
      /required|file_invalid/,
    );
  assert.equal(f.calls.length, 1);
  setEnabled(false);
});
