import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

async function runDeletion({
  exportReady = true,
  storageReady = true,
  uploadsReady = true,
  originalsReady = true,
  imagesReady = true,
  failPreflight = false,
  failExport = false,
  pendingDeveloperPayment = false,
  failBilling = false,
  failProjects = false,
  workReady = true,
  failWork = false,
  organizationFailure = null,
  initialState = "active",
  statusUnavailable = false,
  ambiguousAdmission = false,
  authFailure = null,
  authDeleted = false,
  method = "DELETE",
  expectedUser = "11111111-1111-4111-8111-111111111111",
  confirmation = "DELETE",
} = {}) {
  const calls = [];
  let state = initialState;
  class OrganizationAccountDeletionError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const mock = {
    OrganizationAccountDeletionError,
    readAccountDeletionState: async () => {
      calls.push("status-read");
      if (statusUnavailable) throw new Error("offline");
      return { state, startedAt: state === "deleting" ? new Date().toISOString() : null };
    },
    prepareOrganizationAccountDeletion: async () => {
      calls.push("organization-preflight");
      if (organizationFailure)
        throw new OrganizationAccountDeletionError(
          organizationFailure,
          organizationFailure === 409
            ? "organization_ownership_transfer_required"
            : "organization_deletion_preflight_unavailable",
        );
      if (pendingDeveloperPayment)
        throw new OrganizationAccountDeletionError(409, "developer_payment_reconciliation_pending");
      state = "deleting";
      if (ambiguousAdmission) throw new Error("lost admission response");
    },
    createFileRoute: () => (config) => config,
    requireUser: async () => ({
      userId: "11111111-1111-4111-8111-111111111111",
      supabaseAdmin: {
        from: () => ({
          select: () => ({
            eq: async () => {
              calls.push("billing-read");
              return {
                data: [
                  {
                    status: "active",
                    environment: "sandbox",
                    stripe_subscription_id: "sub_fixture",
                  },
                ],
                error: null,
              };
            },
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => {
              calls.push("auth-delete");
              if (authDeleted || !authFailure) state = "deleted";
              if (authFailure === "throw") throw new Error("lost auth response");
              return { error: authFailure === "error" ? { code: "auth_error" } : null };
            },
          },
        },
      },
    }),
    createStripeClient: () => ({
      subscriptions: {
        cancel: async () => {
          calls.push("billing-cancel");
          if (failBilling) throw new Error("offline");
        },
      },
    }),
    prepareStripeAccountDeletion: async () => {
      calls.push("billing-preflight");
      if (failPreflight) throw new Error("unresolved Customer creation");
      return [{}];
    },
    retireStripeCustomerForAccountDeletion: async () => {
      calls.push("billing-retire");
      if (failBilling) throw new Error("offline");
    },
    prepareLibraryOriginalDeletion: async () => {
      calls.push("original-cleanup");
      return originalsReady;
    },
    prepareAccountStorageArtifactDeletion: async () => {
      calls.push("upload-fence");
      return uploadsReady;
    },
    cleanupWorkRunnerOwner: async () => {
      calls.push("work-cleanup");
      if (failWork) throw new Error("private runner transport detail");
      return { complete: workReady };
    },
    disconnectAllFinance: async () => calls.push("finance-disconnect"),
    disconnectAllGoogle: async () => calls.push("google-disconnect"),
    disconnectAllGitHub: async () => calls.push("github-disconnect"),
    disconnectAllOAuth: async () => calls.push("oauth-disconnect"),
    isCrossSiteMutation: () => false,
    BodyReadError: class extends Error {},
    readUtf8BodyBounded: async (request) => request.text(),
    cleanupAccountExportsBeforeAccountDeletion: async () => {
      calls.push("export-cleanup");
      if (failExport) throw new Error("offline");
      if (pendingDeveloperPayment) throw new Error("developer_payment_reconciliation_pending");
      return { ready: exportReady };
    },
    deleteOwnedProjectsBeforeAccountDeletion: async () => {
      calls.push("project-cleanup");
      if (failProjects) throw new Error("project cleanup pending");
    },
    cleanupOwnedStorageBeforeAccountDeletion: async () => {
      calls.push("storage-cleanup");
      return { complete: storageReady && imagesReady };
    },
  };
  let source = stripTypeScriptTypes(
    await readFile(new URL("../../src/routes/api/account.ts", import.meta.url), "utf8"),
  );
  source = source.replace(/^import[\s\S]*?;\n/gmu, "");
  source = source.replace(
    /const \{ deleteOwnedProjectsBeforeAccountDeletion \} =\s*await import\("@\/lib\/project-deletion\.server"\);/u,
    "",
  );
  source = `const { ${Object.keys(mock).join(",")} } = globalThis[Symbol.for("account-delete-order-test")];\n${source}`;
  globalThis[Symbol.for("account-delete-order-test")] = mock;
  let route;
  try {
    route = (
      await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${crypto.randomUUID()}`
      )
    ).Route;
  } finally {
    delete globalThis[Symbol.for("account-delete-order-test")];
  }
  const response = await route.server.handlers[method]({
    request: new Request("https://kova.example/api/account", {
      method,
      headers: { "Content-Type": "application/json", "X-Kova-Expected-User": expectedUser },
      ...(method === "DELETE" ? { body: JSON.stringify({ confirmation }) } : {}),
    }),
  });
  return { response, calls, state };
}

test("pending export cleanup leaves paid service and connectors intact", async () => {
  const result = await runDeletion({ exportReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, ["status-read", "organization-preflight", "export-cleanup"]);
});

test("pending Storage cleanup leaves paid service and connectors intact", async () => {
  const result = await runDeletion({ storageReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
    "project-cleanup",
    "storage-cleanup",
  ]);
});

test("export cleanup failure preserves the deleting state without external disconnections", async () => {
  const result = await runDeletion({ failExport: true });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, ["status-read", "organization-preflight", "export-cleanup"]);
});

test("billing failure after cleanup retains Auth and the irreversible fence", async () => {
  const result = await runDeletion({ failBilling: true });
  assert.equal(result.response.status, 502);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
    "project-cleanup",
    "storage-cleanup",
    "billing-retire",
  ]);
});

test("successful deletion cleans private files then external services then Auth", async () => {
  const result = await runDeletion();
  assert.equal(result.response.status, 204);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
    "project-cleanup",
    "storage-cleanup",
    "billing-retire",
    "finance-disconnect",
    "google-disconnect",
    "github-disconnect",
    "oauth-disconnect",
    "auth-delete",
  ]);
});

test("ambiguous billing preflight leaves all private files and external services intact", async () => {
  const result = await runDeletion({ failPreflight: true });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
  ]);
});

test("a live upload blocks destructive Storage and billing cleanup", async () => {
  const result = await runDeletion({ uploadsReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
  ]);
});

test("Project cleanup failure retains Auth and all external connections", async () => {
  const result = await runDeletion({ failProjects: true });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
    "project-cleanup",
  ]);
});

for (const status of [409, 503]) {
  test(`organization preflight ${status} prevents export/file/billing destruction`, async () => {
    const result = await runDeletion({ organizationFailure: status });
    assert.equal(result.response.status, status);
    assert.deepEqual(result.calls, ["status-read", "organization-preflight", "status-read"]);
    assert.doesNotMatch(await result.response.text(), /private detail/);
  });
}

for (const failWork of [false, true]) {
  test(`unconfirmed Work cleanup ${failWork ? "failure" : "pending"} preserves metadata and external services`, async () => {
    const result = await runDeletion({ workReady: false, failWork });
    assert.equal(result.response.status, failWork ? 503 : 409);
    assert.deepEqual(result.calls, [
      "status-read",
      "organization-preflight",
      "export-cleanup",
      "billing-preflight",
      "work-cleanup",
    ]);
    assert.doesNotMatch(await result.response.text(), /private runner transport detail/);
  });
}

test("pending original-file cleanup blocks Project destruction, paid-service cancellation and Auth deletion", async () => {
  const result = await runDeletion({ originalsReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "status-read",
    "organization-preflight",
    "export-cleanup",
    "billing-preflight",
    "work-cleanup",
    "original-cleanup",
    "upload-fence",
  ]);
});

test("pending developer payment explains the blocker before first irreversible admission", async () => {
  const result = await runDeletion({ pendingDeveloperPayment: true });
  assert.equal(result.response.status, 409);
  const body = await result.response.json();
  assert.equal(body.code, "developer_payment_reconciliation_pending");
  assert.equal(body.state, "active");
  assert.equal(result.state, "active");
  assert.deepEqual(result.calls, ["status-read", "organization-preflight", "status-read"]);
});

for (const options of [
  { failExport: true },
  { failPreflight: true },
  { failWork: true },
  { failProjects: true },
  { failBilling: true },
  { authFailure: "throw" },
  { authFailure: "error" },
]) {
  test(`every destructive-stage failure preserves the durable state: ${JSON.stringify(options)}`, async () => {
    const result = await runDeletion(options);
    assert.equal(result.state, "deleting");
    const body = await result.response.json();
    assert.equal(body.state, "deleting");
    assert.equal(body.retryable, true);
    assert.doesNotMatch(body.error, /remains active|could not be re-enabled/u);
    assert.equal(result.calls.includes("fence-release"), false);
  });
}
test("an admitted retry skips organization admission and continues the same cleanup", async () => {
  const result = await runDeletion({ initialState: "deleting", organizationFailure: 409 });
  assert.equal(result.response.status, 204);
  assert.equal(result.calls.includes("organization-preflight"), false);
  assert.ok(result.calls.indexOf("export-cleanup") < result.calls.indexOf("storage-cleanup"));
});
test("lost admission response remains pending and does not run destruction twice", async () => {
  const result = await runDeletion({ ambiguousAdmission: true });
  assert.equal(result.response.status, 503);
  assert.equal((await result.response.json()).state, "deleting");
  assert.deepEqual(result.calls, ["status-read", "organization-preflight", "status-read"]);
});
for (const authFailure of ["throw", "error"])
  test(`lost final Auth reply reconciles actual deletion: ${authFailure}`, async () => {
    const result = await runDeletion({ authFailure, authDeleted: true });
    assert.equal(result.response.status, 204);
    assert.equal(result.calls.at(-1), "status-read");
  });
test("unverified status or a principal/confirmation mismatch starts no cleanup", async () => {
  const unavailable = await runDeletion({ statusUnavailable: true });
  assert.equal((await unavailable.response.json()).state, "unknown");
  assert.deepEqual(unavailable.calls, ["status-read"]);
  for (const options of [{ expectedUser: "another-owner" }, { confirmation: "NO" }]) {
    const result = await runDeletion(options);
    assert.ok(result.response.status >= 400);
    assert.deepEqual(result.calls, []);
  }
});
test("GET returns only owner-bound durable status and performs no cleanup", async () => {
  const result = await runDeletion({ initialState: "deleting", method: "GET" });
  assert.equal(result.response.status, 200);
  assert.equal((await result.response.json()).state, "deleting");
  assert.deepEqual(result.calls, ["status-read"]);
});

test("account image byte cleanup must finish before external retirement and Auth deletion", async () => {
  const { response, calls } = await runDeletion({ imagesReady: false });
  assert.equal(response.status, 409);
  assert.equal(calls.includes("auth-delete"), false);
  assert.equal(calls.includes("billing-retire"), false);
});
