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
    "authFetch",
    "principalGenerationRef",
  ])
    assert.match(source, new RegExp(contract.replaceAll(".", "\\.")));
  assert.match(source, /searchControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /setLayoutProperty\("kova-3d-buildings", "visibility"/);
  assert.match(source, /if \(enabled && !map\.getSource\("terrain"\)\)/);
  assert.match(source, /disabled=\{!networkAllowed\}/);
  assert.match(source, /setInterval\(\(\) => void verifyNetworkAccess\(\), 15_000\)/);
  assert.match(source, /addEventListener\("visibilitychange", recheckVisiblePolicy\)/);
  assert.match(source, /removeEventListener\("visibilitychange", recheckVisiblePolicy\)/);
  assert.match(source, /AbortSignal\.any\(\[controller\.signal, AbortSignal\.timeout\(8_000\)\]\)/);
  assert.match(source, /blockNetwork[\s\S]*?searchControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /blockNetwork[\s\S]*?networkAllowedRef\.current = false/);
  assert.match(source, /disposed \|\|[\s\S]*?generation !== principalGenerationRef\.current/);
  assert.match(source, /mapRef\.current !== map/);
  assert.match(source, /if \(loadTimeout !== null\) window\.clearTimeout\(loadTimeout\)/);
  assert.match(
    source,
    /authFetch\(\`\/api\/maps\/search[\s\S]*?AbortSignal\.any\(\[controller\.signal, AbortSignal\.timeout\(8_000\)\]\)/,
  );
  assert.match(source, /Map context \(untrusted provider data;/);
  assert.doesNotMatch(source, /selectedLocation: selected[\s\S]{0,160}\b(?:name|type):/);
  assert.doesNotMatch(source, /VITE_|API_KEY|accessToken|token=/);
});

test("Maps search is server-side, bounded, provider-resolved, and fails safely", () => {
  const route = read("src/routes/api/maps/search.ts");
  assert.match(route, /nominatim\.openstreetmap\.org\/search/);
  assert.match(route, /query\.length < 2 \|\| query\.length > 160/);
  assert.match(route, /const latitude = finiteCoordinate\(value\.lat\)/);
  assert.match(route, /latitude === null/);
  assert.match(route, /Place search is temporarily unavailable/);
  assert.match(route, /status < 400 \? "private, max-age=60" : "no-store"/);
  assert.match(route, /resolveAnonymousClientKey\(request\.headers\)/);
  assert.match(route, /admit_maps_provider_request/);
  assert.match(route, /assertLockdownAllows\(auth\.supabaseAdmin, auth\.userId, "live_web"\)/);
  assert.match(read("src/components/KovaMaps.tsx"), /authFetch\("\/api\/security\/lockdown"/);
  assert.match(read("src/components/KovaMaps.tsx"), /authFetch\(`\/api\/maps\/search/);
  assert.match(route, /maps_geocoder_cache/);
  assert.match(route, /CACHE_TTL_MS = 24 \* 60 \* 60 \* 1_000/);
  assert.match(route, /MAX_PROVIDER_RESPONSE_BYTES = 256 \* 1024/);
  assert.match(route, /readBoundedUtf8\([\s\S]*?MAX_PROVIDER_RESPONSE_BYTES/);
  assert.match(route, /AbortSignal\.any\(\[request\.signal, AbortSignal\.timeout\(8_000\)\]\)/);
  assert.doesNotMatch(route, /process\.env|API_KEY|secret/i);
});

test("Maps cache hits skip rolling admission while misses and denials stay guarded", () => {
  const route = read("src/routes/api/maps/search.ts");
  const ordered = [
    "query.length < 2 || query.length > 160",
    "requireUser(request)",
    'request.headers.get("x-kova-expected-user")',
    'assertLockdownAllows(auth.supabaseAdmin, auth.userId, "live_web")',
    "const clientLimit = await consumeApplicationRateLimit",
    '.from("maps_geocoder_cache" as never)',
    "if (cachedPayload) return json(cachedPayload)",
    '"admit_maps_provider_request" as never',
    "fetch(providerUrl",
    "sanitizeProviderPlace(place)",
    ".upsert(",
  ];
  let cursor = -1;
  for (const marker of ordered) {
    const next = route.indexOf(marker);
    assert.ok(next > cursor, `${marker} must follow the prior Maps boundary`);
    cursor = next;
  }
  assert.match(
    route,
    /if \(!\(providerRow as \{ allowed: boolean \}\)\.allowed\)[\s\S]*?status: 429/,
  );
  assert.match(route, /const language = .*\.slice\(0, 128\)/);
  assert.match(route, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(route, /return `v1:\$\{hex\}`/);
  assert.doesNotMatch(route, /const cacheKey = JSON\.stringify/);
});

test("Maps validates cached payloads and treats cache read and write failures as soft", () => {
  const route = read("src/routes/api/maps/search.ts");
  assert.match(route, /cachedMapsPayload\(cached\)/);
  assert.match(route, /row\.payload\.results\.every\(isCachedPlace\)/);
  assert.match(
    route,
    /catch \{\s*console\.error\("\[maps\] could not read geocoder cache"\);\s*\}/,
  );
  assert.match(
    route,
    /catch \{\s*console\.error\("\[maps\] could not cache geocoder response"\);\s*\}\s*return json\(payload\)/,
  );
});

test("Maps provider admission and chat handoffs use rolling byte bounds", () => {
  const contextPacks = read("src/routes/context-packs.tsx");
  const migration = read("supabase/migrations/20260915012500_maps_provider_throttle.sql");
  const cacheMigration = read("supabase/migrations/20260915120000_maps_geocoder_cache.sql");
  assert.match(contextPacks, /MAX_SEARCH_HANDOFF_BYTES = 30 \* 1024/);
  assert.match(contextPacks, /TextEncoder/);
  assert.match(contextPacks, /tool: "web_search"/);
  assert.match(read("src/routes/index.tsx"), /setSelectedTool\("web_search"\)/);
  assert.match(migration, /provider text primary key/);
  assert.match(migration, /interval '1 second'/);
  assert.match(migration, /next_request_at <= v_now/);
  assert.doesNotMatch(
    migration,
    /claim_maps_geocoder_provider_slot|release_maps_geocoder_provider_slot/,
  );
  assert.match(cacheMigration, /create table if not exists public\.maps_geocoder_cache/);
  assert.match(cacheMigration, /cache_key ~ '\^v1:\[0-9a-f\]\{64\}\$'/);
  assert.match(cacheMigration, /expires_at timestamptz not null/);
  assert.match(
    cacheMigration,
    /revoke all on table public\.maps_geocoder_cache from public, anon, authenticated/,
  );
  assert.match(
    cacheMigration,
    /grant select, insert, update, delete on table public\.maps_geocoder_cache to service_role/,
  );
  assert.match(cacheMigration, /after insert on public\.maps_geocoder_cache/);
  assert.match(cacheMigration, /where expires_at <= statement_timestamp\(\)/);
  assert.match(cacheMigration, /order by expires_at\s+limit 250/);
  assert.doesNotMatch(cacheMigration, /provider_state|claim_maps|release_maps/);
  const retirement = read(
    "supabase/migrations/20260915011500_retire_deep_research_workspace_search.sql",
  );
  assert.match(retirement, /set status = 'canceled'/);
  assert.match(retirement, /completed_at = coalesce\(completed_at, now\(\)\)/);
  assert.match(retirement, /'writing_report', 'running'/);
});

test("Maps waits for the authenticated account policy before loading remote tiles", () => {
  const source = read("src/components/KovaMaps.tsx");
  assert.match(source, /networkAccess\?\.ownerId === user\?\.id/);
  assert.match(
    source,
    /if \(!networkAllowed \|\| !containerRef\.current \|\| mapRef\.current\) return/,
  );
  assert.ok(source.indexOf("if (!networkAllowed") < source.indexOf('import("maplibre-gl")'));
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
