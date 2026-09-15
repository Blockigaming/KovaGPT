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
  assert.match(route, /resolveAnonymousClientKey\(request\.headers\)/);
  assert.match(route, /enforceLockdownCapability[\s\S]*"live_web"/);
  assert.match(route, /read_maps_search_cache/);
  assert.match(route, /claim_maps_provider_request/);
  assert.match(route, /store_maps_search_cache/);
  assert.doesNotMatch(route, /x-forwarded-for|recentRequests/);
  assert.doesNotMatch(route, /process\.env|API_KEY|secret/i);
});

test("Maps waits for auth and Lockdown policy before loading providers", () => {
  const source = read("src/components/KovaMaps.tsx");
  assert.match(source, /networkAllowed !== true/);
  assert.match(source, /authFetch\("\/api\/security\/lockdown", \{ signal \}\)/);
  assert.match(source, /authFetch\(`\/api\/maps\/search/);
  assert.match(source, /Maps is unavailable while Lockdown Mode is on/);
  assert.match(source, /id: "current-location"/);
  assert.match(source, /name: "Current location"/);
  assert.match(source, /setInterval\(\(\) => void checkPolicy\(\), 15_000\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /principalRef\.current !== requestPrincipal/);
  assert.match(source, /setSelected\(null\)/);
  assert.match(source, /setLayoutProperty\("kova-3d-buildings", "visibility"/);
  assert.match(source, /set3dResources\(map, false\)/);
});

test("context-pack search handoffs stay below chat ingress limits", () => {
  const source = read("src/routes/context-packs.tsx");
  assert.match(source, /MAX_SEARCH_HANDOFF_BYTES = 30 \* 1024/);
  assert.match(source, /TextEncoder/);
  assert.match(source, /\{ prompt: searchHandoffPrompt\(pack\), tool: "web_search" \}/);
  assert.match(source, /Additional context was omitted to fit the chat message limit/);
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
