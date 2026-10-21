import assert from "node:assert/strict";
import test from "node:test";
import { toJSON } from "seroval";
import { PATHS } from "./private-http-review.mjs";
import {
  createReviewStateHandler,
  installReviewState,
  readReviewFunctionNames,
  REVIEW_STATE_OPTIONS,
} from "./review-state-fixtures.mjs";

// Read the existing compiled manifest only. No build, browser, socket or service.
const names = readReviewFunctionNames();
const scenario = "item313-timestamp-review";
const origin = "http://127.0.0.1:4189";
const timestamp = "2026-10-17T19:05:00.000Z";
function fixture(account = "free") {
  const state = { active: true };
  const handler = createReviewStateHandler(scenario, account, names, 0, {
    isActive: () => state.active,
  });
  return {
    state,
    async invoke(name, options = {}) {
      const entry = [...names].find(([, value]) => value.split("_")[0] === name);
      assert.ok(entry, `Compiled mapping includes ${name}`);
      let response;
      await handler({
        request: () => ({
          url: () => `${options.origin ?? origin}/_serverFn/${entry[0]}${options.query ?? ""}`,
          method: () => options.method ?? "GET",
          headers: () => options.headers ?? {},
          postData: () => options.body ?? null,
        }),
        fulfill: async (value) => {
          response = value;
        },
        fallback: async () => {
          response = { fallback: true };
        },
      });
      return response;
    },
  };
}
const payload = (value) => "?payload=" + encodeURIComponent(JSON.stringify(toJSON(value)));
test("timestamp controller option is authenticated and HTTP-only, and includes the audit path", async () => {
  assert.ok(PATHS.includes("/audit-log"));
  assert.deepEqual(REVIEW_STATE_OPTIONS.find(({ id }) => id === scenario).accounts, [
    "free",
    "plus",
    "pro",
  ]);
  assert.throws(() => fixture("guest"), /requires a synthetic/);
  await assert.rejects(installReviewState({}, scenario, "free"), /ordinary private HTTP/);
});
test("compiled GET mappings return exact fixed timestamp contracts for every signed-in account", async () => {
  for (const account of ["free", "plus", "pro"]) {
    const f = fixture(account);
    assert.deepEqual((await f.invoke("listAuditLog")).json, {
      result: [
        {
          id: "synthetic-activity-time",
          provider: "google",
          action: "read",
          status: "success",
          resource_id: null,
          summary: "Synthetic timestamp sample; no connected account accessed",
          created_at: timestamp,
        },
      ],
      context: {},
    });
    assert.deepEqual(
      (await f.invoke("listNotifications", { query: payload({ data: {}, context: {} }) })).json,
      {
        result: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            source: "application",
            type: "review",
            title: "Synthetic timestamp sample",
            preview: "Read-only private review",
            actionUrl: null,
            readAt: timestamp,
            createdAt: timestamp,
          },
        ],
        context: {},
      },
    );
  }
});
test("timestamp sample rejects mutations, mismatched owners, stale sessions and malformed reads", async () => {
  const f = fixture();
  for (const name of [
    "listAuditLog",
    "listNotifications",
    "markNotificationsRead",
    "deleteNotifications",
  ])
    for (const method of ["POST", "PUT", "DELETE", "PATCH"])
      assert.equal((await f.invoke(name, { method })).status, 405);
  for (const name of ["markNotificationsRead", "deleteNotifications"])
    assert.equal((await f.invoke(name)).status, 405);
  for (const query of [
    "?owner=other",
    "?payload=",
    "?payload=bad",
    "?payload=x&payload=y",
    payload({ data: { owner: "other" } }),
    payload({ context: { userId: "other" } }),
    payload({ data: [] }),
    "?payload=" + "x".repeat(8193),
  ])
    assert.equal((await f.invoke("listNotifications", { query })).status, 400);
  assert.equal((await f.invoke("listAuditLog", { body: "{}" })).status, 400);
  assert.equal(
    (await f.invoke("listAuditLog", { headers: { "x-kova-owner": "other" } })).status,
    401,
  );
  assert.deepEqual(await f.invoke("listAuditLog", { origin: "https://outside.invalid" }), {
    fallback: true,
  });
  assert.deepEqual(await f.invoke("listProjects"), { fallback: true });
  f.state.active = false;
  assert.equal((await f.invoke("listAuditLog")).status, 401);
  assert.equal((await f.invoke("listNotifications")).status, 401);
});
