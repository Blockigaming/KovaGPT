import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("Maps uses real providers, map controls, terrain, buildings, and contextual Kova handoff", () => {
  const source = read("src/components/KovaMaps.tsx");
  for (const contract of [
    'placeholder="Ask Kova about Maps"',
    'data-testid="map-container"',
    "tiles.openfreemap.org",
    "server.arcgisonline.com",
    "elevation-tiles-prod",
    "kova-3d-buildings",
    "NavigationControl",
    "FullscreenControl",
    "fitBounds",
    "flyTo",
    "selectedLocation",
    "viewport",
    "writePrincipalHandoff",
  ])
    assert.match(source, new RegExp(contract.replaceAll(".", "\\.")));
  assert.doesNotMatch(source, /VITE_|API_KEY|accessToken|token=/);
});

test("Maps search is server-side, bounded, provider-resolved, and fails safely", () => {
  const route = read("src/routes/api/maps/search.ts");
  assert.match(route, /nominatim\.openstreetmap\.org\/search/);
  assert.match(route, /query\.length < 2 \|\| query\.length > 160/);
  assert.match(route, /Number\.isFinite\(latitude\)/);
  assert.match(route, /Place search is temporarily unavailable/);
  assert.match(route, /status < 400 \? "private, max-age=60" : "no-store"/);
  assert.doesNotMatch(route, /process\.env|API_KEY|secret/i);
  assert.match(route, /requireUser\(request\)/);
  assert.match(route, /enforceLockdownCapability/);
  assert.match(route, /resolveAnonymousClientKey\(request\.headers\)/);
  assert.match(route, /claim_maps_geocoder_provider_slot/);
  assert.match(route, /release_maps_geocoder_provider_slot/);
  assert.match(route, /maps_geocoder_cache/);
  assert.doesNotMatch(route, /x-forwarded-for|recentRequests/);
});

test("Maps waits for authenticated Lockdown policy before loading remote tiles", () => {
  const source = read("src/components/KovaMaps.tsx");
  assert.match(source, /fetch\("\/api\/security\/lockdown"/);
  assert.match(source, /providerAccess !== "allowed"/);
  assert.match(source, /Authorization: `Bearer \$\{data\.session\.access_token\}`/);
  assert.ok(
    source.indexOf('providerAccess !== "allowed"') < source.indexOf('import("maplibre-gl")'),
  );
});

test("Maps provider guard serializes cross-instance requests and keeps a shared cache", () => {
  const migration = read("supabase/migrations/20260915120000_maps_geocoder_provider_guard.sql");
  assert.match(migration, /maps_geocoder_provider_state/);
  assert.match(migration, /maps_geocoder_cache/);
  assert.match(migration, /interval '10 seconds'/);
  assert.match(migration, /release_maps_geocoder_provider_slot/);
  assert.match(migration, /interval '1 second'/);
  assert.match(migration, /grant execute.+service_role/);
  assert.match(migration, /revoke all.+anon, authenticated/);
});

test("dedicated research product surfaces and route are absent", () => {
  const sidebar = read("src/components/Sidebar.tsx");
  const composer = read("src/components/ChatInput.tsx");
  const palette = read("src/components/CommandPalette.tsx");
  const pricing = read("src/lib/capability-registry.ts");
  const packageManifest = read("package.json");
  const localFinalizer = read("scripts/release/finalize-local-candidate.sh");
  const retiredLabels = ["Deep" + " Research", "deep" + "_research", "deep" + "-research"];
  for (const source of [sidebar, composer, palette, pricing, packageManifest, localFinalizer]) {
    for (const label of retiredLabels) assert.equal(source.includes(label), false);
  }
  assert.throws(() => read(`src/routes/${"research" + "-planner"}.tsx`), /ENOENT/);
  assert.match(read("src/lib/chat-history-policy.mjs"), /RETIRED_COMPOSER_TOOL_IDS/);
});
