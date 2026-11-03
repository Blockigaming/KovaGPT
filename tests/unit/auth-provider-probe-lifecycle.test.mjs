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
const configCode = ts.transpileModule(
  readFileSync("src/integrations/supabase/config.ts", "utf8").replaceAll(
    "import.meta.env",
    "TEST_ENV",
  ),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function fixture({
  environment = {
    VITE_SUPABASE_URL: "https://auth.example.invalid",
    VITE_SUPABASE_PUBLISHABLE_KEY: "public-fixture-key",
  },
} = {}) {
  const requests = [];
  const timers = [];
  let now = 0;
  const configExports = {};
  vm.runInNewContext(configCode, {
    exports: configExports,
    TEST_ENV: environment,
    require: (name) => {
      assert.equal(name, "@/config/public-config");
      return {
        PUBLIC_BACKEND_URL: "https://fallback.example.invalid",
        PUBLIC_BACKEND_KEY: "fallback-public-key",
      };
    },
  });
  const browserConfig = { ...configExports.SUPABASE_BROWSER_CONFIG };
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
    require: (name) => {
      assert.equal(name, "@/integrations/supabase/config");
      return { SUPABASE_BROWSER_CONFIG: browserConfig };
    },
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
    browserConfig,
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
  f.browserConfig.url = "https://other-auth.example.invalid";
  const other = f.api.fetchAuthProviderAvailability();
  assert.equal(f.requests.length, 2);
  f.succeed(1);
  await other;
  f.requests[0].resolve(Response.json({ external: { google: false } }));
  await original;
  assert.equal((await f.api.fetchAuthProviderAvailability()).google, true);
  assert.equal(f.requests.length, 2);
});

for (const [label, environment, expectedUrl, expectedKey] of [
  ["no build overrides", {}, "https://fallback.example.invalid", "fallback-public-key"],
  [
    "empty build overrides",
    { VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
    "https://fallback.example.invalid",
    "fallback-public-key",
  ],
  [
    "explicit project",
    {
      VITE_SUPABASE_URL: "https://custom.example.invalid/",
      VITE_SUPABASE_PUBLISHABLE_KEY: "custom-public-key",
    },
    "https://custom.example.invalid",
    "custom-public-key",
  ],
  [
    "legacy anon key",
    { VITE_SUPABASE_ANON_KEY: "legacy-public-key" },
    "https://fallback.example.invalid",
    "legacy-public-key",
  ],
]) {
  test(`provider availability uses the sign-in client's resolved public configuration: ${label}`, async () => {
    const f = fixture({ environment });
    const result = f.api.fetchAuthProviderAvailability();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, `${expectedUrl}/auth/v1/settings`);
    assert.equal(f.requests[0].options.headers.apikey, expectedKey);
    f.requests[0].resolve(Response.json({ external: { google: true, github: true, email: true } }));
    const availability = await result;
    assert.equal(availability.resolved, true);
    assert.equal(availability.google, true);
    assert.equal(availability.github, true);
  });
}
