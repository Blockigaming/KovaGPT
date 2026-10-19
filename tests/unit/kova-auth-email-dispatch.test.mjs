import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { authDatabase } from "../helpers/kova-auth-database.mjs";
import { authHttp } from "../helpers/kova-auth-http.mjs";
import {
  createResendSender,
  dispatchAuthEmailBatch,
  emailDispatchConfiguration,
  main,
} from "../../scripts/auth-email/dispatch.mjs";

const queues = `
 create schema pgmq;
 create table pgmq.q_auth_emails(msg_id bigint generated always as identity primary key,
   read_ct integer not null default 0,vt timestamptz not null default now(),
   enqueued_at timestamptz not null default now(),message jsonb not null);
 create table public.test_email_dlq(payload jsonb);
 create or replace function public.enqueue_email(queue_name text,payload jsonb) returns bigint
 language sql as $$insert into pgmq.q_auth_emails(message) values(payload) returning msg_id$$;
 create function public.delete_email(queue_name text,message_id bigint) returns boolean language plpgsql as $$
 begin delete from pgmq.q_auth_emails where msg_id=message_id; return found; end$$;
 create function public.move_to_dlq(source_queue text,dlq_name text,message_id bigint,payload jsonb) returns bigint language plpgsql as $$
 begin insert into public.test_email_dlq values(payload); delete from pgmq.q_auth_emails where msg_id=message_id; return message_id; end$$;
 create table public.email_send_state(id integer primary key,auth_email_ttl_minutes integer,retry_after_until timestamptz,updated_at timestamptz);
 insert into public.email_send_state values(1,15,null,now());
 create table public.suppressed_emails(email text primary key);
 create table public.email_send_log(message_id text,template_name text,recipient_email text,status text,error_message text,metadata jsonb);
 create unique index on public.email_send_log(message_id) where status='sent';
`;

async function fixture() {
  const db = await authDatabase({ beforeMigrations: queues });
  const rpc = async (name, args = {}) => {
    const keys = Object.keys(args);
    const rows = (
      await db.query(
        `select * from public.${name}(${keys.map((key, i) => `${key}=>$${i + 1}`).join(",")})`,
        Object.values(args),
      )
    ).rows;
    if (
      [
        "kova_auth_create_compatibility_principal",
        "kova_auth_prepare_email_dispatch",
        "kova_auth_finish_email_dispatch",
      ].includes(name)
    )
      return Object.values(rows[0])[0];
    return JSON.parse(JSON.stringify(rows));
  };
  const h = authHttp({
    env: {
      KOVA_AUTH_PUBLIC_ORIGIN: "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
      KOVA_EMAIL_QUEUE_ENABLED: "true",
    },
    rpc: async (name, args) => ({ data: await rpc(name, args) }),
  });
  assert.equal(
    (
      await h.handleKovaSignup(
        new Request(
          "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io/api/auth/signup",
          {
            method: "POST",
            headers: {
              Origin: "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email: "fixture@example.test",
              password: "a synthetic strong password",
            }),
          },
        ),
      )
    ).status,
    202,
  );
  const queued = (await db.query("select * from pgmq.q_auth_emails")).rows[0];
  const env = {
    AZURE_ENVIRONMENT: "staging",
    CONTAINER_APP_NAME: "ca-kovagpt-staging",
    KOVA_AUTH_MODE: "kova",
    KOVA_EMAIL_QUEUE_ENABLED: "true",
    KOVA_AUTH_EMAIL_DISPATCH_ENABLED: "true",
    KOVA_AUTH_PUBLIC_ORIGIN: "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
    KOVA_AUTH_EMAIL_EXPECTED_ORIGIN:
      "https://ca-kovagpt-staging.fixture.eastus.azurecontainerapps.io",
    SUPABASE_URL: "https://ssssssssssssssssssss.supabase.co",
    KOVA_EXPECTED_SUPABASE_PROJECT_REF: "ssssssssssssssssssss",
    KOVA_AUTH_EMAIL_DATABASE_ORIGIN: "https://ssssssssssssssssssss.supabase.co",
    KOVA_AUTH_EMAIL_MESSAGE_IDS: queued.message.message_id,
    KOVA_AUTH_EMAIL_RECIPIENTS: "fixture@example.test",
    KOVA_AUTH_EMAIL_ISSUED_NOT_BEFORE: new Date(Date.now() - 5000).toISOString(),
    KOVA_AUTH_EMAIL_MAX_SENDS: "1",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    RESEND_API_KEY: "synthetic-resend-key",
  };
  const config = emailDispatchConfiguration(env);
  return { db, rpc, config, queued, env, h };
}

