import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  "supabase/migrations/20261028114044_production_billing_catalog_guarded.sql",
  "utf8",
);

async function fixture({ checkoutTable = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create table public.subscriptions (id integer primary key);
    create table public.billing_plan_tiers (
      environment text not null,
      stripe_price_id text not null,
      lookup_key text not null,
      tier text not null,
      primary key (environment, stripe_price_id)
    );
  `);
  if (checkoutTable)
    await db.exec(`
    create table public.stripe_checkout_attempts (
      environment text not null,
      outcome text not null,
      session_expires_at timestamptz not null,
      idempotency_expires_at timestamptz not null
    );
  `);
  return db;
}

async function mappings(db) {
  const result = await db.query(`
    select stripe_price_id, lookup_key, tier
    from public.billing_plan_tiers
    where environment = 'live'
    order by stripe_price_id
  `);
  return result.rows;
}

test("empty production catalog becomes exactly the verified three Price mappings and replays safely", async () => {
  const db = await fixture();
  try {
    await db.exec(`
      insert into public.stripe_checkout_attempts values
      ('live', 'expired', now() - interval '2 days', now() - interval '1 day');
    `);
    await db.exec(migration);
    assert.deepEqual(await mappings(db), [
      {
        stripe_price_id: "price_1UAzhHAEZlsb6DBYWw2oUCeO",
        lookup_key: "plus_monthly",
        tier: "plus",
      },
      {
        stripe_price_id: "price_1UAzhRAEZlsb6DBYlafU4mhc",
        lookup_key: "pro_monthly",
        tier: "pro",
      },
      {
        stripe_price_id: "price_1UEw6FAEZlsb6DBYuksCKOBR",
        lookup_key: "pro_monthly",
        tier: "pro",
      },
    ]);
    await db.exec(migration);
    assert.equal((await mappings(db)).length, 3);
    assert.equal(
      (await db.query("select count(*)::integer as count from public.subscriptions")).rows[0].count,
      0,
    );
  } finally {
    await db.close();
  }
});

test("production baseline without Checkout attempt table still registers exact Prices", async () => {
  const db = await fixture({ checkoutTable: false });
  try {
    await db.exec(migration);
    assert.equal((await mappings(db)).length, 3);
  } finally {
    await db.close();
  }
});

test("changed mapping, subscription, and live Checkout each abort without catalog mutation", async () => {
  const cases = [
    {
      setup: `insert into public.billing_plan_tiers values
        ('live', 'price_other', 'pro_monthly', 'pro')`,
      error: /billing_catalog_mapping_conflict/,
    },
    {
      setup: "insert into public.subscriptions values (1)",
      error: /billing_catalog_baseline_changed/,
    },
    {
      setup: `insert into public.stripe_checkout_attempts values
        ('live', 'ready', now() + interval '1 day', now() + interval '1 day')`,
      error: /billing_catalog_baseline_changed/,
    },
  ];
  for (const { setup, error } of cases) {
    const db = await fixture();
    try {
      await db.exec(setup);
      await assert.rejects(db.exec(migration), error);
      await db.exec("rollback");
      assert.equal((await mappings(db)).length, setup.includes("price_other") ? 1 : 0);
    } finally {
      await db.close();
    }
  }
});
