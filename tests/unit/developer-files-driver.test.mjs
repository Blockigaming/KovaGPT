import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { createHash } from "node:crypto";
const slot = Symbol.for("kova.developer-files-tests");
const owner = "11111111-1111-4111-8111-111111111111",
  project = "22222222-2222-4222-8222-222222222222",
  key = "33333333-3333-4333-8333-333333333333",
  file = "44444444-4444-4444-8444-444444444444";
async function fixture(modulePath = "developer-files.server.ts") {
  const state = { enabled: false, calls: [], rows: null };
  const db = {
    rpc: (name, args) => ({
      abortSignal: async () => {
        state.calls.push({ name, args });
        return { data: state.rows ?? { id: file, deleted: true }, error: null };
      },
    }),
  };
  globalThis[slot] = { state, db, owner, project, key };
  let source = await readFile(
    new URL(`../../src/lib/pricing/${modulePath}`, import.meta.url),
    "utf8",
  );
  source = source.replace(/import\s*(?:type\s*)?\{[^}]+\}\s*from\s*"([^"]+)";/g, (full, path) => {
    if (path === "node:crypto") return full;
    if (path.endsWith(".mjs"))
      return full.replace(
        JSON.stringify(path),
        JSON.stringify(
          new URL(
            path.startsWith("@/")
              ? `../../src/${path.slice(2)}`
              : `../../src/lib/pricing/${path.slice(2)}`,
            import.meta.url,
          ).href,
        ),
      );
    if (path === "@/lib/api-auth.server")
      return `const requireVerifiedUser=async()=>({userId:'${owner}'});`;
    if (path === "@/lib/distributed-rate-limit.server")
      return "const consumeApplicationRateLimit=async()=>({allowed:true});";
    if (path === "@/lib/runtime-env.server")
      return 'const runtimeEnv=()=>globalThis[Symbol.for("kova.developer-files-tests")].state.enabled?"true":"false";';
    if (path === "./developer-platform.server")
      return `const authenticateDeveloper=async()=>({ownerId:'${owner}',id:'${key}',project_id:'${project}',capabilities:['files']}),developerDatabase=()=>globalThis[Symbol.for("kova.developer-files-tests")].db,developerJson=(value,status=200)=>Response.json(value,{status}),developerFailure=error=>Response.json({error:error.message},{status:400});`;
    return "";
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    state,
    db,
    module: await import(
      `data:text/javascript;base64,${Buffer.from(compiled + "\n//" + crypto.randomUUID()).toString("base64")}`
    ),
  };
}
function request(method, body, headers = {}) {
  return new Request(
    `https://kovagpt.com/api/v1/files${method === "GET" || method === "DELETE" ? `?id=${file}` : ""}`,
    {
      method,
      headers: { "content-type": "application/json", "idempotency-key": "stable", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
}
test("file creation remains off until enabled and pins authenticated project instead of client claims", async () => {
  const f = await fixture();
  const upload = { filename: "safe.txt", mimeType: "text/plain", text: "hello" };
  assert.equal((await f.module.handleDeveloperFiles(request("POST", upload))).status, 400);
  assert.equal(f.state.calls.length, 0);
  f.state.enabled = true;
  assert.equal(
    (await f.module.handleDeveloperFiles(request("POST", { ...upload, projectId: owner }))).status,
    400,
  );
  assert.equal(f.state.calls.length, 0);
  assert.equal((await f.module.handleDeveloperFiles(request("POST", upload))).status, 201);
  assert.equal(f.state.calls[0].args.p_owner, owner);
  assert.equal(f.state.calls[0].args.p_project, project);
  assert.equal(
    f.state.calls[0].args.p_input.requestDigest,
    createHash("sha256").update("stable").digest("hex"),
  );
});
test("owner management remains available with creation off and rejects a changed browser principal", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.module.handleDeveloperFiles(
        request("GET", null, { "x-kova-expected-user": project }),
        true,
      )
    ).status,
    400,
  );
  assert.equal(f.state.calls.length, 0);
  assert.equal(
    (
      await f.module.handleDeveloperFiles(
        request("DELETE", null, { "x-kova-expected-user": owner }),
        true,
      )
    ).status,
    200,
  );
  assert.equal(f.state.calls[0].args.p_key, null);
  assert.equal(f.state.calls[0].args.p_operation, "delete");
});
test("file expansion verifies digest and key/project-scoped reads before returning a quote body", async () => {
  const f = await fixture("developer-file-content.server.ts");
  const content = "A,1";
  f.state.rows = {
    id: file,
    filename: "data.csv",
    project_id: project,
    content,
    byte_size: 3,
    content_digest: createHash("sha256").update(content).digest("hex"),
    expires_at: new Date(Date.now() + 50000).toISOString(),
  };
  const identity = {
    ownerId: owner,
    id: key,
    project_id: project,
    capabilities: ["files"],
    db: f.db,
  };
  const result = await f.module.loadDeveloperFileContent(identity, { input: "Analyze" }, [file]);
  assert.equal(result.bindings[0].id, file);
  assert.equal(result.expiresAt, Date.parse(f.state.rows.expires_at));
  assert.equal(f.state.calls[0].args.p_project, project);
  f.state.rows.content = "changed";
  await assert.rejects(
    f.module.loadDeveloperFileContent(identity, { input: "Analyze" }, [file]),
    /file_unavailable/,
  );
  await assert.rejects(
    f.module.loadDeveloperFileContent({ ...identity, capabilities: [] }, { input: "Analyze" }, [
      file,
    ]),
    /scope_required/,
  );
});

