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
  assert.match(source, /const \{ isDesktop \} = useLayout\(\)/);
  assert.match(source, /position=\{isDesktop \? "bottom-right" : "top-center"\}/);
  assert.match(source, /closeButton/);
  assert.match(
    source,
    /mobileOffset=\{\{\s*top: "calc\(64px \+ env\(safe-area-inset-top\) \+ var\(--kova-visible-top, 0px\)\)",\s*left: "max\(16px, env\(safe-area-inset-left\)\)"/,
  );
  assert.match(source, /visibleToasts=\{4\}/);
});

test("route error references stay stable without logging private errors in render", async () => {
  const source = await read("src/routes/__root.tsx");
  assert.doesNotMatch(source, /randomUUID|correlationId/);
  assert.doesNotMatch(source, /console\.error\("\[KovaRouteError\]"/);
});
