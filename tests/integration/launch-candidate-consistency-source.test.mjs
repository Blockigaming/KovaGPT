import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("major workspaces share one accessible page header contract", async () => {
  const component = await read("src/components/WorkspacePageHeader.tsx");
  assert.match(component, /kova-page-header/);
  assert.match(component, /kova-page-title/);
  assert.match(component, /kova-page-description/);
  assert.match(component, /aria-labelledby/);
  for (const route of [
    "research-planner",
    "memory",
    "prompt-studio",
    "files",
    "apps",
    "notifications",
    "projects",
    "library",
  ]) {
    const source = await read(`src/routes/${route}.tsx`);
    assert.match(source, /WorkspacePageHeader/, `${route} should use the shared page header`);
  }
});

test("toast presentation uses one mobile-safe launch candidate configuration", async () => {
  const source = await read("src/components/ui/sonner.tsx");
  assert.match(source, /position="bottom-right"/);
  assert.match(source, /closeButton/);
  assert.match(source, /safe-area-inset-bottom/);
  assert.match(source, /visibleToasts=\{4\}/);
});

test("route error references stay stable without logging private errors in render", async () => {
  const source = await read("src/routes/__root.tsx");
  assert.match(source, /useState\(\(\) => `kova-\$\{crypto\.randomUUID\(\)\}`\)/);
  assert.doesNotMatch(source, /console\.error\("\[KovaRouteError\]"/);
});
