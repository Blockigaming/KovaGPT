import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function load(path, dependencies) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports,
      AbortController,
      Response,
      URL,
      setTimeout,
      clearTimeout,
      require(name) {
        assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
        return dependencies[name];
      },
    },
  );
  return exports;
}
const {
  reserveAccountStorageArtifact,
  settleAccountStorageArtifact,
  prepareAccountStorageArtifactDeletion,
  sweepAccountStorageArtifacts,
} = load("src/lib/account-storage-artifacts.server.ts", {
  "@/integrations/supabase/client.server": { supabaseAdmin: {} },
});
const USER = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "423e4567-e89b-42d3-a456-426614174000";
const GENERATION = "623e4567-e89b-42d3-a456-426614174000";
const artifact = {
  generation: GENERATION,
  ownerId: USER,
  requesterId: USER,
  bucket: "library-images",
  path: `${USER}/${GENERATION}.png`,
};
const retired = {
  generation: GENERATION,
  owner_id: USER,
  requester_id: USER,
  bucket: "library-images",
  storage_path: artifact.path,
  state: "retired",
};

function clientFor(response, removeError = null) {
  const events = [];
  return {
    events,
    rpc(name, args) {
      events.push({ name, args });
      return {
        abortSignal: async (signal) => {
          assert.equal(signal.aborted, false);
          return { data: response(name, args), error: null };
        },
      };
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            events.push({ bucket, paths: [...paths] });
            return { error: removeError };
          },
        };
      },
    },
  };
}

test("only exact principal-scoped image attempt paths can reserve an upload", async () => {
  const client = clientFor(() => true);
  await reserveAccountStorageArtifact(artifact, client);
  assert.equal(client.events[0].args.p_generation, GENERATION);
  for (const change of [
    { path: `${OTHER}/${GENERATION}.png` },
    { requesterId: OTHER },
    { path: `${USER}/../${GENERATION}.png` },
    { path: `${USER}/other.png` },
    { bucket: "account-exports" },
  ]) {
    await assert.rejects(
      reserveAccountStorageArtifact({ ...artifact, ...change }, client),
      /invalid/,
    );
  }
  assert.equal(client.events.length, 1);
  for (const data of [false, null, "true"])
    await assert.rejects(
      reserveAccountStorageArtifact(
        artifact,
        clientFor(() => data),
      ),
      /not_reserved/,
    );
});

test("publication refusal and malformed responses never become success", async () => {
  assert.equal(
    await settleAccountStorageArtifact(
      artifact,
      clientFor(() => false),
    ),
    false,
  );
  for (const data of [null, {}, "true"])
    await assert.rejects(
      settleAccountStorageArtifact(
        artifact,
        clientFor(() => data),
      ),
      /unavailable/,
    );
});

test("a late object is removed again after a successful empty sweep", async () => {
  let exists = false;
  const client = clientFor((name) =>
    name === "claim_account_storage_artifact_cleanup" ? [retired] : true,
  );
  client.storage.from = () => ({
    async remove(paths) {
      assert.deepEqual([...paths], [artifact.path]);
      exists = false;
      return { error: null };
    },
  });
  assert.equal(await sweepAccountStorageArtifacts(USER, client), 1);
  exists = true; // A previously timed-out Storage upload commits after deletion.
  assert.equal(await sweepAccountStorageArtifacts(USER, client), 1);
  assert.equal(exists, false);
  assert.equal(
    client.events.filter((e) => e.name === "record_account_storage_artifact_cleanup").length,
    2,
  );
});

test("published, foreign, traversal, oversized, and failed cleanup batches are refused", async () => {
  for (const rows of [
    [{ ...retired, state: "published" }],
    [{ ...retired, owner_id: OTHER, requester_id: OTHER }],
    [{ ...retired, storage_path: `${USER}/../${GENERATION}.png` }],
    Array(26).fill(retired),
  ]) {
    const client = clientFor(() => rows);
    await assert.rejects(sweepAccountStorageArtifacts(USER, client), /invalid|unavailable/);
    assert.equal(
      client.events.some((e) => e.paths),
      false,
    );
  }
  const client = clientFor(() => [retired], { message: "secret provider error" });
  await assert.rejects(sweepAccountStorageArtifacts(USER, client), /cleanup_failed/);
  assert.equal(
    client.events.some((e) => e.name === "record_account_storage_artifact_cleanup"),
    false,
  );
});

test("account deletion checks readiness after its bounded sweep and waits for live leases", async () => {
  const client = clientFor((name) =>
    name === "claim_account_storage_artifact_cleanup" ? [] : false,
  );
  assert.equal(await prepareAccountStorageArtifactDeletion(USER, client), false);
  assert.deepEqual(
    client.events.map((e) => e.name),
    [
      "prepare_account_storage_artifact_deletion",
      "claim_account_storage_artifact_cleanup",
      "prepare_account_storage_artifact_deletion",
    ],
  );
});

function handler(secret, sweep) {
  return load("src/routes/api/internal/storage-artifact-cleanup.ts", {
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@/lib/http-security.server": { timingSafeEqualText: (left, right) => left === right },
    "@/lib/runtime-env.server": { runtimeEnv: () => secret },
    "@/lib/account-storage-artifacts.server": { sweepAccountStorageArtifacts: sweep },
  }).Route.server.handlers.POST;
}

test("cleanup endpoint requires its own secret and accepts no caller-selected scope", async () => {
  let calls = 0;
  const sweep = async () => {
    calls += 1;
    return 2;
  };
  for (const [secret, token, suffix, body, status] of [
    [null, "secret", "", undefined, 503],
    ["secret", "wrong", "", undefined, 401],
    ["secret", "secret", "?user=other", undefined, 400],
    ["secret", "secret", "", "{}", 400],
    ["secret", "secret", "", undefined, 200],
  ]) {
    const response = await handler(
      secret,
      sweep,
    )({
      request: new Request(`https://example.com/api/internal/storage-artifact-cleanup${suffix}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body,
      }),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(calls, 1);
});
