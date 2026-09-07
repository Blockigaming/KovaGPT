import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const owner = "11111111-1111-4111-8111-111111111111",
  admin = "22222222-2222-4222-8222-222222222222",
  member = "33333333-3333-4333-8333-333333333333",
  other = "44444444-4444-4444-8444-444444444444",
  unverified = "55555555-5555-4555-8555-555555555555";
const read = (name) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");
async function fixture() {
  const db = new PGlite();
  await db.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema kova_private;
 grant usage on schema auth,kova_private to authenticated,service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,deleted_at timestamptz,banned_until timestamptz,is_anonymous boolean default false);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.account_deletion_fences(user_id uuid primary key references auth.users(id) on delete cascade,requested_at timestamptz default now(),updated_at timestamptz default now());
 alter table public.account_deletion_fences enable row level security;
 grant all on public.account_deletion_fences to service_role;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.com',now()),('${admin}','admin@example.com',now()),('${member}','member@example.com',now()),('${other}','other@example.com',now()),('${unverified}','unverified@example.com',null);
 revoke all on auth.users from public,anon,authenticated,service_role;
 `);
  await db.exec(read("20260905001736_private_auth_identity_helpers.sql"));
  await db.exec(read("20260905001454_organization_administration_foundation.sql"));
  await db.exec("set role service_role");
  return db;
}
async function mutate(db, actor, org, revision, action, payload = {}, mutationId = randomUUID()) {
  const result = await db.query("select public.mutate_organization($1,$2,$3,$4,$5,$6,$7) result", [
    actor,
    mutationId,
    org,
    revision,
    action,
    JSON.stringify(payload),
    "approved-test-v1",
  ]);
  return result.rows[0].result;
}
async function create(db, name = "Example") {
  const id = randomUUID();
  await mutate(db, owner, id, 0, "create", { name });
  return id;
}
async function invite(db, org, revision, email, role = "member", actor = owner) {
  return mutate(db, actor, org, revision, "invite", { email, role });
}
async function join(db, org, revision, recipient, invitationId) {
  return mutate(db, recipient, org, revision, "acceptInvite", { invitationId });
}
async function inspect(
  db,
  actor,
  org = null,
  view = "workspace",
  cursor = 0,
  through = null,
  limit = 100,
) {
  return (
    await db.query("select public.read_organization_workspace($1,$2,$3,$4,$5,$6) result", [
      actor,
      org,
      view,
      cursor,
      through,
      limit,
    ])
  ).rows[0].result;
}
async function asUser(db, user) {
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}

test("organization mutations work without service-role Auth-table access and require exact revisions", async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.query("select * from auth.users"), /permission denied/);
    const org = await create(db);
    const id = randomUUID();
    const first = await mutate(db, owner, org, 1, "rename", { name: "Updated" }, id);
    const replay = await mutate(db, owner, org, 1, "rename", { name: "Updated" }, id);
    assert.deepEqual(replay, first);
    await assert.rejects(
      mutate(db, owner, org, 1, "rename", { name: "Different" }, id),
      /idempotency_conflict/,
    );
    await assert.rejects(
      mutate(db, owner, org, 1, "rename", { name: "Stale" }),
      /revision_conflict/,
    );
    assert.equal((await inspect(db, owner, org)).organization.name, "Updated");
    await asUser(db, owner);
    await assert.rejects(
      mutate(db, owner, org, 2, "rename", { name: "Direct browser RPC" }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

test("targeted verified-account invitations never authorize from matching email or a different account", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    await assert.rejects(invite(db, org, 1, "unverified@example.com"), /recipient_unavailable/);
    const invitation = await invite(db, org, 1, "MEMBER@example.com");
    await assert.rejects(join(db, org, 2, other, invitation.id), /invitation_unavailable/);
    await assert.rejects(inspect(db, member, org), /organization_forbidden/);
    assert.equal((await inspect(db, member)).invitations.length, 1);
    await join(db, org, 2, member, invitation.id);
    assert.equal((await inspect(db, member, org)).organization.role, "member");
    await assert.rejects(
      mutate(db, member, org, 3, "setRole", { userId: member, role: "owner" }),
      /organization_forbidden/,
    );
    await assert.rejects(
      mutate(db, member, org, 3, "invite", { email: "other@example.com", role: "owner" }),
      /organization_forbidden/,
    );
  } finally {
    await db.close();
  }
});

test("least-privilege admins manage ordinary members while owner roles and domains remain owner-only", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    const invitation = await invite(db, org, 1, "admin@example.com", "admin");
    await join(db, org, 2, admin, invitation.id);
    await assert.rejects(
      invite(db, org, 3, "other@example.com", "owner", admin),
      /organization_forbidden/,
    );
    await assert.rejects(
      mutate(db, admin, org, 3, "claimDomain", { domain: "example.com" }),
      /organization_forbidden/,
    );
    const recipient = await invite(db, org, 3, "member@example.com", "member", admin);
    await join(db, org, 4, member, recipient.id);
    await mutate(db, admin, org, 5, "removeMember", { userId: member });
    await assert.rejects(inspect(db, member, org), /organization_forbidden/);
    await asUser(db, member);
    assert.equal(
      (await db.query("select count(*)::integer n from public.organizations")).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("select count(*)::integer n from public.organization_members")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("last-owner and account-deletion preflight preserve access before any external cleanup", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    await assert.rejects(mutate(db, owner, org, 1, "leave"), /organization_last_owner/);
    await assert.rejects(
      db.query("select public.prepare_org_account_deletion($1)", [owner]),
      /ownership_transfer_required/,
    );
    assert.equal(
      (await db.query("select count(*)::integer n from public.account_deletion_fences")).rows[0].n,
      0,
    );
    const invitation = await invite(db, org, 1, "admin@example.com", "owner");
    await join(db, org, 2, admin, invitation.id);
    assert.equal(
      (await db.query("select public.prepare_org_account_deletion($1) ready", [owner])).rows[0]
        .ready,
      true,
    );
    await assert.rejects(
      db.query("select public.prepare_org_account_deletion($1)", [admin]),
      /ownership_transfer_required/,
    );
    await assert.rejects(mutate(db, admin, org, 3, "leave"), /organization_last_owner/);
    await assert.rejects(
      mutate(db, owner, org, 3, "rename", { name: "Deleting owner" }),
      /account_unavailable/,
    );
    await asUser(db, owner);
    assert.equal(
      (await db.query("select count(*)::integer n from public.organizations")).rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});

test("revoked invitations and current-member RLS do not retain organization access", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    const invitation = await invite(db, org, 1, "member@example.com");
    await mutate(db, owner, org, 2, "revokeInvite", { invitationId: invitation.id });
    await assert.rejects(join(db, org, 3, member, invitation.id), /invitation_unavailable/);
    await asUser(db, other);
    for (const table of [
      "organizations",
      "organization_members",
      "organization_invitations",
      "organization_domains",
      "organization_audit_events",
    ])
      assert.equal(
        (await db.query(`select count(*)::integer n from public.${table}`)).rows[0].n,
        0,
      );
  } finally {
    await db.close();
  }
});

test("domain and SSO claims require current proof and never enroll users", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    const domain = await mutate(db, owner, org, 1, "claimDomain", { domain: "example.com" });
    await assert.rejects(
      mutate(db, owner, org, 2, "verifyDomain", { domainId: domain.id }),
      /proof_required/,
    );
    await assert.rejects(
      mutate(db, owner, org, 2, "configureSso", { domainId: domain.id, providerId: randomUUID() }),
      /sso_not_ready/,
    );
    const challenge = (await inspect(db, owner, org)).domains[0];
    await mutate(db, owner, org, 2, "verifyDomain", {
      domainId: domain.id,
      verifiedChallenge: challenge.challenge_token,
    });
    await mutate(db, owner, org, 3, "configureSso", {
      domainId: domain.id,
      providerId: randomUUID(),
    });
    assert.equal((await inspect(db, owner, org)).sso.verified, true);
    await mutate(db, owner, org, 4, "revokeDomain", { domainId: domain.id });
    assert.equal((await inspect(db, owner, org)).sso.state, "disabled");
    await assert.rejects(inspect(db, other, org), /organization_forbidden/);
  } finally {
    await db.close();
  }
});

test("audit exports are safe bounded snapshots that stop after authorization is revoked", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    const invitation = await invite(db, org, 1, "admin@example.com", "admin");
    await join(db, org, 2, admin, invitation.id);
    const page = await inspect(db, admin, org, "audit", 0, null, 2);
    assert.equal(page.events.length, 2);
    assert.equal(page.hasMore, true);
    assert.ok(!JSON.stringify(page).includes("@example.com"));
    const next = await inspect(db, admin, org, "audit", page.nextCursor, page.through, 2);
    assert.equal(next.events.length, 1);
    assert.equal(next.hasMore, false);
    assert.equal(next.through, page.through);
    await mutate(db, owner, org, 3, "removeMember", { userId: admin });
    await assert.rejects(
      inspect(db, admin, org, "audit", page.nextCursor, page.through, 2),
      /organization_forbidden/,
    );
    await assert.rejects(inspect(db, owner, org, "audit", 0, null, 201), /request_invalid/);
  } finally {
    await db.close();
  }
});

test("retention stays draft and closing requires the sole owner plus exact name confirmation", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    await mutate(db, owner, org, 1, "saveRetentionDraft", { days: 30 });
    const detail = await inspect(db, owner, org);
    assert.equal(detail.organization.retentionDaysDraft, 30);
    assert.equal(detail.organization.retentionEnforced, false);
    await assert.rejects(
      mutate(db, owner, org, 2, "close", { confirmation: "Wrong name" }),
      /close_requires_sole_owner/,
    );
    await mutate(db, owner, org, 2, "close", { confirmation: "Example" });
    assert.equal((await inspect(db, owner)).organizations.length, 0);
    assert.equal(
      (await db.query("select public.prepare_org_account_deletion($1) ready", [owner])).rows[0]
        .ready,
      true,
    );
  } finally {
    await db.close();
  }
});

test("expired domain claims transfer only after fresh proof, preserving old-tenant audit and revision", async () => {
  const db = await fixture();
  try {
    const first = await create(db, "First");
    const old = await mutate(db, owner, first, 1, "claimDomain", { domain: "example.com" });
    const oldProof = (await inspect(db, owner, first)).domains[0].challenge_token;
    await mutate(db, owner, first, 2, "verifyDomain", {
      domainId: old.id,
      verifiedChallenge: oldProof,
    });
    await mutate(db, owner, first, 3, "configureSso", {
      domainId: old.id,
      providerId: randomUUID(),
    });
    const second = randomUUID();
    await mutate(db, other, second, 0, "create", { name: "Second" });
    const fresh = await mutate(db, other, second, 1, "claimDomain", { domain: "example.com" });
    const proof = (await inspect(db, other, second)).domains[0].challenge_token;
    await assert.rejects(
      mutate(db, other, second, 2, "verifyDomain", {
        domainId: fresh.id,
        verifiedChallenge: proof,
      }),
      /unique/,
    );
    await db.query(
      "update public.organization_domains set verification_expires_at=now()-interval '1 second' where id=$1",
      [old.id],
    );
    await assert.rejects(
      mutate(db, other, second, 2, "verifyDomain", {
        domainId: fresh.id,
        verifiedChallenge: oldProof,
      }),
      /proof_required/,
    );
    await mutate(db, other, second, 2, "verifyDomain", {
      domainId: fresh.id,
      verifiedChallenge: proof,
    });
    const expired = await inspect(db, owner, first);
    assert.equal(expired.organization.revision, 5);
    assert.equal(expired.domains[0].state, "pending");
    assert.notEqual(expired.domains[0].challenge_token, oldProof);
    assert.equal(expired.sso.state, "disabled");
    assert.equal((await inspect(db, other, second)).domains[0].state, "verified");
    const audit = await inspect(db, owner, first, "audit");
    const event = audit.events.find((item) => item.action === "domainVerificationExpired");
    assert.ok(event);
    assert.equal(event.actorUserId, undefined);
    assert.ok(!JSON.stringify(event).includes(other));
    await assert.rejects(
      mutate(db, owner, first, 4, "rename", { name: "Stale owner" }),
      /revision_conflict/,
    );
  } finally {
    await db.close();
  }
});

test("database backstops prevent direct last-owner revocation and Auth cascade before ownership transfer", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    await assert.rejects(
      db.query("delete from public.organization_members where organization_id=$1 and user_id=$2", [
        org,
        owner,
      ]),
      /last_owner/,
    );
    await assert.rejects(
      db.query(
        "update public.organization_members set role='member' where organization_id=$1 and user_id=$2",
        [org, owner],
      ),
      /last_owner/,
    );
    await db.exec("reset role");
    await assert.rejects(
      db.query("delete from auth.users where id=$1", [owner]),
      /ownership_transfer_required/,
    );
    await db.exec("set role service_role");
    const invitation = await invite(db, org, 1, "admin@example.com", "owner");
    await join(db, org, 2, admin, invitation.id);
    await db.query("select public.prepare_org_account_deletion($1)", [owner]);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [owner]);
    await db.exec("set role service_role");
    assert.equal((await inspect(db, admin, org)).members.length, 1);
  } finally {
    await db.close();
  }
});

test("declining invitations removes pending access and receipt cleanup preserves eight days of replay evidence", async () => {
  const db = await fixture();
  try {
    const org = await create(db);
    const invitation = await invite(db, org, 1, "member@example.com");
    await mutate(db, member, org, 2, "declineInvite", { invitationId: invitation.id });
    assert.equal((await inspect(db, member)).invitations.length, 0);
    await assert.rejects(join(db, org, 3, member, invitation.id), /invitation_unavailable/);
    assert.equal(
      (
        await db.query(
          "select public.purge_organization_mutation_receipts(now()+interval '1 day',500) n",
        )
      ).rows[0].n,
      0,
    );
    await db.query(
      "update public.organization_mutation_receipts set created_at=now()-interval '9 days'",
    );
    assert.equal(
      (await db.query("select public.purge_organization_mutation_receipts(now(),1) n")).rows[0].n,
      1,
    );
    assert.equal(
      (await db.query("select count(*)::integer n from public.organization_audit_events")).rows[0]
        .n,
      3,
    );
    await asUser(db, owner);
    await assert.rejects(
      db.query("select public.purge_organization_mutation_receipts(now(),1)"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
