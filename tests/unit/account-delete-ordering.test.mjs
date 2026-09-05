import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

async function runDeletion({
  exportReady = true,
  storageReady = true,
  uploadsReady = true,
  failPreflight = false,
  failExport = false,
  failBilling = false,
  failProjects = false,
} = {}) {
  const calls = [];
  const mock = {
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
              return { error: null };
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
    prepareAccountStorageArtifactDeletion: async () => {
      calls.push("upload-fence");
      return uploadsReady;
    },
    disconnectAllFinance: async () => calls.push("finance-disconnect"),
    disconnectGoogle: async () => calls.push("google-disconnect"),
    disconnectAllGitHub: async () => calls.push("github-disconnect"),
    disconnectAllOAuth: async () => calls.push("oauth-disconnect"),
    isCrossSiteMutation: () => false,
    BodyReadError: class extends Error {},
    readUtf8BodyBounded: async (request) => request.text(),
    cleanupAccountExportsBeforeAccountDeletion: async () => {
      calls.push("export-cleanup");
      if (failExport) throw new Error("offline");
      return { ready: exportReady };
    },
    deleteOwnedProjectsBeforeAccountDeletion: async () => {
      calls.push("project-cleanup");
      if (failProjects) throw new Error("project cleanup pending");
    },
    cleanupOwnedStorageBeforeAccountDeletion: async () => {
      calls.push("storage-cleanup");
      return { complete: storageReady };
    },
    releaseAccountExportDeletionFence: async () => calls.push("fence-release"),
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
  const response = await route.server.handlers.DELETE({
    request: new Request("https://kova.example/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE" }),
    }),
  });
  return { response, calls };
}

test("pending export cleanup leaves paid service and connectors intact", async () => {
  const result = await runDeletion({ exportReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, ["export-cleanup", "fence-release"]);
});

test("pending Storage cleanup leaves paid service and connectors intact", async () => {
  const result = await runDeletion({ storageReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "export-cleanup",
    "billing-preflight",
    "upload-fence",
    "project-cleanup",
    "storage-cleanup",
    "fence-release",
  ]);
});

test("export cleanup failure releases the fence without external disconnections", async () => {
  const result = await runDeletion({ failExport: true });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, ["export-cleanup", "fence-release"]);
});

test("billing failure after cleanup retains Auth and releases the export fence", async () => {
  const result = await runDeletion({ failBilling: true });
  assert.equal(result.response.status, 502);
  assert.deepEqual(result.calls, [
    "export-cleanup",
    "billing-preflight",
    "upload-fence",
    "project-cleanup",
    "storage-cleanup",
    "billing-retire",
    "fence-release",
  ]);
});

test("successful deletion cleans private files then external services then Auth", async () => {
  const result = await runDeletion();
  assert.equal(result.response.status, 204);
  assert.deepEqual(result.calls, [
    "export-cleanup",
    "billing-preflight",
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
  assert.deepEqual(result.calls, ["export-cleanup", "billing-preflight", "fence-release"]);
});

test("a live upload blocks destructive Storage and billing cleanup", async () => {
  const result = await runDeletion({ uploadsReady: false });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.calls, [
    "export-cleanup",
    "billing-preflight",
    "upload-fence",
    "fence-release",
  ]);
});

test("Project cleanup failure retains Auth and all external connections", async () => {
  const result = await runDeletion({ failProjects: true });
  assert.equal(result.response.status, 503);
  assert.deepEqual(result.calls, [
    "export-cleanup",
    "billing-preflight",
    "upload-fence",
    "project-cleanup",
    "fence-release",
  ]);
});
