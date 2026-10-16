import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import * as bounded from "../../src/lib/bounded-json.server.mjs";

function fixture(options = {}) {
  const logs = new Map();
  let queueCalls = 0;
  const recipient = "support@kovagpt.com";
  const db = {
    from(table) {
      let id;
      let update;
      const query = {
        select: () => query,
        eq(_key, value) {
          id = value;
          return query;
        },
        update(value) {
          update = value;
          return query;
        },
        async maybeSingle() {
          if (table === "email_unsubscribe_tokens")
            return { data: { token: "test-token" }, error: null };
          if (update && options.receiptFailure)
            return { data: null, error: { message: "test failure" } };
          if (update) logs.set(id, { ...logs.get(id), ...update });
          return { data: logs.get(id) ?? null, error: null };
        },
        async insert(row) {
          if (options.reserveFailure) return { error: { code: "XX000" } };
          if (logs.has(row.id)) return { error: { code: "23505" } };
          logs.set(row.id, structuredClone(row));
          return { error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      assert.equal(name, "enqueue_email");
      assert.equal(args.queue_name, "transactional_emails");
      assert.equal(args.payload.to, recipient);
      assert.notEqual(args.payload.to, "customer@example.com");
      queueCalls++;
      if (options.queueFailure) throw new Error("Ambiguous test transport failure");
      return { data: options.missingAck ? null : 7, error: null };
    },
  };
  const config = loadUiModule(
    "src/routes/api/public/help-submit.ts",
    {
      react: { createElement: (_component, data) => data },
      "@react-email/components": { render: async () => "Test rendering" },
      "@supabase/supabase-js": { createClient: () => db },
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      zod: { z },
      "@/lib/bounded-json.server.mjs": bounded,
      "@/lib/email-templates/registry": {
        TEMPLATES: {
          "help-contact-notification": { component: () => null, to: recipient, subject: "Support" },
        },
      },
      "@/lib/backend-url": { resolveBackendUrl: () => "https://test.invalid" },
      "@/lib/chat-ingress.server.mjs": { resolveAnonymousClientKey: () => "test-client" },
      "@/lib/distributed-rate-limit.server": {
        consumeApplicationRateLimit: async () => ({
          allowed: !options.rateLimited,
          status: "limited",
          retryAfter: 60,
        }),
      },
    },
    {
      Response,
      crypto,
      TextEncoder,
      Number,
      process: {
        env: {
          KOVA_EMAIL_QUEUE_ENABLED: options.disabled ? "false" : "true",
          SUPABASE_SERVICE_ROLE_KEY: "noncredential-test-only",
        },
      },
      console: { error: () => {} },
    },
  ).Route;
  const requestId = crypto.randomUUID();
  const body = { requestId, email: "customer@example.com", message: "Test request", website: "" };
  return {
    logs,
    body,
    get queueCalls() {
      return queueCalls;
    },
    async send(override = {}) {
      return config.server.handlers.POST({
        request: new Request("https://test.invalid/api/public/help-submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, ...override }),
        }),
      });
    },
  };
}

test("support receipt acknowledges queue acceptance and retries do not enqueue twice", async () => {
  const f = fixture();
  const first = await f.send();
  assert.equal(first.status, 200);
  const receipt = await first.json();
  assert.deepEqual(receipt, { success: true, status: "queued", reference: f.body.requestId });
  assert.deepEqual(await (await f.send()).json(), receipt);
  assert.equal(f.queueCalls, 1);
  const mismatch = await f.send({ message: "Different message" });
  assert.equal(mismatch.status, 500);
  assert.equal(f.queueCalls, 1);
});
test("concurrent duplicate submissions reserve one durable request identity", async () => {
  const f = fixture();
  const replies = await Promise.all([f.send(), f.send()]);
  assert.ok(replies.some((r) => r.status === 200));
  assert.equal(f.queueCalls, 1);
});
for (const fault of ["queueFailure", "missingAck", "receiptFailure"]) {
  test(`${fault} remains unconfirmed and retry cannot enqueue another copy`, async () => {
    const f = fixture({ [fault]: true });
    assert.equal((await f.send()).status, 500);
    assert.equal((await f.send()).status, 500);
    assert.equal(f.queueCalls, 1);
  });
}
for (const fault of ["reserveFailure", "disabled", "rateLimited"]) {
  test(`${fault} fails closed before queue mutation`, async () => {
    const f = fixture({ [fault]: true });
    assert.ok((await f.send()).status >= 400);
    assert.equal(f.queueCalls, 0);
  });
}
test("bounded request and required identity reject invalid submissions without enqueue", async () => {
  const f = fixture();
  assert.equal((await f.send({ message: "a".repeat(40 * 1024) })).status, 413);
  assert.equal((await f.send({ requestId: undefined })).status, 400);
  assert.equal((await f.send({ website: "bot" })).status, 400);
  assert.equal(f.queueCalls, 0);
});
