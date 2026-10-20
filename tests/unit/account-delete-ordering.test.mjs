import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";
import { validateAccountFinalizationClaim } from "../../src/lib/account-lifecycle-policy.mjs";

const OWNER = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const customer = { environment: "sandbox", customerId: "cus_fixture", retiredAt: null };

async function runFinalization({
  exportReady = true,
  storageReady = true,
  uploadsReady = true,
  originalsReady = true,
  imagesReady = true,
  workReady = true,
  failPreflight = false,
  failExport = false,
  failBilling = false,
  failProjects = false,
  failWork = false,
  failAcknowledgement = false,
  failConfirmation = false,
  failNotificationPreparation = false,
  organizationFailure = null,
  initialState = "finalizing",
  authFailure = null,
  authDeleted = false,
  authProvider = "supabase",
  userId = OWNER,
  renewFailureAt = 0,
  customerResponse = { id: "cus_fixture" },
  customers = [customer],
  authLookupError = null,
} = {}) {
  const calls = [],
    renewals = [];
  let state = initialState;
  class OrganizationAccountDeletionError extends Error {
    constructor(status, code) {
      super(code);
      this.status = status;
      this.code = code;
    }
  }
  const mocks = {
    validateAccountFinalizationClaim,
    OrganizationAccountDeletionError,
    renewAccountFinalization: async (_admin, owner, attempt) => {
      assert.equal(owner, OWNER);
      assert.equal(attempt, ATTEMPT);
      renewals.push([...calls]);
      if (state !== "finalizing" || renewals.length === renewFailureAt)
        throw new Error("account_policy_lease_lost");
    },
    prepareOrganizationAccountDeletion: async () => {
      calls.push("organization-preflight");
      if (organizationFailure)
        throw new OrganizationAccountDeletionError(
          organizationFailure === "organization_deletion_preflight_unavailable" ? 503 : 409,
          organizationFailure,
        );
    },
    cleanupAccountExportsBeforeAccountDeletion: async () => {
      calls.push("export-cleanup");
      if (failExport) throw new Error("private export transport detail");
      return { ready: exportReady };
    },
    createStripeClient: () => ({
      customers: {
        retrieve: async () => {
          calls.push("billing-preflight");
          if (failPreflight) throw new Error("private billing transport detail");
          return customerResponse;
        },
      },
    }),
    cleanupWorkRunnerOwner: async () => {
      calls.push("work-cleanup");
      if (failWork) throw new Error("private runner transport detail");
      return { complete: workReady };
    },
    prepareLibraryOriginalDeletion: async () => {
      calls.push("original-cleanup");
      return originalsReady;
    },
    prepareAccountStorageArtifactDeletion: async () => {
      calls.push("upload-fence");
      return uploadsReady;
    },
    deleteOwnedProjectsBeforeAccountDeletion: async () => {
      calls.push("project-cleanup");
      if (failProjects) throw new Error("private project transport detail");
    },
    cleanupOwnedStorageBeforeAccountDeletion: async () => {
      calls.push("storage-cleanup");
      return { complete: storageReady && imagesReady };
    },
    retireStripeCustomerForAccountDeletion: async () => {
      calls.push("billing-retire");
      if (failBilling) throw new Error("private billing retirement detail");
    },
    acknowledgePolicyCustomerRetired: async (_admin, owner, attempt, environment, id) => {
      calls.push("billing-ack");
      assert.equal(owner, OWNER);
      assert.equal(attempt, ATTEMPT);
      assert.equal(environment, "sandbox");
      assert.equal(id, "cus_fixture");
      if (failAcknowledgement) throw new Error("account_policy_retirement_unverified");
    },
    disconnectAllFinance: async () => calls.push("finance-disconnect"),
    disconnectAllGoogle: async () => calls.push("google-disconnect"),
    disconnectAllGitHub: async () => calls.push("github-disconnect"),
    disconnectAllOAuth: async () => calls.push("oauth-disconnect"),
    confirmAccountFinalization: async (_admin, owner, attempt) => {
      calls.push("auth-finalization-confirm");
      assert.equal(owner, OWNER);
      assert.equal(attempt, ATTEMPT);
      if (failConfirmation) throw new Error("account_policy_confirmation_unverified");
    },
    prepareAccountDeletionNotification: async (_admin, owner, attempt) => {
      calls.push("deletion-notice-prepare");
      assert.equal(owner, OWNER);
      assert.equal(attempt, ATTEMPT);
      if (failNotificationPreparation)
        throw new Error("account_email_deletion_preparation_unconfirmed");
    },
  };
  const admin = {
    auth: {
      admin: {
        deleteUser: async (id) => {
          assert.equal(id, OWNER);
          calls.push("auth-delete");
          if (authDeleted || !authFailure) state = "deleted";
          if (authFailure === "throw") throw new Error("private lost Auth response");
          return { error: authFailure === "error" ? { code: "auth_error" } : null };
        },
        getUserById: async (id) => {
          assert.equal(id, OWNER);
          calls.push("auth-status-read");
          return state === "deleted"
            ? { error: { status: 404, code: "user_not_found" } }
            : { data: { user: { id: OWNER } }, error: authLookupError };
        },
      },
    },
  };
  let source = stripTypeScriptTypes(
    await readFile("src/lib/account-deletion-finalizer.server.ts", "utf8"),
  )
    .replace(/^import[\s\S]*?;\n/gmu, "")
    .replace(
      /const\s+\{\s*deleteOwnedProjectsBeforeAccountDeletion\s*\}\s*=\s*await import\("@\/lib\/project-deletion\.server"\);/u,
      "",
    );
  const key = crypto.randomUUID();
  globalThis[key] = mocks;
  source = `const {${Object.keys(mocks).join(",")}}=globalThis[${JSON.stringify(key)}];\n${source}`;
  try {
    const module = await import(
      `data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${key}`
    );
    const response = await module.finalizeAccountAfterRecovery(
      { userId, authProvider, supabaseAdmin: admin },
      {
        state: "finalizing",
        attemptId: ATTEMPT,
        leaseUntil: new Date(Date.now() + 60_000).toISOString(),
        customers,
      },
    );
    return { response, calls, renewals, state };
  } finally {
    delete globalThis[key];
  }
}

