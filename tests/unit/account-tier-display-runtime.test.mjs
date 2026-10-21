import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHookHarness, loadUiModule, deferred, settle } from "../helpers/ui-state-harness.mjs";

function fixture({ configured = true } = {}) {
  const h = createHookHarness();
  let callback;
  const requests = [];
  let user = { id: "owner-a" };
  const client = {
    auth: {
      getUser: async () => ({ data: { user } }),
      onAuthStateChange(fn) {
        callback = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    rpc() {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  };
  const { useTier } = loadUiModule("src/hooks/useTier.ts", {
    react: h.react,
    "@/integrations/supabase/client": {
      supabase: client,
      getSupabaseClientConfigStatus: () => ({ configured }),
    },
    "@/lib/supabase-loose": { loose: (x) => x },
  });
  const render = () => h.render(useTier);
  render();
  return {
    render,
    requests,
    h,
    change(next) {
      user = next;
      callback(next ? "SIGNED_IN" : "SIGNED_OUT");
    },
  };
}

test("display does not call loading or failed entitlement Free", async () => {
  const f = fixture();
  assert.equal(f.render().status, "loading");
  await settle();
  f.requests[0].resolve({ data: null, error: { message: "Unavailable" } });
  await settle();
  assert.equal(f.render().status, "unavailable");
  assert.equal(f.render().tier, "free", "conservative compatibility fallback remains");
  assert.equal(f.render().loading, false);
});

test("only an authoritative known plan becomes ready; thrown failures settle", async () => {
  const f = fixture();
  await settle();
  f.requests[0].resolve({ data: { effectiveTier: "plus" }, error: null });
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
  f.requests[1].resolve({ data: { effectiveTier: "free" }, error: null });
  await settle();
  f.requests[0].resolve({ data: { effectiveTier: "pro" }, error: null });
  await settle();
  assert.equal(f.render().tier, "free");
  assert.equal(f.render().status, "ready");
  f.change(null);
  await settle();
  assert.equal(f.render().status, "signed_out");
});

test("missing configuration and unmounted results never become known plans", async () => {
  assert.equal(fixture({ configured: false }).render().status, "unavailable");
  const f = fixture();
  await settle();
  f.h.unmount();
  f.requests[0].resolve({ data: { effectiveTier: "pro" }, error: null });
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
