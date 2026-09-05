import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  normalizeKovaConfig,
  normalizeKovaReference,
  kovaAttachmentsAllowed,
  filterKovaTools,
  formatKovaContext,
} from "../../src/lib/custom-kovas-policy.mjs";
import { normalizeChatPayload } from "../../src/lib/chat-ingress.server.mjs";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
const A = "123e4567-e89b-42d3-a456-426614174000",
  B = "223e4567-e89b-42d3-a456-426614174000",
  V = "323e4567-e89b-42d3-a456-426614174000",
  E = "423e4567-e89b-42d3-a456-426614174000";
const config = (changes) =>
  normalizeKovaConfig({
    name: "Example Kova",
    instructions: "Explain clearly.",
    mode: "medium",
    ...changes,
  });
const context = (changes) => ({
  id: A,
  versionId: V,
  publicationEpoch: E,
  config: config(),
  knowledge: [],
  ...changes,
});
async function serverModule() {
  let source = ts.transpileModule(
    await readFile(new URL("../../src/lib/custom-kovas.server.ts", import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  source = source.replaceAll(
    '"./custom-kovas-policy.mjs"',
    JSON.stringify(new URL("../../src/lib/custom-kovas-policy.mjs", import.meta.url).href),
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("Kova configuration has a closed model/tool policy and historical attachments cannot bypass files=false", () => {
  const ctx = context();
  const history = [
    { role: "user", attachments: [{ kind: "text", content: "private file" }] },
    { role: "assistant", content: "Earlier response" },
    { role: "user", content: "Continue" },
  ];
  assert.equal(kovaAttachmentsAllowed(ctx, history), false);
  assert.equal(
    kovaAttachmentsAllowed(context({ config: config({ tools: ["files"] }) }), history),
    true,
  );
  assert.equal(kovaAttachmentsAllowed(ctx, [{ role: "user", content: "ordinary text" }]), true);
  for (const changes of [
    { mode: "arbitrary-deployment" },
    { tools: ["shell"] },
    { apps: ["creator_gmail"] },
    { ownerId: B },
    { knowledge: [{ kind: "library", id: "invalid" }] },
  ])
    assert.throws(() => config(changes));
  assert.throws(() => normalizeKovaReference({ id: A, token: "secret" }));
  const tools = ["gmail_search", "calendar_list", "drive_read", "arbitrary_tool"].map((name) => ({
    type: "function",
    function: { name },
  }));
  assert.deepEqual(
    filterKovaTools(tools, context({ config: config({ apps: ["gmail"] }) })).map(
      (t) => t.function.name,
    ),
    ["gmail_search"],
  );
  assert.match(
    formatKovaContext(context({ knowledge: [{ title: "Note", content: "Actual selected text" }] })),
    /Actual selected text/,
  );
});

test("chat ingress and durable history preserve only the immutable Kova reference, never link tokens or creator grants", () => {
  const input = { messages: [{ role: "user", content: "hello" }], kova: { id: A, versionId: V } };
  assert.deepEqual(normalizeChatPayload(input).kova, input.kova);
  assert.throws(() => normalizeChatPayload({ ...input, kova: { id: A, token: "secret" } }));
  const chat = {
    id: B,
    title: "Example",
    mode: "medium",
    createdAt: 1,
    updatedAt: 2,
    messages: [],
    kova: input.kova,
  };
  assert.deepEqual(normalizeChatHistory(chat, A).kova, input.kova);
  assert.throws(() => normalizeChatHistory({ ...chat, kova: { id: A, token: "secret" } }, A));
  assert.throws(() => normalizeChatHistory({ ...chat, temporary: true }, A));
});

test("runtime resolves the actual current caller and prevents provider/tool work after publication revocation", async () => {
  const { resolveCustomKova } = await serverModule();
  let current = context(),
    reads = [];
  const admin = {
    rpc(name, args) {
      reads.push({ name, args });
      return { abortSignal: async () => ({ data: current, error: null }) };
    },
  };
  const resolved = await resolveCustomKova(
    admin,
    B,
    { id: A, versionId: V },
    new AbortController().signal,
  );
  assert.equal(reads[0].args.p_actor, B);
  assert.equal(resolved.versionId, V);
  assert.equal(resolved.allows("web"), false);
  await resolved.assertCurrent(new AbortController().signal);
  current = { ...current, publicationEpoch: crypto.randomUUID() };
  let outbound = 0;
  await assert.rejects(
    (async () => {
      await resolved.assertCurrent(new AbortController().signal);
      outbound++;
    })(),
    /unavailable/,
  );
  assert.equal(outbound, 0);
  const denied = {
    rpc() {
      return { abortSignal: async () => ({ data: null, error: { code: "42501" } }) };
    },
  };
  await assert.rejects(
    resolveCustomKova(denied, B, { id: A }, new AbortController().signal),
    (e) => e.status === 403,
  );
});

async function routeFixture(path) {
  const server = await serverModule(),
    key = `kova_api_${crypto.randomUUID()}`,
    state = { writes: [], authorization: null };
  const admin = {
    rpc(name, args) {
      state.writes.push({ name, args });
      return {
        abortSignal: async () => ({
          data: { id: A, revision: 1, visibility: "private", deleted: false },
          error: null,
        }),
      };
    },
  };
  state.caller = { userId: B, emailVerified: true, supabaseAdmin: admin };
  state.authorization = { caller: state.caller };
  globalThis[key] = state;
  let source = ts.transpileModule(
    await readFile(new URL(`../../src/routes/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const serverKey = `${key}_server`;
  globalThis[serverKey] = server;
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/g, (full, names, spec) => {
    if (spec === "@tanstack/react-router") return "const createFileRoute=()=>value=>value;";
    if (spec === "@/lib/api-auth.server")
      return `const requireVerifiedUser=async()=>globalThis[${JSON.stringify(key)}].caller;const getCallerTier=async()=>"free";`;
    if (spec === "@/lib/administrator.server")
      return `const requireAdministrator=async()=>globalThis[${JSON.stringify(key)}].authorization;`;
    if (spec === "@/lib/distributed-rate-limit.server")
      return "const consumeApplicationRateLimit=async()=>({allowed:true});";
    if (spec === "@/lib/modes") return "const STORAGE_LIMITS_BYTES={free:1000000};";
    if (spec === "@/lib/custom-kovas.server")
      return `const {${names}}=globalThis[${JSON.stringify(serverKey)}];`;
    if (spec.startsWith("@/lib/") && spec.endsWith(".mjs"))
      return full.replace(
        JSON.stringify(spec),
        JSON.stringify(new URL(`../../src/lib/${spec.slice(6)}`, import.meta.url).href),
      );
    throw Error(`Unmocked ${spec}`);
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(source + `\n//${key}`).toString("base64")}`
  );
  return {
    state,
    handlers: module.Route.server.handlers,
    dispose() {
      delete globalThis[key];
      delete globalThis[serverKey];
    },
  };
}
const request = (body) =>
  new Request("https://kovagpt.com/api/kovas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
test("actual owner API rejects forged owner/credential fields and hashes link capabilities before the database", async () => {
  const f = await routeFixture("api/kovas.ts");
  try {
    const body = {
      id: null,
      mutationId: V,
      revision: 0,
      requestedAt: new Date().toISOString(),
      action: "create",
      payload: { config: config() },
    };
    assert.equal(
      (await f.handlers.POST({ request: request({ ...body, ownerId: A }) })).status,
      400,
    );
    assert.equal(f.state.writes.length, 0);
    assert.equal((await f.handlers.POST({ request: request(body) })).status, 200);
    assert.equal(f.state.writes[0].args.p_actor, B);
    assert.equal(f.state.writes[0].args.p_storage_limit, 1000000);
    assert.equal(
      (
        await f.handlers.POST({
          request: request({
            ...body,
            action: "claimLink",
            id: A,
            payload: { token: "a".repeat(43) },
          }),
        })
      ).status,
      200,
    );
    const args = f.state.writes[1].args;
    assert.match(args.p_payload.linkHash, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(args).includes("a".repeat(43)), false);
    assert.equal(
      (await f.handlers.POST({ request: request({ ...body, requestedAt: "invalid" }) })).status,
      400,
    );
  } finally {
    f.dispose();
  }
});
test("actual moderation API requires configured administrator authorization before any service-role read/write", async () => {
  const f = await routeFixture("api/admin/kovas.ts");
  try {
    f.state.authorization = { response: Response.json({ error: "forbidden" }, { status: 403 }) };
    const body = { id: A, revision: 1, action: "block", reason: "Review decision" };
    assert.equal((await f.handlers.POST({ request: request(body) })).status, 403);
    assert.equal(
      (await f.handlers.GET({ request: new Request("https://kovagpt.com/api/admin/kovas") }))
        .status,
      403,
    );
    assert.equal(f.state.writes.length, 0);
    f.state.authorization = { caller: f.state.caller };
    assert.equal((await f.handlers.POST({ request: request(body) })).status, 200);
    assert.equal(f.state.writes[0].args.p_actor, B);
  } finally {
    f.dispose();
  }
});
