import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const now = "2026-09-21T12:00:00Z";
export const expiry = "2026-10-01T12:00:00Z";
export const owner = "10000000-0000-4000-8000-000000000001";
export const other = "20000000-0000-4000-8000-000000000002";

export async function authDatabase({ beforeMigrations = "", beforeMigration } = {}) {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create role service_role;
      create role authenticator;
      create schema auth;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
        deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz,
        encrypted_password text, banned_until timestamptz, is_anonymous boolean default false,
        raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}');
      create table auth.identities(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
      create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id) on delete cascade);
      create table auth.mfa_factors (id uuid primary key, user_id uuid not null, status text not null);
      create table public.test_email_queue (id bigint generated always as identity primary key,
        queue_name text, payload jsonb);
      create function public.enqueue_email(queue_name text, payload jsonb) returns bigint
      language sql as $$ insert into public.test_email_queue(queue_name,payload)
        values(queue_name,payload) returning id $$;
    `);
    if (beforeMigrations) await db.exec(beforeMigrations);
    const directory = new URL("../../supabase/migrations/", import.meta.url);
    const names = (await readdir(directory))
      .filter((name) =>
        /_kova_(?:identity_session_store|auth_foreign_key_indexes|owned_.*)\.sql$/u.test(name),
      )
      .sort();
    for (const name of names) {
      if (beforeMigration) await beforeMigration(name, db);
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}

export async function passwordAccount(
  db,
  {
    id = owner,
    token = "session",
    passwordHash,
    email = `${id}@example.invalid`,
    at = now,
    expiresAt = expiry,
  } = {},
) {
  const hash = passwordHash ?? `scrypt-v1$32768$8$1$${"a".repeat(22)}$${"b".repeat(43)}`;
  await db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)`, [
    id,
    email,
    at,
  ]);
  await db.query(
    `select * from public.kova_auth_create_password_account($1,$2,'Fixture',$3,$4,$5,'{}'::jsonb,$6)`,
    [id, email, hash, digest(`verify-${id}`), expiresAt, at],
  );
  const session = (
    await db.query(`select * from public.kova_auth_consume_verification($1,$2,$3,$4)`, [
      digest(`verify-${id}`),
      digest(token),
      expiresAt,
      at,
    ])
  ).rows[0];
  const credential = (
    await db.query(`select id,revision from kova_private.auth_credentials where account_id=$1`, [
      id,
    ])
  ).rows[0];
  return { ...session, credential, token, digest: digest(token) };
}

export async function pendingFactor(db, token = "session", at = now) {
  const credential = (
    await db.query(
      `select c.id, c.revision from kova_private.auth_credentials c
    join kova_private.auth_sessions s on s.account_id = c.account_id
    where s.token_digest = decode($1,'hex') and c.activated_at is not null and c.disabled_at is null`,
      [digest(token)],
    )
  ).rows[0];
  const row = (
    await db.query(
      `select * from public.kova_auth_begin_totp_enrollment_reauthenticated($1,$2,'Fixture',$3,$4,$5)`,
      [
        digest(token),
        "v1.test-only.encrypted.secret.envelope",
        credential?.id ?? null,
        credential?.revision ?? null,
        at,
      ],
    )
  ).rows[0];
  return row.factor_id;
}

export const codeDigests = (prefix = "code") =>
  Array.from({ length: 8 }, (_, i) => digest(`${prefix}-${i}`));

export async function enableMfa(
  db,
  token = "session",
  next = "mfa-session",
  at = now,
  expiresAt = expiry,
) {
  const factorId = await pendingFactor(db, token, at);
  const session = (
    await db.query(`select * from public.kova_auth_activate_totp_with_session($1,$2,$3,$4,$5,$6)`, [
      digest(token),
      factorId,
      codeDigests(),
      digest(next),
      expiresAt,
      at,
    ])
  ).rows[0];
  return { ...session, factorId, token: next, digest: digest(next) };
}
