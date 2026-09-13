import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const sender = "11111111-1111-4111-8111-111111111111",
  recipient = "22222222-2222-4222-8222-222222222222",
  stranger = "33333333-3333-4333-8333-333333333333";
const token = "a".repeat(64);
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema kova_private;
  create function auth.uid()returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,service_role;grant execute on function auth.uid()to authenticated,service_role;
  create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean);
  insert into auth.users(id,email,email_confirmed_at)values('${sender}','sender@kova.test',now()),('${recipient}','recipient@kova.test',now()),('${stranger}','stranger@kova.test',now());
  create table public.account_deletion_fences(user_id uuid primary key references auth.users(id)on delete cascade);grant all on public.account_deletion_fences to service_role;`);
  await db.exec(
    await readFile("supabase/migrations/20260905001736_private_auth_identity_helpers.sql", "utf8"),
  );
  await db.exec(
    await readFile("supabase/migrations/20260905002122_trusted_contact_lifecycle.sql", "utf8"),
  );
  return db;
}
async function invite(
  db,
  {
    id = randomUUID(),
    actor = sender,
    actorEmail = "sender@kova.test",
    to = "recipient@kova.test",
    consent = true,
  } = {},
) {
  return (
    await db.query("select public.create_trusted_contact_invitation($1,$2,$3,$4,$5,$6) result", [
      actor,
      actorEmail,
      to,
      id,
      consent,
      "trusted-contact-consent-v1",
    ])
  ).rows[0].result;
}
async function command(
  db,
  contact,
  action,
  { actor = recipient, commandId = randomUUID(), digest = null, consent = false } = {},
) {
  return (
    await db.query("select public.command_trusted_contact($1,$2,$3,$4,$5,$6,$7) result", [
      actor,
      contact.id,
      contact.revision,
      action,
      commandId,
      digest,
      consent,
    ])
  ).rows[0].result;
}
async function read(db, id) {
  return (await db.query("select * from public.trusted_contacts where id=$1", [id])).rows[0];
}
async function accepted(db) {
  let contact = await invite(db);
  contact = await command(db, contact, "review", { digest: token });
  return command(db, contact, "accept", { digest: token, consent: true });
}

test("verified invitation and distinct recipient consent require Auth identity, token, and current revision", async () => {
  const db = await fixture();
  try {
    await db.exec("set role service_role");
    await assert.rejects(db.query("select id from auth.users"), /permission denied/);
    await assert.rejects(invite(db, { consent: false }), /unavailable/);
    await assert.rejects(invite(db, { actor: stranger }), /unavailable/);
    let contact = await invite(db);
    await assert.rejects(
      command(db, contact, "review", { actor: sender, digest: token }),
      /unavailable/,
    );
    await assert.rejects(
      command(db, contact, "review", { actor: stranger, digest: token }),
      /unavailable/,
    );
    contact = await command(db, contact, "review", { digest: token });
    await assert.rejects(
      command(db, contact, "accept", { digest: token, consent: false }),
      /unavailable/,
    );
    await assert.rejects(
      command(db, contact, "accept", { digest: "b".repeat(64), consent: true }),
      /unavailable/,
    );
    const commandId = randomUUID();
    const result = await command(db, contact, "accept", {
      commandId,
      digest: token,
      consent: true,
    });
    assert.equal(result.state, "accepted");
    const stored = await read(db, contact.id);
    assert.ok(stored.inviter_consented_at && stored.recipient_consented_at);
    assert.equal(stored.token_digest, null);
    assert.equal(
      (await command(db, contact, "accept", { commandId, digest: token, consent: true })).replayed,
      true,
    );
    await assert.rejects(
      command(db, result, "accept", { digest: token, consent: true }),
      /unavailable/,
    );
  } finally {
    await db.close();
  }
});
test("RLS exposes only parties, privately scopes blocks, and excludes token material from SELECT and exports", async () => {
  const db = await fixture();
  try {
    const contact = await invite(db);
    await command(db, contact, "review", { digest: token });
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${stranger}';`);
    assert.equal((await db.query("select * from trusted_contact_details")).rows.length, 0);
    await assert.rejects(invite(db), /permission denied/);
    await db.exec(`set request.jwt.claim.sub='${recipient}';`);
    assert.equal((await db.query("select * from trusted_contact_details")).rows.length, 1);
    await assert.rejects(
      db.query("select token_digest from trusted_contacts"),
      /permission denied/,
    );
    const rows = (
      await db.query("select * from trusted_contact_export_rows where user_id=$1", [recipient])
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].other_email, "sender@kova.test");
    assert.equal(JSON.stringify(rows).includes(token), false);
    assert.ok(
      Object.keys(rows[0]).every((key) => !key.includes("token") && !key.includes("fingerprint")),
    );
    await db.exec("reset role");
    await command(db, await read(db, contact.id), "block");
    await db.exec(`set role authenticated;set request.jwt.claim.sub='${sender}';`);
    assert.equal((await db.query("select * from trusted_contact_blocks")).rows.length, 0);
    await db.exec(`set request.jwt.claim.sub='${recipient}';`);
    assert.equal((await db.query("select * from trusted_contact_blocks")).rows.length, 1);
  } finally {
    await db.close();
  }
});
test("revocation and account deletion permanently invalidate challenge and command races", async () => {
  const db = await fixture();
  try {
    let contact = await invite(db);
    contact = await command(db, contact, "review", { digest: token });
    const revoked = await command(db, contact, "revoke", { actor: sender });
    assert.equal(revoked.state, "revoked");
    await assert.rejects(
      command(db, contact, "accept", { digest: token, consent: true }),
      /conflict/,
    );
    await command(db, revoked, "remove", { actor: sender });
    contact = await invite(db);
    contact = await command(db, contact, "review", { digest: token });
    await db.query("insert into account_deletion_fences values($1)", [sender]);
    await db.query("delete from account_deletion_fences where user_id=$1", [sender]);
    await assert.rejects(
      command(db, contact, "accept", { digest: token, consent: true }),
      /conflict/,
    );
    assert.equal((await read(db, contact.id)).token_digest, null);
    await db.query("delete from auth.users where id=$1", [sender]);
    assert.equal(await read(db, contact.id), undefined);
  } finally {
    await db.close();
  }
});
test("expiry, changed verified identity, cooldowns and pending caps fail closed", async () => {
  const db = await fixture();
  try {
    const contact = await invite(db);
    await assert.rejects(invite(db, { to: "stranger@kova.test" }), /unavailable/);
    await db.query("update trusted_contacts set expires_at=now()-interval '1 minute' where id=$1", [
      contact.id,
    ]);
    await assert.rejects(command(db, contact, "review", { digest: token }), /unavailable/);
    assert.equal(
      (await db.query("select state from trusted_contact_details where id=$1", [contact.id]))
        .rows[0].state,
      "expired",
    );
    await command(db, contact, "remove", { actor: sender });
    let next = await invite(db);
    await db.query("update auth.users set email_confirmed_at=null where id=$1", [recipient]);
    await assert.rejects(command(db, next, "review", { digest: token }), /unavailable/);
    await db.query("update auth.users set email_confirmed_at=now()where id=$1", [recipient]);
    next = await command(db, next, "review", { digest: token });
    await db.query(
      "update trusted_contacts set token_expires_at=now()-interval '1 second'where id=$1",
      [next.id],
    );
    await assert.rejects(
      command(db, next, "accept", { digest: token, consent: true }),
      /unavailable/,
    );
    await db.exec("update trusted_contacts set created_at=now()-interval '2 minutes';");
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,$2,now())", [
        id,
        `next${i}@kova.test`,
      ]);
      await invite(db, { to: `next${i}@kova.test` });
      await db.exec("update trusted_contacts set created_at=now()-interval '2 minutes';");
    }
    await assert.rejects(invite(db, { to: "stranger@kova.test" }), /unavailable/);
  } finally {
    await db.close();
  }
});
test("blocking ends the connection and prevents new invites until an exact-revision unblock", async () => {
  const db = await fixture();
  try {
    const contact = await accepted(db);
    const blocked = await command(db, contact, "block");
    assert.equal(blocked.state, "revoked");
    await db.exec("update trusted_contacts set created_at=now()-interval '2 minutes';");
    await assert.rejects(invite(db), /unavailable/);
    const block = (
      await db.query(
        "select id,revision from trusted_contact_blocks where user_id=$1 and blocked_user_id=$2",
        [recipient, sender],
      )
    ).rows[0];
    await assert.rejects(
      db.query("select unblock_trusted_contact($1,$2,99,$3)", [recipient, sender, block.id]),
      /conflict/,
    );
    assert.equal(
      (
        await db.query("select unblock_trusted_contact($1,$2,1,$3)ok", [
          recipient,
          sender,
          block.id,
        ])
      ).rows[0].ok,
      true,
    );
    const next = await invite(db);
    assert.equal(next.state, "pending");
    await command(db, next, "block");
    const newer = (
      await db.query(
        "select id,revision from trusted_contact_blocks where user_id=$1 and blocked_user_id=$2",
        [recipient, sender],
      )
    ).rows[0];
    assert.equal(newer.revision, block.revision);
    assert.notEqual(newer.id, block.id);
    await assert.rejects(
      db.query("select unblock_trusted_contact($1,$2,1,$3)", [recipient, sender, block.id]),
      /conflict/,
    );
    assert.equal((await db.query("select count(*) n from trusted_contact_blocks")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test("competing same-revision commands have one winner and a failed transition rolls back consent and token changes", async () => {
  const db = await fixture();
  try {
    let contact = await invite(db);
    contact = await command(db, contact, "review", { digest: token });
    await db.exec(`create function reject_contact_acceptance() returns trigger language plpgsql as $$
      begin if new.state='accepted' then raise exception 'injected_failure';end if;return new;end$$;
      create trigger reject_contact_acceptance after update on trusted_contacts for each row execute function reject_contact_acceptance();`);
    await assert.rejects(
      command(db, contact, "accept", { digest: token, consent: true }),
      /injected_failure/,
    );
    const unchanged = await read(db, contact.id);
    assert.equal(unchanged.state, "pending");
    assert.equal(unchanged.revision, contact.revision);
    assert.equal(unchanged.token_digest, token);
    assert.equal(unchanged.recipient_consented_at, null);
    await db.exec("drop trigger reject_contact_acceptance on trusted_contacts");
    const results = await Promise.allSettled([
      command(db, contact, "accept", { digest: token, consent: true }),
      command(db, contact, "revoke", { actor: sender }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.match(results.find((result) => result.status === "rejected").reason.message, /conflict/);
    assert.equal((await read(db, contact.id)).revision, contact.revision + 1);
    const current = await read(db, contact.id);
    if (current.state === "accepted") await command(db, current, "revoke", { actor: sender });
    assert.equal((await read(db, contact.id)).state, "revoked");
  } finally {
    await db.close();
  }
});