const beforeWork = ["organization-preflight", "export-cleanup", "billing-preflight"];
const throughStorage = [
  ...beforeWork,
  "work-cleanup",
  "original-cleanup",
  "upload-fence",
  "project-cleanup",
  "storage-cleanup",
];
const successCalls = [
  ...throughStorage,
  "billing-retire",
  "billing-ack",
  "finance-disconnect",
  "google-disconnect",
  "github-disconnect",
  "oauth-disconnect",
  "auth-finalization-confirm",
  "deletion-notice-prepare",
  "auth-delete",
];

test("due-account finalization preserves private-cleanup, external-retirement and Auth ordering", async () => {
  const result = await runFinalization();
  assert.equal(result.response.status, 204);
  assert.equal(result.state, "deleted");
  assert.deepEqual(result.calls, successCalls);
  assert.equal(result.renewals.length, 8);
  assert.deepEqual(result.renewals[0], []);
  assert.ok(result.renewals.at(-1).includes("oauth-disconnect"));
});

test("optional deletion notice failure preserves confirmed deletion and never repeats it", async () => {
  const result = await runFinalization({ failNotificationPreparation: true });
  assert.equal(result.response.status, 204);
  assert.ok(
    result.calls.indexOf("auth-finalization-confirm") <
      result.calls.indexOf("deletion-notice-prepare"),
  );
  assert.equal(result.calls.filter((call) => call === "auth-delete").length, 1);
  assert.equal(result.state, "deleted");
});

test("pending export cleanup leaves paid service, private Work and connectors intact", async () => {
  const result = await runFinalization({ exportReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, ["organization-preflight", "export-cleanup"]);
});

test("export failure preserves finalizing state and exposes no private transport detail", async () => {
  const result = await runFinalization({ failExport: true });
  assert.equal(result.response.status, 503);
  assert.equal(result.state, "finalizing");
  assert.deepEqual(result.calls, ["organization-preflight", "export-cleanup"]);
  assert.doesNotMatch(await result.response.text(), /private export transport detail/);
});

for (const options of [
  { failPreflight: true },
  { customerResponse: null },
  { customerResponse: { id: "cus_other" } },
  { customers: [{ ...customer, retiredAt: new Date().toISOString() }] },
]) {
  test(`unverified Customer preflight blocks Work, files and external cleanup: ${JSON.stringify(options)}`, async () => {
    const result = await runFinalization(options);
    assert.equal(result.response.status, 409);
    assert.equal(result.calls.includes("work-cleanup"), false);
    assert.equal(result.calls.includes("project-cleanup"), false);
    assert.equal(result.calls.includes("billing-retire"), false);
    assert.equal(result.calls.includes("auth-delete"), false);
    assert.equal(result.state, "finalizing");
  });
}

for (const customers of [
  [customer, { ...customer, customerId: "cus_other" }],
  [{ ...customer, retiredAt: "not-a-date" }],
  [{ ...customer, environment: "unknown" }],
  [{ ...customer, customerId: "unbound" }],
  [null],
]) {
  test(`malformed durable Customer binding cannot start cleanup: ${JSON.stringify(customers)}`, async () => {
    const result = await runFinalization({ customers });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.renewals, []);
    assert.equal(result.state, "finalizing");
    assert.equal(
      await result.response.text(),
      '{"error":"Account finalization binding is invalid."}',
    );
  });
}

