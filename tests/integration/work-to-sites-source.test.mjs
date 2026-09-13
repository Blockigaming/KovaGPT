import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");
const provider = read("work-runner/provider.mjs");
const api = read("src/routes/api/sites.ts");
const page = read("src/components/SitesPage.tsx");
const bridge = read("src/lib/work-sites-output.mjs");

test("Work emits a bounded Site artifact without claiming publication", () => {
  assert.match(provider, /kind=site with title and files:\[\{path,content\}\]/u);
  assert.match(provider, /only an importable unpublished artifact/u);
  assert.match(provider, /compileWorkSiteBundle\(result\)/u);
  assert.match(bridge, /WORK_SITE_BUNDLE_SCHEMA = "kova-work-site-v1"/u);
  assert.match(bridge, /WORK_SITE_LIMITS/u);
  assert.match(bridge, /work_site_index_required/u);
  assert.match(bridge, /work_site_duplicate_file/u);
});

test("Sites imports only verified owner-bound Work bytes into an unpublished version", () => {
  assert.match(api, /loadVerifiedWorkSiteOutput/u);
  assert.match(api, /\.from\("work_execution_outputs" as never\)/u);
  assert.match(api, /\.eq\("owner_id", ownerId\)/u);
  assert.match(api, /action = "saveVersion"/u);
  assert.doesNotMatch(api, /workOutputId[\s\S]{0,180}action = "publish"/u);
  assert.match(page, /workOutputId: workId/u);
  assert.match(page, /Import creates an unpublished version/u);
  assert.match(page, /Publishing still requires a separate\s+confirmation/u);
});
