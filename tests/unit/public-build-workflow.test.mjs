import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(".github/workflows/final-release-ci.yml", "utf8");

test("the only final CI path validates an exact deployed SHA and never deploys", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/mu);
  assert.match(workflow, /release_sha/u);
  assert.match(workflow, /git rev-parse HEAD/u);
  assert.match(workflow, /npm run release:day16:source/u);
  assert.match(workflow, /npm run release:production:verify/u);
  assert.match(workflow, /test:e2e:release:signed-out/u);
  assert.match(workflow, /test:e2e:release:signed-in/u);
  assert.doesNotMatch(workflow, /az containerapp|wrangler deploy|git push/iu);
});
