import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
const exists = (path) => existsSync(join(root, path));

test("Kova keeps its core application and customer account flows", () => {
  for (const path of [
    "src/routes/index.tsx",
    "src/routes/projects.tsx",
    "src/routes/library.tsx",
    "src/routes/images.tsx",
    "src/routes/work.tsx",
    "src/routes/study.tsx",
    "src/routes/writing.index.tsx",
    "src/routes/apps.tsx",
    "src/routes/scheduled-tasks.tsx",
    "src/routes/memory.tsx",
    "src/routes/settings.$section.tsx",
    "src/routes/pricing.tsx",
    "src/routes/subscribe.tsx",
    "src/routes/checkout.return.tsx",
    "src/routes/login.tsx",
    "src/routes/signup.tsx",
    "src/routes/privacy.tsx",
    "src/routes/terms.tsx",
    "src/routes/help.tsx",
  ])
    assert.ok(exists(path), path);
});
test("Kova no longer registers Maps, marketing, or developer service routes", () => {
  for (const path of [
    "src/routes/maps.tsx",
    "src/routes/api/maps/search.ts",
    "src/components/KovaMaps.tsx",
    "src/components/MapWidget.tsx",
    "src/routes/$slug.tsx",
    "src/routes/academy.tsx",
    "src/routes/developers.index.tsx",
    "src/routes/developers.console.tsx",
    "src/routes/developers.$docSlug.tsx",
    "src/routes/api/v1/responses.ts",
    "src/routes/api/developer/console.ts",
    "src/routes/api/internal/developer-billing.ts",
    "src/components/DeveloperConsole.tsx",
    "src/lib/pricing/developer-billing.server.ts",
    "sdk/javascript/index.mjs",
  ])
    assert.equal(exists(path), false, path);
  const sidebar = readFileSync(join(root, "src/lib/sidebar-layout.mjs"), "utf8");
  assert.doesNotMatch(sidebar, /id: "maps"|to: "\/maps"/);
});