async function recoveryFixture() {
  const f = await fixture();
  await f.db.query("select * from public.kova_auth_consume_verification($1,$2,$3)", [
    f.queued.message.idempotency_key.split(":")[1],
    "c".repeat(64),
    new Date(Date.now() + 86400_000).toISOString(),
  ]);
  assert.equal(
    (
      await f.h.handleKovaRecoveryRequest(
        new Request(`${f.config.publicOrigin}/api/auth/recovery/request`, {
          method: "POST",
          headers: { Origin: f.config.publicOrigin, "Content-Type": "application/json" },
          body: JSON.stringify({ email: "fixture@example.test" }),
        }),
      )
    ).status,
    202,
  );
  f.queued = (
    await f.db.query(
      "select * from pgmq.q_auth_emails where message->>'label'='kova-auth-recovery'",
    )
  ).rows[0];
  f.config.messageIds = [f.queued.message.message_id];
  return f;
}
const scalar = async (db, query, args = []) =>
  Object.values((await db.query(query, args)).rows[0])[0];
const claim = (f, lease = randomUUID()) =>
  f.rpc("kova_auth_claim_email_dispatch", {
    p_lease_token: lease,
    p_message_ids: f.config.messageIds,
    p_recipients: f.config.recipients,
    p_not_before: f.config.issuedNotBefore,
  });
const finish = (f, id, lease, outcome = "sent") =>
  f.rpc("kova_auth_finish_email_dispatch", {
    p_queue_id: id,
    p_lease_token: lease,
    p_outcome: outcome,
    p_provider_id: outcome === "sent" ? "11111111-1111-4111-8111-111111111111" : null,
    p_error_code: outcome === "retry" ? "provider_unavailable" : null,
  });

test("bounded CLI defaults off and refuses production, stale scope, missing allowlist and excessive send budget", async () => {
  assert.equal((await main([], {})).execution_enabled, false);
  assert.throws(() => emailDispatchConfiguration({}), /execution_disabled/u);
  const source = readFileSync("scripts/auth-email/dispatch.mjs", "utf8");
  for (const name of [
    "KOVA_AUTH_EMAIL_MESSAGE_IDS",
    "KOVA_AUTH_EMAIL_RECIPIENTS",
    "KOVA_AUTH_EMAIL_ISSUED_NOT_BEFORE",
    "KOVA_AUTH_EMAIL_MAX_SENDS",
    "KOVA_AUTH_EMAIL_EXPECTED_ORIGIN",
    "KOVA_AUTH_EMAIL_DATABASE_ORIGIN",
  ])
    assert.ok(source.includes(name));
});

test("execution configuration rejects offplatform/production databases, wrong stage origin, stale scopes and excess budget before transport", async () => {
  const f = await fixture();
  try {
    for (const mutation of [
      { AZURE_ENVIRONMENT: "production" },
      {
        SUPABASE_URL: "https://external.example",
        KOVA_AUTH_EMAIL_DATABASE_ORIGIN: "https://external.example",
      },
      {
        SUPABASE_URL: "https://mfbycmbjygcfkrsuepxf.supabase.co",
        KOVA_AUTH_EMAIL_DATABASE_ORIGIN: "https://mfbycmbjygcfkrsuepxf.supabase.co",
        KOVA_EXPECTED_SUPABASE_PROJECT_REF: "mfbycmbjygcfkrsuepxf",
      },
      {
        KOVA_AUTH_PUBLIC_ORIGIN: "https://kovagpt.com",
        KOVA_AUTH_EMAIL_EXPECTED_ORIGIN: "https://kovagpt.com",
      },
      { KOVA_EXPECTED_SUPABASE_PROJECT_REF: "x".repeat(20) },
      { KOVA_AUTH_EMAIL_RECIPIENTS: "" },
      { KOVA_AUTH_EMAIL_MESSAGE_IDS: "" },
      { KOVA_AUTH_EMAIL_MAX_SENDS: "6" },
      { KOVA_AUTH_EMAIL_ISSUED_NOT_BEFORE: new Date(Date.now() - 16 * 60_000).toISOString() },
    ])
      assert.throws(
        () => emailDispatchConfiguration({ ...f.env, ...mutation }),
        /^Error: kova_auth_email_/u,
      );
  } finally {
    await f.db.close();
  }
});

