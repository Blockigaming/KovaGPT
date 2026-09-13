import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as policy from "../../src/lib/scheduled-task-policy.mjs";
import * as lockdown from "../../src/lib/lockdown-policy.mjs";
import * as response from "../../src/lib/provider-response.server.mjs";
const updated = "2026-09-01T00:00:00.000Z";
function fixture({
  provider = "slack",
  revokeOnProfile = false,
  privateChannel = false,
  revokeOnMetadata = false,
} = {}) {
  let revoked = false;
  const calls = [],
    exports = {},
    grant = {
      id: randomUUID(),
      user_id: randomUUID(),
      provider,
      connection_ref: randomUUID(),
      connection_generation: provider === "gmail" ? randomUUID() : `1:${Date.parse(updated)}`,
      provider_account_id:
        provider === "slack" ? "T1:U1" : provider === "github" ? "123" : "google-sub",
      required_scopes: ["channels:read", "channels:history"],
      expires_at: "2099-01-01",
      revoked_at: null,
    };
  const row = {
    access_token_ciphertext: "encrypted-fixture",
    credential_key_version: 1,
    updated_at: updated,
    provider_account_id: grant.provider_account_id,
  };
  const query = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      maybeSingle: () => q,
      abortSignal: async () => ({
        data: table === "user_preferences" ? { settings: {} } : row,
        error: null,
      }),
    };
    return q;
  };
  const modules = {
    "@/integrations/supabase/client.server": {
      supabaseAdmin: {
        from: query,
        rpc: () => ({ abortSignal: async () => ({ data: !revoked, error: null }) }),
      },
    },
    "@/integrations/credential-vault.server": { decryptCredential: async () => "fixture-token" },
    "@/lib/google-oauth.server": {
      getValidGoogleAccessToken: async (user, binding) => {
        calls.push({ binding });
        return "google-fixture";
      },
    },
    "@/lib/provider-response.server.mjs": response,
    "@/lib/scheduled-task-policy.mjs": policy,
    "@/lib/lockdown-policy.mjs": lockdown,
  };
  const fetcher = async (url) => {
    calls.push({ url });
    if (url.endsWith("/auth.test") || url.endsWith("/user")) {
      if (revokeOnProfile) revoked = true;
      return Response.json(
        provider === "slack" ? { ok: true, team_id: "T1", user_id: "U1" } : { id: 123 },
      );
    }
    if (url.includes("conversations.info"))
      return Response.json({ ok: true, channel: { id: "C12345678", is_private: privateChannel } });
    if (url.includes("conversations.history"))
      return Response.json({ ok: true, messages: [{ user: "U1", text: "Allowed content" }] });
    if (url.includes("users/me/messages?"))
      return Response.json({ messages: [{ id: "a1" }, { id: "a2" }] });
    if (url.includes("format=metadata")) {
      if (revokeOnMetadata) revoked = true;
      return Response.json({
        payload: { headers: [{ name: "Subject", value: "Private subject" }] },
      });
    }
    throw new Error("Unexpected provider resource");
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("src/lib/scheduled-task-connected.server.ts", "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports, require: (name) => modules[name], Date, Error, Buffer, fetch: fetcher },
  );
  return { api: exports, grant, calls };
}
test("revocation during provider identity verification prevents every later private resource fetch", async () => {
  for (const provider of ["slack", "github"]) {
    const { api, grant, calls } = fixture({ provider, revokeOnProfile: true });
    await assert.rejects(
      api.readTaskConnectedContext(
        grant,
        provider === "slack" ? "C12345678" : "owner/repo",
        AbortSignal.timeout(1000),
      ),
      /connection_unavailable/,
    );
    assert.equal(calls.filter((call) => call.url).length, 1);
  }
});
test("private Slack Connect channels require private-history scopes regardless of a C prefix", async () => {
  const { api, grant, calls } = fixture({ privateChannel: true });
  await assert.rejects(
    api.readTaskConnectedContext(grant, "C12345678", AbortSignal.timeout(1000)),
    /connection_unavailable/,
  );
  assert.equal(
    calls.some((call) => call.url?.includes("conversations.history")),
    false,
  );
  const valid = fixture({ privateChannel: true });
  valid.grant.required_scopes.push("groups:read", "groups:history");
  assert.match(
    await valid.api.readTaskConnectedContext(valid.grant, "C12345678", AbortSignal.timeout(1000)),
    /Allowed content/,
  );
});
test("Gmail metadata pagination stops immediately on revocation and never falls back to another account", async () => {
  const { api, grant, calls } = fixture({ provider: "gmail", revokeOnMetadata: true });
  await assert.rejects(
    api.listTaskConnectedResourceOptions(grant, null, AbortSignal.timeout(1000)),
    /connection_unavailable/,
  );
  assert.equal(calls.filter((call) => call.url?.includes("format=metadata")).length, 1);
  assert.deepEqual(
    { ...calls.find((call) => call.binding).binding },
    {
      connectionId: grant.connection_ref,
      grantId: grant.connection_generation,
      expectedGoogleSub: "google-sub",
      capability: "gmail.read",
    },
  );
});
