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
test("actual account status, scheduling and recovery pin the bearer and expected owner", async () => {
  const client = await loadClient();
  await client.requestAccountDeletion(owner, "GET");
  await client.requestAccountDeletion(owner, "DELETE");
  await client.requestAccountDeletion(owner, "PATCH");
  assert.equal(client.calls.length, 3);
  for (const { path, options } of client.calls) {
    assert.equal(path, "/api/account");
    assert.equal(options.headers.Authorization, "Bearer captured-token");
    assert.equal(options.headers["X-Kova-Expected-User"], owner);
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(client.calls[0].options.body, undefined);
  assert.equal(JSON.parse(client.calls[1].options.body).confirmation, "DELETE");
  assert.deepEqual(JSON.parse(client.calls[2].options.body), { action: "recover" });
  assert.equal(client.calls[2].options.headers["Content-Type"], "application/json");
  const switched = await loadClient({ sessionOwner: "another-owner" });
  await assert.rejects(switched.requestAccountDeletion(owner, "DELETE"), /identity_changed/);
  await assert.rejects(switched.requestAccountDeletion(owner, "PATCH"), /identity_changed/);
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
  await assert.rejects(safe.requestAccountDeletion(owner, "PATCH", abort.signal));
  assert.equal(safe.calls.length, 0);
});
async function settingsHandler(request, initialOwner = owner, deletionStatus = null) {
  const calls = [],
    ref = { current: initialOwner },
    operation = { current: 0 };
  const mock = {
    parseAccountDeletionStatus: (await loadClient()).parseAccountDeletionStatus,
    deleteConfirmation: "DELETE",
    deleteAccountBusy: false,
    isLoaded: true,
    userKey: owner,
    deletionStatus,
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
    setDeleteConfirmation: () => {},
    onOpenChange: () => {},
    clerk: { signOut: async () => calls.push(["signout"]) },
  };
  const settings = await readFile("src/components/SettingsDialog.tsx", "utf8");
  const source = stripTypeScriptTypes(
    settings.slice(
      settings.indexOf("  const handleCheckDeletion ="),
      settings.indexOf("  const handleClearSavedMemory ="),
    ),
  );
  const key = crypto.randomUUID();
  globalThis[key] = mock;
  try {
    const module = await import(
      "data:text/javascript;base64," +
        Buffer.from(
          `const {${Object.keys(mock).join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}\nexport {handleDeleteAccount,handleRecoverAccount,handleCheckDeletion};`,
        ).toString("base64") +
        "#" +
        key
    );
    return {
      run: module.handleDeleteAccount,
      recover: module.handleRecoverAccount,
      check: module.handleCheckDeletion,
      calls,
      ref,
    };
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

function scheduledStatus(state = "scheduled") {
  const scheduledAt = new Date().toISOString();
  return {
    state,
    scheduledAt,
    recoverUntil: new Date(Date.parse(scheduledAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

test("policy status parser rejects malformed or invented recovery windows", async () => {
  const client = await loadClient();
  assert.deepEqual(
    client.parseAccountDeletionStatus({
      state: "active",
      scheduledAt: null,
      recoverUntil: null,
    }),
    { state: "active", scheduledAt: null, recoverUntil: null },
  );
  const scheduled = scheduledStatus();
  assert.deepEqual(client.parseAccountDeletionStatus(scheduled), scheduled);
  for (const value of [
    null,
    { state: "deleting" },
    { state: "active" },
    { ...scheduled, recoverUntil: "not-a-date" },
    { ...scheduled, recoverUntil: scheduled.scheduledAt },
    {
      ...scheduled,
      recoverUntil: new Date(Date.parse(scheduled.scheduledAt) + 31 * 86400000).toISOString(),
    },
  ])
    assert.equal(client.parseAccountDeletionStatus(value), null);
});

test("202 scheduling preserves account, device data and session and records the server deadline", async () => {
  const scheduled = scheduledStatus();
  const h = await settingsHandler(async () => Response.json(scheduled, { status: 202 }));
  await h.run();
  assert.equal(
    h.calls.some(([kind]) => ["clear", "clear-view", "signout"].includes(kind)),
    false,
  );
  assert.deepEqual(h.calls.find(([kind]) => kind === "state")[1], { ownerId: owner, ...scheduled });
  assert.match(h.calls.find(([kind]) => kind === "success")[1], /Billing is unchanged/);
  assert.doesNotMatch(JSON.stringify(h.calls), /subscriptions were canceled|deletion completed/);
});

test("other successful or malformed responses cannot masquerade as final deletion", async () => {
  for (const response of [
    () => Response.json({ state: "deleted", scheduledAt: null, recoverUntil: null }),
    () => Response.json({ state: "scheduled" }, { status: 202 }),
    () => Response.json(scheduledStatus("finalizing"), { status: 202 }),
  ]) {
    const h = await settingsHandler(async () => response());
    await h.run();
    assert.equal(
      h.calls.some(([kind]) => ["clear", "clear-view", "signout"].includes(kind)),
      false,
    );
    assert.equal(
      h.calls.some(([kind]) => kind === "success"),
      false,
    );
  }
});

test("recovery uses the owner-bound PATCH and retains local data, session and discount", async () => {
  const calls = [];
  const h = await settingsHandler(
    async (principal, method) => {
      calls.push({ principal, method });
      return Response.json({ state: "active", scheduledAt: null, recoverUntil: null });
    },
    owner,
    { ownerId: owner, ...scheduledStatus() },
  );
  await h.recover();
  assert.deepEqual(calls, [{ principal: owner, method: "PATCH" }]);
  assert.equal(
    h.calls.some(([kind]) => ["clear", "clear-view", "signout"].includes(kind)),
    false,
  );
  assert.deepEqual(h.calls.find(([kind]) => kind === "state")[1], {
    ownerId: owner,
    state: "active",
    scheduledAt: null,
    recoverUntil: null,
  });
  assert.match(h.calls.find(([kind]) => kind === "success")[1], /discount are unchanged/);
});

test("late recovery response cannot update a newly signed-in principal", async () => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const h = await settingsHandler(() => waiting, owner, { ownerId: owner, ...scheduledStatus() });
  const running = h.recover();
  h.ref.current = "next-owner";
  release(Response.json({ state: "active", scheduledAt: null, recoverUntil: null }));
  await running;
  assert.deepEqual(h.calls, [["busy", true]]);
});

test("failed recovery and status refresh retain an unverified pending state without wiping data", async () => {
  const h = await settingsHandler(
    async () => Response.json({ error: "deadline_passed" }, { status: 409 }),
    owner,
    {
      ownerId: owner,
      ...scheduledStatus(),
    },
  );
  await h.recover();
  assert.equal(h.calls.find(([kind]) => kind === "state")[1].state, "unknown");
  assert.equal(
    h.calls.some(([kind]) => ["clear", "clear-view", "signout", "success"].includes(kind)),
    false,
  );
  const scheduled = scheduledStatus();
  const methods = [];
  const refresh = await settingsHandler(async (_principal, method) => {
    methods.push(method);
    return Response.json(scheduled);
  });
  await refresh.check();
  assert.deepEqual(methods, ["GET"]);
  assert.deepEqual(refresh.calls.find(([kind]) => kind === "state")[1], {
    ownerId: owner,
    ...scheduled,
  });
  assert.equal(
    refresh.calls.some(([kind]) => ["clear", "clear-view", "signout"].includes(kind)),
    false,
  );
});

test("non-200 recovery cannot claim a recovered account even with an active-shaped body", async () => {
  for (const status of [202, 409]) {
    const h = await settingsHandler(
      async () =>
        Response.json({ state: "active", scheduledAt: null, recoverUntil: null }, { status }),
      owner,
      { ownerId: owner, ...scheduledStatus() },
    );
    await h.recover();
    assert.equal(h.calls.find(([kind]) => kind === "state")[1].state, "unknown");
    assert.equal(
      h.calls.some(([kind]) => ["clear", "signout", "success"].includes(kind)),
      false,
    );
  }
});

test("the browser clock cannot suppress recovery offered by the server's scheduled state", async () => {
  const source = await readFile("src/components/SettingsDialog.tsx", "utf8");
  const eligibility = stripTypeScriptTypes(
    source.slice(
      source.indexOf("  const deletionPending ="),
      source.indexOf("  const deletionDeadline ="),
    ),
  );
  const choose = new Function(
    "deletionStatus",
    "userKey",
    "Date",
    `${eligibility}\nreturn deletionRecoverable;`,
  );
  const scheduled = { ownerId: owner, ...scheduledStatus() };
  const fastClock = { now: () => Date.parse(scheduled.recoverUntil) + 365 * 86400000 };
  assert.equal(choose(scheduled, owner, fastClock), true);
  assert.equal(choose({ ...scheduled, state: "finalizing" }, owner, fastClock), false);
  assert.equal(choose(scheduled, "another-owner", fastClock), false);
});
