import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const account = "22222222-2222-4222-8222-222222222222";
function client({ fetcher = async () => Response.json({}), sessionUser = () => owner } = {}) {
  const exports = {};
  const location = { href: "" };
  const dependencies = {
    "@/lib/auth-fetch": { authFetch: fetcher },
    "@/integrations/supabase/client": {
      supabase: {
        auth: {
          getSession: async () => ({
            data: {
              session: { user: { id: sessionUser() }, access_token: "fixture-access-token" },
            },
          }),
        },
      },
    },
    "@/lib/endpoint-reliability.mjs": { readResponseBytesBounded },
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/google-client.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      require: (name) => dependencies[name],
      fetch: fetcher,
      window: { location },
      Headers,
      TextDecoder,
      URL,
      AbortSignal,
      AbortController,
      setTimeout,
      clearTimeout,
    },
  );
  return { api: exports, location };
}

test("selection and disconnect submit the exact account and captured actor", async () => {
  const calls = [];
  const { api } = client({
    fetcher: async (path, init) => {
      calls.push({
        path,
        body: JSON.parse(init.body),
        authorization: init.headers.get("Authorization"),
        credentials: init.credentials,
      });
      return Response.json({ ok: true });
    },
  });
  await api.selectGoogleAccount(account, 7, owner);
  await api.disconnectGoogleAccount(account, 3, owner);
  assert.deepEqual(calls, [
    {
      path: "/api/google/select",
      body: { connectionId: account, expectedRevision: 7 },
      authorization: "Bearer fixture-access-token",
      credentials: "omit",
    },
    {
      path: "/api/google/disconnect",
      body: { connectionId: account, expectedRevision: 3 },
      authorization: "Bearer fixture-access-token",
      credentials: "omit",
    },
  ]);
});

test("changed principals and malformed selections perform no network mutation", async () => {
  let calls = 0;
  const { api } = client({
    sessionUser: () => account,
    fetcher: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(api.selectGoogleAccount(account, 1, owner), /account changed/);
  await assert.rejects(api.disconnectGoogleAccount(account, 3, owner), /account changed/);
  await assert.rejects(api.selectGoogleAccount(account, -1, owner), /Reload/);
  await assert.rejects(api.disconnectGoogleAccount("", 3, owner), /Select/);
  assert.equal(calls, 0);
});

test("a stale revision asks for fresh selection rather than claiming success", async () => {
  const { api } = client({
    fetcher: async () => Response.json({ private_error: "hidden" }, { status: 409 }),
  });
  await assert.rejects(api.selectGoogleAccount(account, 1, owner), /changed elsewhere/);
});

test("OAuth reauthorization is account-bound and rejects unsafe or stale-account redirects", async () => {
  for (const url of [
    "https://evil.example/",
    "javascript:alert(1)",
    "https://accounts.google.com.evil.example/",
    "https://user@accounts.google.com/",
  ]) {
    const { api, location } = client({ fetcher: async () => Response.json({ url }) });
    await assert.rejects(api.startGoogleConnect(account, owner), /Invalid/);
    assert.equal(location.href, "");
  }
  let sessions = 0;
  const changed = client({
    sessionUser: () => (++sessions === 1 ? owner : account),
    fetcher: async (path, init) => {
      assert.equal(path, `/api/google/auth?connectionId=${account}`);
      assert.equal(init.credentials, "same-origin");
      return Response.json({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=fixture" });
    },
  });
  await assert.rejects(changed.api.startGoogleConnect(account, owner), /account changed/);
  assert.equal(changed.location.href, "");
});

test("malformed or oversized status cannot expose an actionable account list", async () => {
  for (const response of [
    () => Response.json({ connected: true, state: "connected", accounts: [{ id: account }] }),
    () =>
      Response.json({
        connected: true,
        state: "connected",
        accounts: [],
        selectionRevision: 1,
        selectedConnectionId: account,
      }),
    () => new Response("x".repeat(1_048_577)),
    () => Response.json({ connected: true }, { status: 503 }),
  ]) {
    const { api } = client({ fetcher: async () => response() });
    const status = await api.getGoogleStatus(owner);
    assert.equal(status.state, "temporarily_unavailable");
    assert.equal(status.connected, false);
    assert.equal(status.accounts.length, 0);
  }
});

test("read helpers can bind each request to an explicit account", async () => {
  const bodies = [];
  const { api } = client({
    fetcher: async (_path, init) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({});
    },
  });
  await api.gmailSearch("subject:fixture", 3, account);
  await api.gmailRead("message-1", account);
  await api.driveSearch("fixture", 3, account);
  await api.driveRead("file-1", account);
  await api.calendarList({ maxResults: 3, connectionId: account });
  assert.equal(bodies.length, 5);
  assert.ok(bodies.every((body) => body.connectionId === account));
});
