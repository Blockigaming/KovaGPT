import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routes = {
  projects: await readFile("src/routes/projects.tsx", "utf8"),
  library: await readFile("src/routes/library.tsx", "utf8"),
  apps: await readFile("src/routes/apps.tsx", "utf8"),
  images: await readFile("src/routes/images.tsx", "utf8"),
};

test("workspace discovery routes expose one deliberate main landmark contract", () => {
  for (const [name, source] of Object.entries(routes)) {
    assert.match(source, /<main[\s\S]{0,220}id="main-content"/, name);
    assert.match(source, /tabIndex=\{-1\}/, name);
    assert.match(source, /aria-labelledby="(?:projects|library|apps|images)-title"/, name);
  }
});

test("apps and plugins use one name and one truthful signed-out action", () => {
  assert.match(routes.apps, /title="Apps & plugins"/);
  assert.match(routes.apps, /\{!isLoaded \? \([\s\S]*: !isSignedIn \? \(/);
  assert.match(routes.apps, /Sign in to connect services/);
  assert.doesNotMatch(routes.apps, /FILTER_CATEGORIES|setCategory|You haven't connected any apps/);
  assert.match(routes.apps, /GitHub connection status is unavailable/);
  assert.match(routes.apps, /min-h-11/);
});

test("Library reserves controls for real content and presents honest empty states", () => {
  assert.match(routes.library, /items\.length > 0 && !loadError \? \(/);
  assert.match(routes.library, /Nothing saved in this browser/);
  assert.match(routes.library, /Saved in this browser/);
  assert.match(routes.library, /role="group"\s+aria-label="Library filters"/);
  assert.match(routes.library, /aria-pressed=\{filter === item\.id\}/);
  assert.doesNotMatch(routes.library, /Storage totals require backend usage records/);
  assert.doesNotMatch(routes.library, />\s*\{loadError\}\s*</);
});

test("Images gives every repeated control a single contextual accessible name", () => {
  assert.match(routes.images, /aria-label=\{`Use \$\{p\.label\} style`\}/);
  assert.match(routes.images, /src=\{p\.image\}[\s\S]{0,80}alt=""/);
  assert.match(routes.images, /aria-label=\{`Open image: \$\{h\.prompt\}`\}/);
  assert.match(routes.images, /src=\{h\.imageUrl\}[\s\S]{0,80}alt=""/);
  assert.match(routes.images, /aria-label=\{`Download image: \$\{h\.prompt\}`\}/);
  assert.match(routes.images, /aria-label=\{`Remove image: \$\{h\.prompt\}`\}/);
  assert.match(routes.images, /Image history/);
  assert.match(routes.images, /!isSignedIn \? \([\s\S]*Sign in to generate images/);
  assert.doesNotMatch(routes.images, />\s*\{error\}\s*</);
});

test("Projects exposes contextual repeated controls and state semantics", () => {
  assert.match(routes.projects, /aria-label=\{`Options for \$\{p\.name\}`\}/);
  assert.match(routes.projects, /aria-pressed=\{view === "grid"\}/);
  assert.match(routes.projects, /aria-pressed=\{view === "list"\}/);
  assert.match(routes.projects, /aria-expanded=\{showArchived\}/);
  assert.match(routes.projects, />\s*Clear search\s*</);
});
