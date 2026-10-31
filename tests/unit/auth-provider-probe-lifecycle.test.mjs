import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { reactFixture } from "../helpers/kova-react-fixture.mjs";

const code = ts.transpileModule(
  readFileSync("src/lib/auth-providers.ts", "utf8").replaceAll("import.meta.env", "TEST_ENV"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture() {
  const requests = [];
  const timers = [];
  let now = 0;
  const environment = {
    VITE_SUPABASE_URL: "https://auth.example.invalid",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-fixture-key",
  };
  const api = {};
  vm.runInNewContext(code, {
    exports: api,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    Promise,
    AbortController,
    setTimeout: (callback, milliseconds) => {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (timer) => {
      timer.cleared = true;
    },
    TEST_ENV: environment,
    fetch: (url, options) =>
      new Promise((resolve, reject) => {
        requests.push({ url, options, resolve, reject });
        options.signal?.addEventListener("abort", () => reject(new Error("aborted consumer")), {
          once: true,
        });
      }),
  });
  const hook = () =>
    reactFixture(
      "src/hooks/useAuthProviders.ts",
      ({ useAuthProviders }) =>
        () =>
          useAuthProviders(true),
      { modules: { "@/lib/auth-providers": api }, globals: { AbortController } },
    );
  const succeed = (index = 0) =>
    requests[index].resolve(
      Response.json({
        external: { google: true, email: true },
        disable_signup: false,
      }),
    );
  return {
    api,
    requests,
    hook,
    succeed,
    timers,
    environment,
    advance: (milliseconds) => {
      now += milliseconds;
    },
  };
}

test("an auth-dialog remount cannot inherit the previous hook's aborted settings probe", async () => {
  const f = fixture();
  const first = f.hook();
  await first.flush();
  assert.equal(f.requests.length, 1);
  first.unmount();
  const replacement = f.hook();
  await replacement.flush();
  f.succeed();
  await replacement.flush();
  assert.equal(replacement.tree.resolved, true);
  assert.equal(replacement.tree.google, true);
  assert.equal(replacement.tree.error, undefined);
  assert.equal(f.requests.length, 1, "the replacement shares the fixed public settings read");
  replacement.unmount();
});

test("cancelling one subscriber does not cancel availability for another subscriber", async () => {
  const f = fixture();
  const first = new AbortController();
  const second = new AbortController();
  const cancelled = f.api.fetchAuthProviderAvailability(first.signal);
  const current = f.api.fetchAuthProviderAvailability(second.signal);
  first.abort();
  f.succeed();
  assert.equal((await cancelled).resolved, false);
  assert.equal((await current).google, true);
  assert.equal(f.requests.length, 1);
});

test("a pre-aborted subscriber cannot initiate a probe or consume cached success", async () => {
  const f = fixture();
  const controller = new AbortController();
  controller.abort();
  assert.equal((await f.api.fetchAuthProviderAvailability(controller.signal)).resolved, false);
  assert.equal(f.requests.length, 0);
  const current = f.api.fetchAuthProviderAvailability();
  f.succeed();
  assert.equal((await current).google, true);
  assert.equal((await f.api.fetchAuthProviderAvailability(controller.signal)).resolved, false);
  assert.equal(f.requests.length, 1);
});

test("failed or invalid settings remain unresolved and do not enable Google", async () => {
  for (const response of [Response.json({}, { status: 503 }), Response.json({})]) {
    const f = fixture();
    const result = f.api.fetchAuthProviderAvailability();
    f.requests[0].resolve(response);
    const value = await result;
    assert.equal(value.resolved, false);
    assert.equal(value.google, false);
    assert.ok(value.error);
  }
});

test("resetting a pending probe prevents its late result from replacing the new cache", async () => {
  const f = fixture();
  const old = f.api.fetchAuthProviderAvailability();
  f.api.resetAuthProviderCache();
  const current = f.api.fetchAuthProviderAvailability();
  f.succeed(1);
  assert.equal((await current).google, true);
  f.requests[0].resolve(Response.json({ external: { google: false } }));
  assert.equal((await old).google, false);
  assert.equal((await f.api.fetchAuthProviderAvailability()).google, true);
  assert.equal(f.requests.length, 2);
});

test("an upstream timeout fails closed once and clears its timer without an automatic retry", async () => {
  const f = fixture();
  const result = f.api.fetchAuthProviderAvailability();
  assert.equal(f.timers[0].milliseconds, 10_000);
  f.timers[0].callback();
  const value = await result;
  assert.equal(value.resolved, false);
  assert.equal(value.google, false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers[0].cleared, true);
});

test("an expired successful cache cannot advertise Google after the replacement read fails", async () => {
  const f = fixture();
  const first = f.api.fetchAuthProviderAvailability();
  f.succeed();
  await first;
  f.advance(5 * 60_000 + 1);
  const current = f.api.fetchAuthProviderAvailability();
  assert.equal(f.requests.length, 2);
  f.requests[1].reject(new Error("network unavailable"));
  const value = await current;
  assert.equal(value.resolved, false);
  assert.equal(value.google, false);
  assert.equal(
    f.timers.every((timer) => timer.cleared),
    true,
  );
});

test("provider settings are not shared across different project configurations", async () => {
  const f = fixture();
  const original = f.api.fetchAuthProviderAvailability();
  f.environment.VITE_SUPABASE_URL = "https://other-auth.example.invalid";
  const other = f.api.fetchAuthProviderAvailability();
  assert.equal(f.requests.length, 2);
  f.succeed(1);
  await other;
  f.requests[0].resolve(Response.json({ external: { google: false } }));
  await original;
  assert.equal((await f.api.fetchAuthProviderAvailability()).google, true);
  assert.equal(f.requests.length, 2);
});
