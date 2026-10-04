import assert from "node:assert/strict";
import test from "node:test";
import { S6Run } from "../../scripts/release/s6-deployed-checks.mjs";
import { captureStorageProxyFailure } from "../../scripts/release/s6-storage-diagnostics.mjs";
import { ownedPrivateFileLink } from "../../src/lib/kova-auth-private-download.mjs";

const owner = "11111111-1111-4111-8111-111111111111";
const fixture = {
  cookie: "PRIVATE_COOKIE",
  principal: { accountId: owner, sessionId: "PRIVATE_SESSION" },
};
const row = {
  id: "22222222-2222-4222-8222-222222222222",
  project_id: "33333333-3333-4333-8333-333333333333",
  name: "fixture.png",
  storage_path: "33333333-3333-4333-8333-333333333333/abcdef012345/fixture.png",
  mime_type: "image/png",
  size_bytes: 68,
  kind: "image",
  status: "ready",
  content_sha256: null,
};
const response = {
  status: 404,
  data: { error: "Private file unavailable." },
  headers: new Headers({
    "content-type": "application/json",
    "cache-control": "private, no-store",
  }),
};

for (const scenario of [
  "visible",
  "rls-empty",
  "permission",
  "schema",
  "version",
  "malformed",
  "network",
  "router",
]) {
  test(`Storage failure receipt distinguishes ${scenario} without exposing private values or masking the assertion`, async () => {
    const run = new S6Run({
      database: {},
      serviceKey: "PRIVATE_SERVICE",
      apiKey: "test",
      deadline: Date.now() + 1000000,
      sourceSha: "a".repeat(40),
    });
    const requests = [];
    const link = await ownedPrivateFileLink("project", owner, row);
    run.app = async (path, opts) => {
      requests.push([path, opts]);
      run.lastHttpStatus = 200;
      if (scenario === "network") throw new Error("PRIVATE_TRANSPORT");
      return {
        status: 200,
        data: { session: { ...fixture.principal, emailVerified: true, email: "PRIVATE_EMAIL" } },
      };
    };
    run.service = async (path) => {
      requests.push([path]);
      run.lastHttpStatus = 200;
      return { status: 200, data: [] };
    };
    run.bearer = async (path, token) => {
      requests.push([path, token]);
      run.lastHttpStatus = 200;
      if (scenario === "permission")
        return { status: 403, data: { code: "42501", message: "PRIVATE_PERMISSION" } };
      if (scenario === "schema")
        return { status: 404, data: { code: "PGRST205", message: "PRIVATE_SCHEMA" } };
      return {
        status: 200,
        data:
          scenario === "rls-empty"
            ? []
            : [
                {
                  ...row,
                  ...(scenario === "version" ? { name: "changed.png" } : {}),
                  ...(scenario === "malformed" ? { size_bytes: "68" } : {}),
                },
              ],
      };
    };
    try {
      await run.check("storage_revocation_and_url_lifetime", async () => {
        run.stage = "storage_proxy_owner";
        run.lastHttpStatus = 404;
        await captureStorageProxyFailure(
          run,
          scenario === "router"
            ? {
                ...response,
                data: undefined,
                headers: new Headers({ "content-type": "text/html" }),
              }
            : response,
          fixture,
          row,
          "PRIVATE_JWT",
          link,
        );
        assert.equal(404, 200, "PRIVATE_RESPONSE_BODY");
      });
      const receipt = run.records[0];
      assert.equal(receipt.status, "FAIL");
      assert.equal(receipt.assertionId, "storage_proxy_owner");
      assert.equal(receipt.httpStatus, 404);
      assert.equal(receipt.actual, 404);
      assert.equal(receipt.expected, 200);
      assert.equal(requests.length, 3);
      assert.ok(
        requests.every(
          ([path]) => path.startsWith("/api/auth/session") || path.startsWith("/rest/v1/"),
        ),
      );
      assert.ok(!JSON.stringify(receipt).includes("PRIVATE_"));
      assert.ok(!JSON.stringify(receipt).includes(owner));
      const d = receipt.diagnostics;
      assert.equal(d.storagePrivateDenial, Number(scenario !== "router"));
      assert.equal(d.storageJsonResponse, Number(scenario !== "router"));
      assert.equal(d.storageDiagnosticErrors, Number(scenario === "network"));
      assert.equal(d.storageMetadataPermissionDenied, Number(scenario === "permission"));
      assert.equal(d.storageMetadataSchemaMissing, Number(scenario === "schema"));
      if (scenario === "rls-empty") assert.equal(d.storageMetadataRows, 0);
      if (scenario === "visible") assert.equal(d.storageVersionMatch, 1);
      if (scenario === "version") assert.equal(d.storageVersionMatch, 0);
      if (scenario === "malformed") assert.equal(d.storageMetadataInvalid, 1);
    } finally {
      await run.dispatcher.close();
    }
  });
}
