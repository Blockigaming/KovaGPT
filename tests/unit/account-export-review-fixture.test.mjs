import test from "node:test";
import assert from "node:assert/strict";
import { createAccountExportFixture, REVIEW_OWNER } from "../../review-kit/private-http-review.mjs";
const make = (scenario, active = () => true) => {
  const handler = createAccountExportFixture(scenario, active, () =>
    Date.parse("2026-10-18T23:40:00Z"),
  );
  return async (method = "GET", path = "/api/account/export", body = {}) => {
    let response;
    await handler({
      request: () => ({
        method: () => method,
        url: () => `http://127.0.0.1:4189${path}`,
        postDataJSON: () => body,
      }),
      fulfill: (value) => {
        response = value;
      },
      fallback: () => {
        response = { fallback: true };
      },
    });
    return response;
  };
};
test("export fixture progresses only local queued/processing/complete states and returns synthetic bytes", async () => {
  const request = make("account-export-ready");
  assert.deepEqual((await request()).json, { job: null });
  const created = await request("POST");
  assert.equal(created.status, 202);
  assert.equal(created.json.job.status, "queued");
  assert.equal((await request()).json.job.status, "processing");
  assert.equal(
    (await request("DELETE", "/api/account/export", { id: created.json.job.id })).status,
    409,
  );
  assert.equal((await request()).json.job.status, "complete");
  const ready = await request("GET", "/api/account/export?download=1");
  assert.equal(ready.json.requiresSession, true);
  const download = await request("GET", ready.json.downloadUrl);
  assert.deepEqual(JSON.parse(download.body), {
    sampleOnly: true,
    liveAccountData: false,
    conversations: [],
  });
  assert.equal(
    (await request("GET", ready.json.downloadUrl.replace(REVIEW_OWNER, "wrong-owner"))).status,
    404,
  );
});
test("default, guest, failed and indeterminate scenarios never fall through to real export operations", async () => {
  const normal = make("default");
  assert.equal((await normal("POST")).status, 503);
  assert.equal((await normal("GET", "/api/private-files?kind=export")).status, 404);
  assert.equal((await make("account-export-ready", () => false)("POST")).status, 401);
  const failed = make("account-export-failed");
  assert.equal((await failed()).json.job.status, "failed");
  const uncertain = make("account-export-uncertain");
  assert.equal((await uncertain("POST")).status, 503);
  assert.equal((await uncertain()).json.job, null);
});
test("queued cancellation and session revocation stay isolated", async () => {
  let active = true;
  const request = make("account-export-ready", () => active);
  const created = await request("POST");
  assert.equal(
    (await request("DELETE", "/api/account/export", { id: created.json.job.id })).json.job.status,
    "canceled",
  );
  assert.equal((await request("GET", "/api/account/export?download=1")).status, 409);
  active = false;
  assert.equal((await request()).status, 401);
});