test("actual verified-account recovery queues and dispatches while historical verification remains untouched", async () => {
  const f = await recoveryFixture();
  try {
    let requests = 0;
    const send = createResendSender(f.config, async (_url, init) => {
      requests += 1;
      const body = JSON.parse(init.body);
      assert.match(body.text, /Reset password: https:\/\/.+\/reset-password#token=/u);
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    });
    assert.equal((await dispatchAuthEmailBatch(f.config, { rpc: f.rpc, send })).sent, 1);
    assert.equal(requests, 1);
    assert.equal(
      await scalar(
        f.db,
        "select count(*)::int from pgmq.q_auth_emails where message->>'label'='kova-auth-verification'",
      ),
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("prepare rechecks recovery authority after the actual claim for epoch, mailbox, expiry, consumption, MFA and account availability", async (t) => {
  for (const [name, mutation] of [
    ["epoch", "update kova_private.auth_accounts set session_epoch=session_epoch+1"],
    [
      "mailbox",
      "update kova_private.auth_password_recoveries set verified_email='other@example.test'",
    ],
    [
      "expired",
      "update kova_private.auth_password_recoveries set created_at=now()-interval '1 hour',expires_at=now()-interval '1 second'",
    ],
    ["consumed", "update kova_private.auth_password_recoveries set consumed_at=now()"],
    ["mfa", "update kova_private.auth_accounts set mfa_required=true"],
    ["suspended", "update kova_private.auth_accounts set suspended_until=now()+interval '1 hour'"],
    ["deleted", "update kova_private.auth_accounts set deleted_at=now()"],
  ])
    await t.test(name, async () => {
      const f = await recoveryFixture();
      try {
        let claimed = false;
        const rpc = async (fn, args) => {
          const result = await f.rpc(fn, args);
          if (fn === "kova_auth_claim_email_dispatch" && result.length) {
            claimed = true;
            await f.db.exec(mutation);
          }
          return result;
        };
        const result = await dispatchAuthEmailBatch(f.config, {
          rpc,
          send: () => assert.fail("stale challenge must not reach provider"),
        });
        assert.equal(claimed, true);
        assert.equal(result.skipped, 1);
        assert.equal(result.attempted, 0);
        assert.equal(
          await scalar(
            f.db,
            "select count(*)::int from pgmq.q_auth_emails where message->>'label'='kova-auth-recovery'",
          ),
          0,
        );
      } finally {
        await f.db.close();
      }
    });
});

test("verification consumed after claim is rejected by prepare without exposing or reviving its link", async () => {
  const f = await fixture();
  try {
    const rpc = async (name, args) => {
      const result = await f.rpc(name, args);
      if (name === "kova_auth_claim_email_dispatch" && result.length)
        await f.db.exec("update kova_private.auth_email_verifications set consumed_at=now()");
      return result;
    };
    assert.equal(
      (await dispatchAuthEmailBatch(f.config, { rpc, send: () => assert.fail("must not send") }))
        .skipped,
      1,
    );
  } finally {
    await f.db.close();
  }
});

test("real signup queue, leasing and finish RPCs drive the native provider contract exactly once without touching unrelated messages", async () => {
  const f = await fixture();
  try {
    const unrelated = {
      ...f.queued.message,
      message_id: "U".repeat(43),
      to: "unapproved@example.test",
    };
    await f.db.query("insert into pgmq.q_auth_emails(message) values($1)", [unrelated]);
    await f.db.query(
      "insert into pgmq.q_auth_emails(message,enqueued_at) values($1,now()-interval '1 hour')",
      [{ ...f.queued.message, message_id: "H".repeat(43) }],
    );
    f.config.messageIds.push("U".repeat(43), "H".repeat(43));
    const before = (
      await f.db.query(
        "select msg_id,vt,read_ct,message from pgmq.q_auth_emails where msg_id<>$1 order by msg_id",
        [f.queued.msg_id],
      )
    ).rows;
    let sends = 0;
    const send = createResendSender(f.config, async (url, init) => {
      sends += 1;
      assert.equal(url, "https://api.resend.com/emails");
      assert.equal(init.redirect, "error");
      assert.equal(init.headers["Idempotency-Key"], f.queued.message.idempotency_key);
      const body = JSON.parse(init.body);
      assert.deepEqual(body.to, ["fixture@example.test"]);
      assert.equal(body.html, f.queued.message.html);
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    });
    assert.deepEqual(await dispatchAuthEmailBatch(f.config, { rpc: f.rpc, send }), {
      attempted: 1,
      sent: 1,
      retry: 0,
      failed: 0,
      skipped: 0,
    });
    assert.equal(sends, 1);
    assert.equal(
      await scalar(f.db, "select count(*)::int from public.email_send_log where status='sent'"),
      1,
    );
    assert.deepEqual(
      (await f.db.query("select msg_id,vt,read_ct,message from pgmq.q_auth_emails order by msg_id"))
        .rows,
      before,
    );
    assert.equal((await dispatchAuthEmailBatch(f.config, { rpc: f.rpc, send })).attempted, 0);
  } finally {
    await f.db.close();
  }
});

test("challenge consumption between claim and prepare, suppression and expired queue TTL fail closed without a provider call", async (t) => {
  for (const kind of ["consumed", "suppressed", "ttl", "recipient", "digest", "tampered_html"]) {
    await t.test(kind, async () => {
      const f = await fixture();
      try {
        let sends = 0;
        if (kind === "consumed")
          await f.db.exec("update kova_private.auth_email_verifications set consumed_at=now()");
        if (kind === "suppressed")
          await f.db.exec("insert into public.suppressed_emails values('fixture@example.test')");
        if (kind === "ttl")
          await f.db.query(
            "update pgmq.q_auth_emails set message=jsonb_set(message,'{queued_at}',to_jsonb((now()-interval '20 minutes')::text))",
          );
        if (kind === "recipient")
          await f.db.exec(
            "update kova_private.auth_accounts set primary_email='changed@example.test'",
          );
        if (kind === "digest")
          await f.db.exec(
            "update pgmq.q_auth_emails set message=jsonb_set(message,'{idempotency_key}',to_jsonb('kova-auth-verification:'||repeat('a',64)))",
          );
        if (kind === "tampered_html")
          await f.db.exec(
            "update pgmq.q_auth_emails set message=jsonb_set(message,'{html}',to_jsonb('<a href=\"https://evil.test\">open</a>'::text))",
          );
        await dispatchAuthEmailBatch(f.config, {
          rpc: f.rpc,
          send: async () => {
            sends += 1;
            assert.fail("must not send");
          },
        });
        assert.equal(sends, 0);
        assert.equal(await scalar(f.db, "select count(*)::int from pgmq.q_auth_emails"), 0);
        const serialized = JSON.stringify(
          (await f.db.query("select payload from public.test_email_dlq")).rows,
        );
        assert.ok(!serialized.includes("token="));
        assert.ok(!serialized.includes("fixture@example.test"));
      } finally {
        await f.db.close();
      }
    });
  }
});

test("expired leases are fenced, authoritative prepare rechecks state, retry backoff is bounded and never loops in one invocation", async () => {
  const f = await fixture();
  try {
    const oldLease = randomUUID(),
      newLease = randomUUID();
    const [first] = await claim(f, oldLease);
    assert.equal(first.attempt, 1);
    assert.deepEqual(await claim(f, newLease), []);
    await f.db.exec(
      "update pgmq.q_auth_emails set vt=now()-interval '1 second';update kova_private.auth_email_dispatches set lease_until=now()-interval '1 second'",
    );
    const [second] = await claim(f, newLease);
    assert.equal(second.attempt, 2);
    assert.equal(await finish(f, first.queue_id, oldLease), false);
    assert.equal(await scalar(f.db, "select count(*)::int from pgmq.q_auth_emails"), 1);
    assert.equal(await finish(f, second.queue_id, newLease, "retry"), true);
    assert.equal(
      await scalar(
        f.db,
        "select extract(epoch from next_attempt_at-updated_at)::int from kova_private.auth_email_dispatches",
      ),
      120,
    );
    assert.equal(
      (
        await dispatchAuthEmailBatch(f.config, {
          rpc: f.rpc,
          send: () => assert.fail("no retry before backoff"),
        })
      ).attempted,
      0,
    );
    await f.db.exec(
      "update pgmq.q_auth_emails set vt=now()-interval '1 second';update kova_private.auth_email_dispatches set next_attempt_at=now()-interval '1 second',attempts=4",
    );
    const [last] = await claim(f, newLease);
    assert.equal(last.attempt, 5);
    assert.equal(await finish(f, last.queue_id, newLease, "retry"), true);
    assert.equal(
      await scalar(f.db, "select status from kova_private.auth_email_dispatches"),
      "failed",
    );
    assert.equal(
      await scalar(f.db, "select payload->>'error_code' from public.test_email_dlq"),
      "retry_exhausted",
    );
  } finally {
    await f.db.close();
  }
});

test("lost provider acknowledgment retries the same body/key and DB lost acknowledgment never loses a confirmed send", async () => {
  const f = await fixture();
  try {
    const accepted = new Map();
    let requests = 0;
    const send = createResendSender(f.config, async (_url, init) => {
      requests += 1;
      const key = init.headers["Idempotency-Key"];
      if (!accepted.has(key)) {
        accepted.set(key, init.body);
        throw Error("synthetic lost provider response");
      }
      assert.equal(init.body, accepted.get(key));
      return Response.json({ id: "11111111-1111-4111-8111-111111111111" });
    });
    assert.equal((await dispatchAuthEmailBatch(f.config, { rpc: f.rpc, send })).retry, 1);
    await f.db.exec(
      "update pgmq.q_auth_emails set vt=now()-interval '1 second';update kova_private.auth_email_dispatches set next_attempt_at=now()-interval '1 second'",
    );
    await assert.rejects(
      dispatchAuthEmailBatch(f.config, {
        rpc: async (name, args) => {
          const result = await f.rpc(name, args);
          if (name === "kova_auth_finish_email_dispatch")
            throw Error("kova_auth_email_database_unavailable");
          return result;
        },
        send,
      }),
      /database_unavailable/u,
    );
    assert.equal(requests, 2);
    assert.equal(accepted.size, 1);
    assert.equal(
      await scalar(f.db, "select status from kova_private.auth_email_dispatches"),
      "sent",
    );
    assert.equal((await dispatchAuthEmailBatch(f.config, { rpc: f.rpc, send })).attempted, 0);
  } finally {
    await f.db.close();
  }
});

test("provider error classification sanitizes details and distinguishes concurrent409 from permanent409", async () => {
  for (const [status, name, outcome] of [
    [409, "concurrent_idempotent_requests", "retry"],
    [409, "invalid_idempotent_request", "failed"],
    [429, "rate_limit_exceeded", "retry"],
    [500, "internal_server_error", "retry"],
    [403, "validation_error", "failed"],
  ]) {
    const send = createResendSender({ resendKey: "synthetic-key" }, async () =>
      Response.json(
        { name, message: "secret token=should-never-surface" },
        { status, headers: { "Retry-After": "120" } },
      ),
    );
    const result = await send({ idempotency_key: "fixture" }, {});
    assert.equal(result.outcome, outcome);
    assert.ok(!JSON.stringify(result).includes("secret"));
    if (status === 429) assert.equal(result.retryAfterSeconds, 120);
  }
  for (const data of [{ id: 123 }, { id: "token=" + "a".repeat(43) }, null, {}]) {
    const send = createResendSender({ resendKey: "synthetic-key" }, async () =>
      Response.json(data),
    );
    assert.equal((await send({ idempotency_key: "fixture" }, {})).outcome, "retry");
  }
});

test("new RPCs are service-only, the dispatch table is private/RLS-protected, and queue-before-dispatch lock order uses a fresh clock", async () => {
  const f = await fixture();
  try {
    for (const fn of [
      "kova_auth_claim_email_dispatch(uuid,text[],text[],timestamptz)",
      "kova_auth_prepare_email_dispatch(bigint,uuid)",
      "kova_auth_finish_email_dispatch(bigint,uuid,text,text,text,integer)",
    ]) {
      for (const role of ["anon", "authenticated"])
        assert.equal(
          await scalar(f.db, "select has_function_privilege($1,$2,'execute')", [
            role,
            `public.${fn}`,
          ]),
          false,
        );
      assert.equal(
        await scalar(f.db, "select has_function_privilege('service_role',$1,'execute')", [
          `public.${fn}`,
        ]),
        true,
      );
    }
    assert.equal(
      await scalar(
        f.db,
        "select relrowsecurity from pg_class where oid='kova_private.auth_email_dispatches'::regclass",
      ),
      true,
    );
    assert.equal(
      await scalar(
        f.db,
        "select has_table_privilege('service_role','kova_private.auth_email_dispatches','select')",
      ),
      false,
    );
    const sql = readFileSync(
      "supabase/migrations/20261019223039_kova_owned_email_dispatch.sql",
      "utf8",
    );
    for (const name of ["prepare", "finish"]) {
      const body = sql.slice(
        sql.indexOf(`create function public.kova_auth_${name}_email_dispatch`),
      );
      const q = body.indexOf("from pgmq.q_auth_emails where msg_id=p_queue_id for update");
      const d = body.indexOf(
        "from kova_private.auth_email_dispatches where queue_id=p_queue_id for update",
      );
      const clock = body.indexOf("v_now := clock_timestamp()", d);
      assert.ok(q >= 0 && d > q && clock > d);
    }
  } finally {
    await f.db.close();
  }
});
