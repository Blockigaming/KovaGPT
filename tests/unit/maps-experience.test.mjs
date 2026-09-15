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
  assert.doesNotMatch(route, /process\.env|API_KEY|secret/i);
});

test("dedicated research product surfaces and route are absent", () => {
  const sidebar = read("src/components/Sidebar.tsx");
  const composer = read("src/components/ChatInput.tsx");
  const palette = read("src/components/CommandPalette.tsx");
  const pricing = read("src/lib/capability-registry.ts");
  const retiredLabels = ["Deep" + " Research", "deep" + "_research", "deep" + "-research"];
  for (const source of [sidebar, composer, palette, pricing]) {
    for (const label of retiredLabels) assert.equal(source.includes(label), false);
  }
  assert.throws(() => read(`src/routes/${"research" + "-planner"}.tsx`), /ENOENT/);
});
