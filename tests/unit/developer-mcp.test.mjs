import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
const source = await readFile(
  new URL("../../src/lib/pricing/developer-mcp.server.ts", import.meta.url),
  "utf8",
);
let transformed = source.replace(
  /import\s*\{[^}]+\}\s*from "\.\/developer-platform\.server";/,
  `
 export const state={enabled:true,calls:0,fileCalls:[],scopes:["chat"]};
 const authenticateDeveloper=async()=>{if(!state.enabled)throw new Error('developer_platform_disabled');return {capabilities:state.scopes,ownerId:"owner",project_id:"project",id:"key"};};
 const developerJson=(value,status=200)=>Response.json(value,{status});
 const developerFailure=(error)=>developerJson({error:{message:error.message}},503);
 const developerQuote=async()=>({quoteToken:'signed',maximumCharge:10});
 const executeDeveloper=async()=>{state.calls++;return Response.json({output:'text'});};
`,
);
transformed = transformed.replace(
  'import { developerFileTools, executeDeveloperMcpFile } from "./developer-mcp-files.server";',
  'const developerFileTools=["list","get","create","delete"].map((fileOperation,i)=>({name:["kova_list_files","kova_read_file","kova_upload_text_file","kova_delete_file"][i],fileOperation,scope:"files",description:"files",inputSchema:{type:"object"},annotations:{readOnlyHint:i<2}}));const executeDeveloperMcpFile=async(identity,operation,args)=>{state.fileCalls.push({identity,operation,args});return {id:"file"};};',
);
transformed = transformed.replace(
  '"@/lib/bounded-json.server.mjs"',
  JSON.stringify(new URL("../../src/lib/bounded-json.server.mjs", import.meta.url).href),
);
transformed = transformed.replace(
  /import\s*\{[^}]+\}\s*from "\.\/mcp-oauth\.server";/,
  `const mcpOAuthAnonymousChallenge=()=>null;
   const authenticateMcpOAuth=async()=>({capabilities:['embeddings']});
   const mcpOAuthResponseHeaders=(_request,response)=>{response.headers.set('X-Mcp-Auth-Wrapper','applied');return response;};`,
);
const compiled = ts.transpileModule(transformed, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { handleDeveloperMcp, state } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);
const request = (body, headers = {}) =>
  new Request("https://kovagpt.com/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
test("MCP negotiates a supported version and exposes only authenticated key scopes", async () => {
  const initialized = await (
    await handleDeveloperMcp(
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-11-25" },
      }),
    )
  ).json();
  assert.equal(initialized.result.protocolVersion, "2025-11-25");
  const tools = await (
    await handleDeveloperMcp(request({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
  ).json();
  assert.deepEqual(
    tools.result.tools.map((item) => item.name),
    ["kova_quote", "kova_generate_text"],
  );
  assert.equal(
    (await handleDeveloperMcp(request({ jsonrpc: "2.0", method: "notifications/initialized" })))
      .status,
    202,
  );
  assert.equal(
    (
      await handleDeveloperMcp(
        request({ jsonrpc: "2.0", id: 3, method: "ping" }, { "mcp-protocol-version": "unknown" }),
      )
    ).status,
    400,
  );
  state.enabled = false;
  try {
    assert.equal(
      (await handleDeveloperMcp(request({ jsonrpc: "2.0", id: 4, method: "tools/list" }))).status,
      503,
    );
  } finally {
    state.enabled = true;
  }
});
test("MCP unsupported scopes and streaming cannot dispatch; quoting is free and native text executes once", async () => {
  const invoke = (name, args) =>
    handleDeveloperMcp(
      request({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name, arguments: args } }),
    );
  assert.equal(
    (
      await (
        await invoke("kova_generate_image", {
          input: { model: "image" },
          quoteToken: "q",
          requestKey: "k",
        })
      ).json()
    ).error.code,
    -32602,
  );
  assert.equal(
    (
      await (
        await invoke("kova_generate_text", {
          input: { stream: true },
          quoteToken: "q",
          requestKey: "k",
        })
      ).json()
    ).result.isError,
    true,
  );
  assert.equal(state.calls, 0);
  assert.equal(
    (
      await (
        await invoke("kova_quote", { operation: "responses", input: { model: "luna" } })
      ).json()
    ).result.structuredContent.quoteToken,
    "signed",
  );
  assert.equal(state.calls, 0);
  assert.equal(
    (
      await (
        await invoke("kova_generate_text", {
          input: { model: "luna" },
          quoteToken: "q",
          requestKey: "k",
        })
      ).json()
    ).result.structuredContent.output,
    "text",
  );
  assert.equal(state.calls, 1);
});

test("MCP files remain hidden without consent and route scoped calls without creating an inference request", async () => {
  const before = state.calls;
  const invoke = (name, args) =>
    handleDeveloperMcp(
      request({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name, arguments: args } }),
    );
  assert.equal((await (await invoke("kova_read_file", { id: "file" })).json()).error.code, -32602);
  state.scopes = ["files"];
  try {
    const list = await (
      await handleDeveloperMcp(request({ jsonrpc: "2.0", id: 9, method: "tools/list" }))
    ).json();
    assert.deepEqual(
      list.result.tools.map((tool) => tool.name),
      [
        "kova_list_files",
        "kova_read_file",
        "kova_upload_text_file",
        "kova_delete_file",
        "kova_quote",
      ],
    );
    assert.equal(
      (await (await invoke("kova_read_file", { id: "file" })).json()).result.structuredContent.id,
      "file",
    );
    assert.equal(state.fileCalls[0].identity.project_id, "project");
    assert.equal(state.calls, before);
  } finally {
    state.scopes = ["chat"];
  }
});

test("MCP OAuth bearer uses its granted scope and applies the same response wrapper", async () => {
  const response = await handleDeveloperMcp(
    request(
      { jsonrpc: "2.0", id: 8, method: "tools/list" },
      { authorization: "Bearer kmcp_a_fixture" },
    ),
  );
  assert.equal(response.headers.get("X-Mcp-Auth-Wrapper"), "applied");
  assert.deepEqual(
    (await response.json()).result.tools.map((tool) => tool.name),
    ["kova_quote", "kova_embed"],
  );
});
