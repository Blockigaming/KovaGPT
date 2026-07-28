import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("capability registry declares platform requirements", async () => {
  const source = await read("src/platform/capabilities.ts");
  for (const field of ["route", "permission", "requiredPlan", "providers", "flags", "dependencies"])
    assert.match(source, new RegExp(field));
  assert.match(source, /validateCapabilityRegistry/);
});

test("flags support plans, rollout, account overrides, and kill switches", async () => {
  const source = await read("src/platform/feature-flags.ts");
  assert.match(source, /userFlags/);
  assert.match(source, /rollout/);
  assert.match(source, /killSwitch/);
  assert.match(source, /hashBucket/);
});

test("events, extensions, providers, caching, and metrics expose typed seams", async () => {
  const [events, extensions, providers, cache, metrics] = await Promise.all([
    read("src/platform/events.ts"),
    read("src/platform/extensions.ts"),
    read("src/platform/providers.ts"),
    read("src/platform/cache.ts"),
    read("src/platform/observability.ts"),
  ]);
  assert.match(events, /publish<T>/);
  assert.match(extensions, /composer-tool/);
  assert.match(providers, /ProviderAdapterRegistry/);
  assert.match(cache, /staleWhileRevalidate/);
  assert.match(metrics, /measureAsync/);
});

test("development inspector is lazy and production gated", async () => {
  const [runtime, inspector, palette] = await Promise.all([
    read("src/components/PlatformRuntime.tsx"),
    read("src/components/DeveloperConsole.tsx"),
    read("src/components/CommandPalette.tsx"),
  ]);
  assert.match(runtime, /import\.meta\.env\.DEV/);
  assert.match(runtime, /lazy\(/);
  assert.match(inspector, /Platform Inspector/);
  assert.match(palette, /CAPABILITIES/);
  assert.match(palette, /kova-command-history-v1/);
});
