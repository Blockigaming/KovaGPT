import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { settle } from "../helpers/ui-state-harness.mjs";

import { planTierFixture as fixture } from "../helpers/plan-tier-fixture.mjs";

test("display does not call loading or failed entitlement Free", async () => {
  const f = fixture();
  assert.equal(f.render().status, "loading");
  await settle();
  f.requests[0].resolve({ ownerId: "owner-a", tier: null });
  await settle();
  assert.equal(f.render().status, "unavailable");
  assert.equal(f.render().tier, "free", "conservative compatibility fallback remains");
  assert.equal(f.render().loading, false);
});

test("only an authoritative known plan becomes ready; thrown failures settle", async () => {
  const f = fixture();
  await settle();
  f.requests[0].resolve({ ownerId: "owner-a", tier: "plus" });
  await settle();
  assert.equal(f.render().status, "ready");
  assert.equal(f.render().tier, "plus");
  f.change({ id: "owner-b" });
  assert.equal(f.render().status, "loading");
  await settle();
  f.requests[1].reject(new Error("Network unavailable"));
  await settle();
  assert.equal(f.render().status, "unavailable");
});

test("old account replies cannot replace a new account plan", async () => {
  const f = fixture();
  await settle();
  f.change({ id: "owner-b" });
  await settle();
  f.requests[1].resolve({ ownerId: "owner-b", tier: "free" });
  await settle();
  f.requests[0].resolve({ ownerId: "owner-a", tier: "pro" });
  await settle();
  assert.equal(f.render().tier, "free");
  assert.equal(f.render().status, "ready");
  f.change(null);
  await settle();
  assert.equal(f.render().status, "signed_out");
});

test("missing configuration and unmounted results never become known plans", async () => {
  const withoutPublicConfig = fixture({ configured: false });
  withoutPublicConfig.requests[0].resolve({ ownerId: "owner-a", tier: "plus" });
  await settle();
  assert.equal(
    withoutPublicConfig.render().tier,
    "plus",
    "verified server display is independent of public SDK configuration",
  );
  const f = fixture();
  await settle();
  f.h.unmount();
  f.requests[0].resolve({ ownerId: "owner-a", tier: "pro" });
  await settle();
  assert.equal(f.render().status, "loading");
});

test("sidebar shows real email and a neutral placeholder rather than invented initials", () => {
  const source = readFileSync("src/components/Sidebar.tsx", "utf8");
  assert.match(source, /accountEmail \|\| "Email unavailable"/);
  assert.match(source, /isLoaded && accountName \? accountName.charAt/);
  assert.match(source, /accountInitial \|\| <UserRound/);
  assert.match(source, /tierStatus === "ready"/);
  assert.doesNotMatch(source, /displayName.charAt|email\?\.split/);
});
