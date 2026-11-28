import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../../src/lib/pricing/developer-mcp-connections.server.ts", import.meta.url),
  "utf8",
);
const stateSource = `
export const state={enabled:true,allowed:true,revoked:false,change:false,dispatched:0,calls:[],binding:"a".repeat(43)};
const approvedMcpServers=()=>new Map([["reviewed",{url:"https://reviewed.example/mcp",tool:"search",fingerprint:state.binding}]]);
const unpackKeyCredential=()=>({serverId:"reviewed",bindingHash:"a".repeat(43),apiKey:"private-token"});
const decryptCredential=async()=>"encrypted-payload";
const runtimeEnv=()=>state.enabled?"true":"false";
const consumeApplicationRateLimit=async()=>({allowed:state.allowed,status:state.allowed?"allowed":"limited"});
const assertLockdownAllows=async()=>{};
const developerUuid=(value)=>{if(typeof value!=="string"||!value)throw Error("developer_id_invalid");return value;};
const developerEnabled=()=>state.enabled;
const developerDatabase=()=>db;
const developerFailure=(e)=>Response.json({error:{code:e.message}},{status:400});
const developerJson=(v)=>Response.json(v);
const authenticateDeveloper=async()=>identity;
const readBoundedJsonObject=(r)=>r.json();
const db={rpc:(name,args)=>({abortSignal:async()=>{state.calls.push(args);if(args.p_operation==="list")return {data:[{id:"grant",server_id:"reviewed",tool_name:"search",binding_hash:"a".repeat(43),expires_at:"2099-01-01"}]};if(state.revoked||args.p_input.tool!=="search")return {error:{message:"developer_mcp_connection_not_found"}};return {data:{id:"grant",server_id:"reviewed",tool_name:"search",binding_hash:"a".repeat(43),credential:"encrypted-ciphertext"}};}})};
export const identity={db,id:"key",ownerId:"owner",project_id:"project",capabilities:["mcp_read"]};
const readMcpConnection=async(id,query,credential,fetchImpl,before,transport,signal)=>{signal.throwIfAborted();await before();if(state.change){state.revoked=true;}await before();state.dispatched++;return {results:[{id:"1",title:"MCP read result",snippet:"private-token returned",url:null}],limited:false};};
`;
const transformed =
  `import { developerRateError } from ${JSON.stringify(new URL("../../src/lib/pricing/developer-http-errors.mjs", import.meta.url).href)};\n` +
  stateSource +
  source.replace(/^import\s+[\s\S]*?from\s+"[^"]+";\n/gm, "");
const compiled = ts.transpileModule(transformed, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { executeDeveloperMcpConnection, state, identity } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const signal = () => new AbortController().signal;
const input = { id: "grant", tool: "search", query: "query", approved: true };
test("reviewed MCP dispatch is scope/approval/config bound and revocation is rechecked before remote work", async () => {
  const list = await executeDeveloperMcpConnection(identity, "list", {}, signal());
  assert.equal(list.data[0].tool_name, "search");
  assert.equal(list.data[0].binding_hash, undefined);
  await assert.rejects(
    executeDeveloperMcpConnection({ ...identity, capabilities: [] }, "invoke", input, signal()),
    /scope_required/,
  );
  for (const bad of [
    { ...input, approved: false },
    { ...input, url: "https://other.example" },
    { ...input, tool: "write" },
  ])
    await assert.rejects(executeDeveloperMcpConnection(identity, "invoke", bad, signal()));
  state.binding = "b".repeat(43);
  await assert.rejects(
    executeDeveloperMcpConnection(identity, "invoke", input, signal()),
    /not_found/,
  );
  state.binding = "a".repeat(43);
  state.change = true;
  await assert.rejects(
    executeDeveloperMcpConnection(identity, "invoke", input, signal()),
    /unavailable/,
  );
  assert.equal(state.dispatched, 0);
  state.change = false;
  state.revoked = false;
  const result = await executeDeveloperMcpConnection(identity, "invoke", input, signal());
  assert.equal(state.dispatched, 1);
  assert.equal(result.results[0].snippet, "[redacted] returned");
  assert.ok(
    state.calls.every(
      (c) => c.p_project === "project" && c.p_owner === "owner" && c.p_key === "key",
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(executeDeveloperMcpConnection(identity, "invoke", input, controller.signal));
  assert.equal(state.dispatched, 1);
});
