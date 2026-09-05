import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { readResponseBytesBounded } from "../../src/lib/endpoint-reliability.mjs";
const owner = "11111111-1111-4111-8111-111111111111";
async function loadClient({
  sessionOwner = owner,
  response = () => Response.json({ state: "deleting", startedAt: new Date().toISOString() }),
} = {}) {
  const calls = [];
  const mocks = {
    readResponseBytesBounded,
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: sessionOwner }, access_token: "captured-token" } },
        }),
      },
    },
    fetch: async (path, options) => {
      calls.push({ path, options });
      return response();
    },
  };
  let source = stripTypeScriptTypes(
    await readFile("src/lib/account-deletion-client.ts", "utf8"),
  ).replace(/^import[\s\S]*?;\n/gmu, "");
  const key = crypto.randomUUID();
  globalThis[key] = mocks;
  source = `const {${Object.keys(mocks).join(",")}}=globalThis[${JSON.stringify(key)}];\n` + source;
  try {
    return {
      ...(await import(
        "data:text/javascript;base64," + Buffer.from(source).toString("base64") + "#" + key
      )),
      calls,
    };
  } finally {
    delete globalThis[key];
  }
}
test("actual account status and DELETE transport pin the bearer and expected owner, with no inferred principal", async () => {
  const client = await loadClient();
  await client.requestAccountDeletion(owner, "GET");
  await client.requestAccountDeletion(owner, "DELETE");
  assert.equal(client.calls.length, 2);
  for (const { path, options } of client.calls) {
    assert.equal(path, "/api/account");
    assert.equal(options.headers.Authorization, "Bearer captured-token");
    assert.equal(options.headers["X-Kova-Expected-User"], owner);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(client.calls[0].options.body, undefined);
  assert.equal(JSON.parse(client.calls[1].options.body).confirmation, "DELETE");
  const switched = await loadClient({ sessionOwner: "another-owner" });
  await assert.rejects(switched.requestAccountDeletion(owner, "DELETE"), /identity_changed/);
  assert.equal(switched.calls.length, 0);
});
test("oversized or canceled status bodies never reach the settings state", async () => {
  let canceled = false;
  const client = await loadClient({
    response: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4097));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
  });
  await assert.rejects(client.requestAccountDeletion(owner, "GET"));
  assert.equal(canceled, true);
  const abort = new AbortController();
  abort.abort();
  const safe = await loadClient();
  await assert.rejects(safe.requestAccountDeletion(owner, "DELETE", abort.signal));
  assert.equal(safe.calls.length, 0);
});
async function settingsHandler(request, initialOwner = owner) {
  const calls = [],
    ref = { current: initialOwner },
    operation = { current: 0 };
  const mock = {
    deleteConfirmation: "DELETE",
    deleteAccountBusy: false,
    isLoaded: true,
    userKey: owner,
    currentAuthUserKeyRef: ref,
    deletionOperationRef: operation,
    setDeleteAccountBusy: (value) => calls.push(["busy", value]),
    setDeletionStatus: (value) => calls.push(["state", value]),
    requestAccountDeletion: request,
    toast: {
      error: (value) => calls.push(["error", value]),
      success: (value) => calls.push(["success", value]),
      warning: (value) => calls.push(["warning", value]),
    },
    clearLocalBrowserData: async (principal) => {
      calls.push(["clear", principal]);
      return {
        resolved: true,
        local: { failures: [] },
        session: { failures: [] },
        imageHistory: { failures: [] },
        chatHistory: { failures: [] },
        pwa: { failures: [] },
      };
    },
    onClearAll: () => calls.push(["clear-view"]),
    setDeleteAccountOpen: () => {},
    onOpenChange: () => {},
    clerk: { signOut: async () => calls.push(["signout"]) },
  };
  const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
  const source = stripTypeScriptTypes(
    settings.slice(
      settings.indexOf("  const handleDeleteAccount ="),
      settings.indexOf("  const handleClearSavedMemory ="),
    ),
  );
  const key = crypto.randomUUID();
  globalThis[key] = mock;
  try {
    const module = await import(
      "data:text/javascript;base64," +
        Buffer.from(
          `const {${Object.keys(mock).join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}\nexport {handleDeleteAccount};`,
        ).toString("base64") +
        "#" +
        key
    );
    return { run: module.handleDeleteAccount, calls, ref };
  } finally {
    delete globalThis[key];
  }
}
test("actual Settings handler keeps failure/pending state retryable and never claims rollback", async () => {
  for (const request of [
    async () => {
      throw Error("network lost");
    },
    async () => Response.json({ state: "deleting", error: "Cleanup pending" }, { status: 503 }),
  ]) {
    const h = await settingsHandler(request);
    await h.run();
    assert.equal(
      h.calls.some(([kind]) => kind === "clear" || kind === "signout"),
      false,
    );
    const status = h.calls.find(([kind]) => kind === "state")[1];
    assert.equal(status.ownerId, owner);
    assert.ok(["unknown", "deleting"].includes(status.state));
    assert.doesNotMatch(JSON.stringify(h.calls), /remains active|rolled back/);
    assert.deepEqual(h.calls.at(-1), ["busy", false]);
  }
});
test("late deletion failure for a previous principal does not update the newly signed-in settings", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const h = await settingsHandler(() => waiting);
  const running = h.run();
  h.ref.current = "next-owner";
  release(Response.json({ state: "deleting", error: "Pending" }, { status: 503 }));
  await running;
  assert.deepEqual(h.calls, [["busy", true]]);
});
test("authoritative completion still clears only the captured owner before signout", async () => {
  const h = await settingsHandler(async () => new Response(null, { status: 204 }));
  await h.run();
  assert.ok(h.calls.some(([kind, value]) => kind === "clear" && value === owner));
  assert.ok(h.calls.some(([kind]) => kind === "signout"));
  assert.ok(h.calls.some(([kind]) => kind === "success"));
});
