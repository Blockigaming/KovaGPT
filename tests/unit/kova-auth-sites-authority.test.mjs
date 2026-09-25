import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authDatabase,
  passwordAccount,
  digest,
  owner,
  other,
} from "../helpers/kova-auth-database.mjs";
import { inspectSiteFiles } from "../../src/lib/sites-policy.mjs";
const read = (name) => readFile(`supabase/migrations/${name}`, "utf8");
const site = "40000000-0000-4000-8000-000000000004";
const scalar = async (db, name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) value`,
      args,
    )
  ).rows[0].value;
async function fixture() {
  const db = await authDatabase({
    beforeMigrations: `
  alter role service_role bypassrls;
  create schema kova_private;
  create table public.account_deletion_fences(user_id uuid primary key);
  create table public.banned_users(user_id uuid primary key);
  create table public.user_storage(user_id uuid primary key references auth.users(id) on delete cascade,bytes_used bigint default 0,updated_at timestamptz);
  create function public.try_add_storage_bytes(uuid,bigint,bigint) returns boolean language plpgsql as $$begin
   insert into public.user_storage(user_id) values($1) on conflict do nothing;
   update public.user_storage set bytes_used=bytes_used+$2 where user_id=$1 and bytes_used+$2<=$3;
   return found;end$$;
  create function kova_private.verified_auth_user_for_email(text) returns uuid language sql as $$select id from auth.users where lower(email)=lower($1) and email_confirmed_at is not null limit 1$$;
  ${await read("20260905004839_kova_sites_lifecycle.sql")}
  ${await read("20260905020833_sites_export_and_erasure.sql")}
 `,
  });
  try {
    const principal = await passwordAccount(db, { email: "site-owner@example.invalid" });
    const viewer = await passwordAccount(db, {
      id: other,
      email: "site-viewer@example.invalid",
      token: "viewer",
    });
    db.siteId = (
      await scalar(db, "mutate_kova_site", [
        owner,
        site,
        randomUUID(),
        0,
        "create",
        { title: "Owned site", slug: "owned-site" },
        1000000,
      ])
    ).siteId;
    const inspected = await inspectSiteFiles([
      { path: "index.html", base64: Buffer.from("private owned snapshot").toString("base64") },
    ]);
    delete inspected.bytes;
    const version = (
      await scalar(db, "mutate_kova_site", [
        owner,
        db.siteId,
        randomUUID(),
        1,
        "saveVersion",
        { versionId: randomUUID(), ...inspected },
        1000000,
      ])
    ).versionId;
    return { db, principal, viewer, version };
  } catch (error) {
    await db.close();
    throw error;
  }
}
const ticket = (db, p, preview) =>
  scalar(db, "issue_kova_owned_site_ticket", [
    p.account_id,
    db.siteId,
    digest("ticket"),
    p.session_id,
    preview,
  ]);
const redeem = (db) =>
  scalar(db, "redeem_kova_site_ticket", [db.siteId, digest("ticket"), digest("site-session")]);
const asset = (db) =>
  scalar(db, "read_kova_site_asset", [
    db.siteId,
    "owned-site",
    "index.html",
    digest("site-session"),
  ]);

test("owned Site tickets bind the real auth session and preserve their provider through one-time redemption", async () => {
  const { db, principal, version } = await fixture();
  try {
    await db.exec("set role service_role");
    assert.equal(
      await scalar(db, "check_kova_owned_site_auth_session", [owner, principal.session_id]),
      true,
    );
    assert.deepEqual(await ticket(db, principal, version), { slug: "owned-site" });
    assert.deepEqual(await redeem(db), { slug: "owned-site" });
    const row = (
      await db.query("select auth_provider,auth_session_id from public.kova_site_access_sessions")
    ).rows[0];
    assert.equal(row.auth_provider, "kova");
    assert.equal(row.auth_session_id, principal.session_id);
    assert.equal(
      (await asset(db)).base64,
      Buffer.from("private owned snapshot").toString("base64"),
    );
    assert.equal(await redeem(db), null);
    await db.exec("reset role");
    assert.equal(
      (
        await db.query(
          "select has_table_privilege('service_role','kova_private.auth_sessions','SELECT') allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});

test("a colliding hosted session cannot resurrect revoked owned Site tickets or downloaded asset sessions", async () => {
  const { db, principal, version } = await fixture();
  try {
    await ticket(db, principal, version);
    await redeem(db);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [
      principal.session_id,
      owner,
    ]);
    await db.query("update kova_private.auth_sessions set revoked_at=now() where id=$1", [
      principal.session_id,
    ]);
    assert.equal(await asset(db), null);
    assert.equal(
      await scalar(db, "check_kova_owned_site_auth_session", [owner, principal.session_id]),
      false,
    );
    await assert.rejects(ticket(db, principal, version));
    // Also exercise an already-issued but not-yet-redeemed ticket.
    await db.query("update kova_private.auth_sessions set revoked_at=null where id=$1", [
      principal.session_id,
    ]);
    await ticket(db, principal, version);
    await db.query(
      "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1",
      [owner],
    );
    assert.equal(await redeem(db), null);
  } finally {
    await db.close();
  }
});

test("owned Sites recheck suspension, factors, session expiry, provider and viewer ownership at every boundary", async (t) => {
  const { db, principal, viewer, version } = await fixture();
  try {
    await ticket(db, principal, version);
    await redeem(db);
    await assert.rejects(ticket(db, viewer, version));
    assert.equal(
      await scalar(db, "check_kova_owned_site_auth_session", [other, principal.session_id]),
      false,
    );
    for (const [label, sql] of [
      ["revocation", "update kova_private.auth_sessions set revoked_at=now() where account_id=$1"],
      [
        "expiry",
        "update kova_private.auth_sessions set expires_at=now()-interval '1 second' where account_id=$1",
      ],
      ["epoch", "update kova_private.auth_accounts set session_epoch=session_epoch+1 where id=$1"],
      ["MFA requirement", "update kova_private.auth_accounts set mfa_required=true where id=$1"],
      [
        "suspension",
        "update kova_private.auth_accounts set suspended_until='infinity' where id=$1",
      ],
      [
        "unverified email",
        "update kova_private.auth_accounts set email_verified_at=null where id=$1",
      ],
      [
        "disabled identity",
        "update kova_private.auth_identities set disabled_at=now() where account_id=$1",
      ],
      ["deletion fence", "insert into public.account_deletion_fences values($1)"],
      ["moderation", "insert into public.banned_users values($1)"],
    ])
      await t.test(label, async () => {
        await db.exec("begin");
        try {
          await db.query(sql, [owner]);
          assert.equal(await asset(db), null);
          assert.equal(
            await scalar(db, "check_kova_owned_site_auth_session", [owner, principal.session_id]),
            false,
          );
        } finally {
          await db.exec("rollback");
        }
      });
    assert.equal(
      (
        await db.query("select kova_private.site_authorized_session($1,$2,'unknown') allowed", [
          owner,
          principal.session_id,
        ])
      ).rows[0].allowed,
      false,
    );
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      await assert.rejects(ticket(db, principal, version));
      await assert.rejects(
        scalar(db, "check_kova_owned_site_auth_session", [owner, principal.session_id]),
      );
      await db.exec("reset role");
    }
  } finally {
    await db.close();
  }
});

test("legacy Site tickets remain explicitly legacy; owned proof never grants a foreign preview or changes public fallback", async () => {
  const { db, principal, version } = await fixture();
  try {
    // This test models an explicitly not-yet-retired legacy session, not a fallback
    // from a rejected owned ticket. Both public wrappers still choose one authority.
    await db.query("delete from kova_private.auth_legacy_retirements where account_id=$1", [owner]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [owner, owner]);
    await scalar(db, "issue_kova_site_ticket", [
      owner,
      db.siteId,
      digest("legacy-ticket"),
      owner,
      version,
    ]);
    const row = (
      await db.query(
        "select auth_provider from public.kova_site_access_sessions where token_hash=$1",
        [digest("legacy-ticket")],
      )
    ).rows[0];
    assert.equal(row.auth_provider, "supabase");
    await assert.rejects(
      scalar(db, "issue_kova_site_ticket", [
        owner,
        db.siteId,
        digest("wrong"),
        principal.session_id,
        version,
      ]),
    );
    assert.equal(await asset(db), null); // no public publication exists
  } finally {
    await db.close();
  }
});