test("owner console uploads require the pinned principal, explicit project and files key", async () => {
  const f = await fixture();
  f.state.enabled = true;
  const upload = { filename: "safe.txt", mimeType: "text/plain", text: "hello" };
  const send = (query, principal = owner) =>
    f.module.handleDeveloperFiles(
      new Request(`https://kovagpt.com/api/developer/files?${query}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "stable",
          "x-kova-expected-user": principal,
        },
        body: JSON.stringify(upload),
      }),
      true,
    );
  assert.equal((await send(`project=${project}&key=${key}`, project)).status, 400);
  assert.equal((await send(`key=${key}`)).status, 400);
  assert.equal((await send(`project=${project}`)).status, 400);
  assert.equal(f.state.calls.length, 0);
  assert.equal((await send(`project=${project}&key=${key}`)).status, 201);
  assert.equal(f.state.calls[0].args.p_owner, owner);
  assert.equal(f.state.calls[0].args.p_project, project);
  assert.equal(f.state.calls[0].args.p_key, key);
  assert.equal(
    f.state.calls[0].args.p_input.requestDigest,
    createHash("sha256").update("owner-console:stable").digest("hex"),
  );
});

test("raw file reads refuse foreign-project or expired records before retrieval can return data", async () => {
  const f = await fixture("developer-file-content.server.ts");
  const content = "private text";
  f.state.rows = {
    id: file,
    project_id: project,
    filename: "data.txt",
    content,
    byte_size: Buffer.byteLength(content),
    content_digest: createHash("sha256").update(content).digest("hex"),
    expires_at: new Date(Date.now() + 50000).toISOString(),
  };
  const identity = {
    ownerId: owner,
    id: key,
    project_id: project,
    capabilities: ["files"],
    db: f.db,
  };
  assert.equal((await f.module.readDeveloperFileRecords(identity, [file]))[0].content, content);
  f.state.rows.project_id = owner;
  await assert.rejects(
    () => f.module.readDeveloperFileRecords(identity, [file]),
    /file_unavailable/,
  );
  f.state.rows.project_id = project;
  f.state.rows.expires_at = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(
    () => f.module.readDeveloperFileRecords(identity, [file]),
    /file_unavailable/,
  );
});

test("multipart upload uses the same scoped file record and rejects extra parts and oversized files", async () => {
  const f = await fixture();
  const send = (form) =>
    f.module.handleDeveloperFiles(
      new Request("https://kovagpt.com/api/v1/files", {
        method: "POST",
        headers: { "idempotency-key": "stable" },
        body: form,
      }),
    );
  const form = new FormData();
  form.append("file", new Blob(["hello café"], { type: "text/plain" }), "safe.txt");
  assert.equal((await send(form)).status, 400);
  assert.equal(f.state.calls.length, 0);
  f.state.enabled = true;
  assert.equal((await send(form)).status, 201);
  const saved = f.state.calls[0].args;
  assert.equal(saved.p_project, project);
  assert.equal(saved.p_key, key);
  assert.deepEqual(saved.p_input, {
    filename: "safe.txt",
    mimeType: "text/plain",
    text: "hello café",
    requestDigest: createHash("sha256").update("stable").digest("hex"),
  });
  form.append("project_id", owner);
  assert.equal((await send(form)).status, 400);
  const duplicate = new FormData();
  duplicate.append("file", new Blob(["a"], { type: "text/plain" }), "a.txt");
  duplicate.append("file", new Blob(["b"], { type: "text/plain" }), "b.txt");
  assert.equal((await send(duplicate)).status, 400);
  const large = new FormData();
  large.append("file", new Blob(["x".repeat(32769)], { type: "text/plain" }), "safe.txt");
  assert.equal((await send(large)).status, 400);
  const invalid = new FormData();
  invalid.append("file", new Blob(["not JSON"], { type: "application/json" }), "safe.json");
  assert.equal((await send(invalid)).status, 400);
  const binary = new FormData();
  binary.append("file", new Blob([Uint8Array.of(255)], { type: "text/plain" }), "safe.txt");
  assert.equal((await send(binary)).status, 400);
  assert.equal(f.state.calls.length, 1);
});

test("file resource queries reject ambiguity and client authority before database access", async () => {
  const f = await fixture();
  const send = (method, query, ownerConsole = false) =>
    f.module.handleDeveloperFiles(
      new Request(`https://kovagpt.com/api/v1/files?${query}`, {
        method,
        headers: { "x-kova-expected-user": owner, "idempotency-key": "stable" },
      }),
      ownerConsole,
    );
  for (const [method, query, ownerConsole] of [
    ["GET", "id="],
    ["GET", "page="],
    ["GET", "page=01"],
    ["GET", "page=1&page=2"],
    ["GET", `id=${file}&page=1`],
    ["GET", `project=${project}`],
    ["GET", `project=${project}&project=${owner}`, true],
    ["GET", `project=${project}&key=${key}`, true],
    ["DELETE", `id=${file}&page=1`],
    ["POST", `id=${file}`],
  ])
    assert.equal((await send(method, query, ownerConsole)).status, 400, query);
  assert.equal(f.state.calls.length, 0);
  assert.equal((await send("GET", "page=4")).status, 200);
  assert.deepEqual(f.state.calls[0].args.p_input, { page: 4 });
  assert.equal((await send("GET", `project=${project}&id=${file}`, true)).status, 200);
  assert.equal(f.state.calls[1].args.p_project, project);
  assert.deepEqual(f.state.calls[1].args.p_input, { id: file });
});
