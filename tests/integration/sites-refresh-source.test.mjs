import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/SitesPage.tsx", "utf8");

test("a new Sites refresh clears a stale request error", () => {
  const refresh = source.slice(source.indexOf("const refresh = useCallback"));
  assert.ok(refresh.indexOf("setError(null)") < refresh.indexOf("await siteRequest"));
});