test("a previously deleted Customer can be verified and retired idempotently", async () => {
  const result = await runFinalization({
    customers: [{ ...customer, retiredAt: new Date().toISOString() }],
    customerResponse: { id: "cus_fixture", deleted: true },
  });
  assert.equal(result.response.status, 204);
  assert.deepEqual(result.calls, successCalls);
});

for (const options of [
  { workReady: false },
  { failWork: true },
  { originalsReady: false },
  { uploadsReady: false },
  { failProjects: true },
  { storageReady: false },
  { imagesReady: false },
]) {
  test(`unconfirmed private cleanup retains paid service, connectors and Auth: ${JSON.stringify(options)}`, async () => {
    const result = await runFinalization(options);
    assert.ok([409, 503].includes(result.response.status));
    for (const stage of [
      "billing-retire",
      "billing-ack",
      "finance-disconnect",
      "google-disconnect",
      "auth-delete",
    ])
      assert.equal(result.calls.includes(stage), false, stage);
    assert.equal(result.state, "finalizing");
    assert.doesNotMatch(await result.response.text(), /private .* transport detail/);
    if (options.uploadsReady === false || options.originalsReady === false)
      assert.equal(result.calls.includes("project-cleanup"), false);
  });
}

for (const organizationFailure of [
  "organization_ownership_transfer_required",
  "developer_payment_reconciliation_pending",
  "organization_deletion_preflight_unavailable",
]) {
  test(`organization/funding uncertainty blocks every destructive step: ${organizationFailure}`, async () => {
    const result = await runFinalization({ organizationFailure });
    assert.equal(
      result.response.status,
      organizationFailure === "organization_deletion_preflight_unavailable" ? 503 : 409,
    );
    assert.equal((await result.response.json()).code, organizationFailure);
    assert.deepEqual(result.calls, ["organization-preflight"]);
    assert.equal(result.state, "finalizing");
  });
}

for (const options of [{ failBilling: true }, { failAcknowledgement: true }]) {
  test(`retirement or acknowledgement failure preserves Auth and remaining connectors: ${JSON.stringify(options)}`, async () => {
    const result = await runFinalization(options);
    assert.equal(result.response.status, 502);
    assert.equal(result.calls.includes("finance-disconnect"), false);
    assert.equal(result.calls.includes("auth-delete"), false);
    assert.equal(result.state, "finalizing");
  });
}

test("failed final database confirmation cannot reach Auth deletion", async () => {
  const result = await runFinalization({ failConfirmation: true });
  assert.equal(result.response.status, 500);
  assert.equal(result.calls.includes("auth-delete"), false);
  assert.equal(result.state, "finalizing");
});

for (const authFailure of ["throw", "error"]) {
  test(`lost Auth reply remains pending without proof: ${authFailure}`, async () => {
    const result = await runFinalization({ authFailure });
    assert.equal(result.response.status, 500);
    assert.equal(result.state, "finalizing");
    assert.equal(result.calls.at(-1), "auth-status-read");
  });
  test(`lost Auth reply is reconciled only by exact authoritative missing-user proof: ${authFailure}`, async () => {
    const result = await runFinalization({ authFailure, authDeleted: true });
    assert.equal(result.response.status, 204);
    assert.equal(result.calls.at(-1), "auth-status-read");
  });
}

test("generic 404 Auth errors are not proof of successful final deletion", async () => {
  const result = await runFinalization({
    authFailure: "throw",
    authLookupError: { status: 404, code: "other_error" },
  });
  assert.equal(result.response.status, 500);
  assert.equal(result.state, "finalizing");
});

for (const renewFailureAt of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`lost finalization lease stops the next cleanup stage: renewal ${renewFailureAt}`, async () => {
    if (renewFailureAt === 7) {
      const result = await runFinalization({ renewFailureAt });
      assert.equal(result.response.status, 502);
      for (const stage of ["billing-retire", "billing-ack", "finance-disconnect", "auth-delete"])
        assert.equal(result.calls.includes(stage), false, stage);
      assert.equal(result.state, "finalizing");
    } else {
      await assert.rejects(runFinalization({ renewFailureAt }), /account_policy_lease_lost/);
    }
  });
}

for (const authProvider of [null, "unknown", "kova"]) {
  test(`worker never borrows an unaccepted Auth authority: ${authProvider}`, async () => {
    const result = await runFinalization({ authProvider });
    assert.equal(result.response.status, 503);
    assert.deepEqual(result.calls, []);
    assert.deepEqual(result.renewals, []);
  });
}

test("an invalid worker principal starts no cleanup", async () => {
  const result = await runFinalization({ userId: "another-owner" });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, []);
});
