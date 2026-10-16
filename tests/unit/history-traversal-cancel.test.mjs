import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { controlledHistory } from "../helpers/controlled-browser-history.mjs";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
const source = process.env.KOVA_HISTORY_TEST_SOURCE ?? "src/vendor/tanstack-history/index.ts";
for (const delta of [-2, -1, 1, 2])
  for (const rejected of [true, false]) {
    test(`${rejected ? "canceled" : "accepted"} traversal ${delta} preserves browser/router agreement`, async () => {
      const paths = ["/chat", "/work", "/library", "/discover", "/settings"];
      const f = controlledHistory(source, paths, 2);
      let decisions = 0;
      f.history.block({
        blockerFn: async () => {
          decisions++;
          return rejected;
        },
        enableBeforeUnload: true,
      });
      try {
        if (delta === -1) f.window.history.back();
        else if (delta === 1) f.window.history.forward();
        else f.window.history.go(delta);
        await f.settle();
        const expected = paths[2 + (rejected ? 0 : delta)];
        assert.equal(f.window.location.pathname, expected);
        assert.equal(f.history.location.pathname, expected);
        assert.equal(decisions, 1);
        assert.deepEqual(f.traversals, rejected ? [delta, -delta] : [delta]);
      } finally {
        f.history.destroy();
      }
    });
  }
test("vendored history is exactly the pinned upstream source with its inverse-delta correction", () => {
  const upstream = readFileSync("node_modules/@tanstack/history/src/index.ts", "utf8");
  const installed = JSON.parse(readFileSync("node_modules/@tanstack/history/package.json", "utf8"));
  const provenance = JSON.parse(
    readFileSync("src/vendor/tanstack-history/provenance.json", "utf8"),
  );
  assert.equal(installed.name, provenance.package);
  assert.equal(installed.version, provenance.version);
  assert.equal((upstream.match(/win\.history\.go\(-delta\)/g) ?? []).length, 1);
  assert.doesNotMatch(upstream, /win\.history\.go\(1\)/);
  assert.equal(
    createHash("sha256").update(upstream).digest("hex"),
    provenance.installedSourceSha256,
  );
  assert.equal(readFileSync("src/vendor/tanstack-history/index.ts", "utf8"), upstream);
  assert.match(
    readFileSync("src/router.tsx", "utf8"),
    /history: typeof window === "undefined" \? undefined : createBrowserHistory\(\)/,
  );
});

test("the pinned history exposes current blockers and consumes one ignored traversal", async () => {
  const f = controlledHistory(source, ["/chat", "/library", "/settings"], 1);
  let decisions = 0;
  const blocker = {
    blockerFn: () => {
      decisions++;
      return true;
    },
    enableBeforeUnload: true,
  };
  const remove = f.history.block(blocker);
  try {
    assert.equal(f.history._getBlockers().length, 1);
    assert.equal(f.history._getBlockers()[0], blocker);
    f.history.go(1, { ignoreBlocker: true });
    await f.settle();
    assert.equal(decisions, 0);
    assert.equal(f.window.location.pathname, "/settings");
    f.history.back();
    await f.settle();
    assert.equal(decisions, 1);
    assert.equal(f.window.location.pathname, "/settings");
    assert.deepEqual(f.traversals, [1, -1, 1]);
    const departure = new Event("beforeunload", { cancelable: true });
    f.window.dispatchEvent(departure);
    assert.equal(departure.defaultPrevented, true);
    remove();
    assert.equal(f.history._getBlockers().length, 0);
  } finally {
    f.history.destroy();
  }
});

test("pinned upstream URL normalization retains same-origin browser paths", () => {
  const { parseHref } = loadUiModule(source, {});
  for (const value of [
    "//foreign.invalid/path",
    "/\\foreign.invalid/path",
    " \t//foreign.invalid/path",
  ]) {
    const parsed = parseHref(value);
    assert.equal(new URL(parsed.href, "https://local.test").origin, "https://local.test");
    assert.equal(parsed.pathname, "/foreign.invalid/path");
  }
  assert.equal(parseHref("/safe\u0000path\n?query=1#anchor").href, "/safe%00path?query=1#anchor");
});

test("queued browser writes flush through the browser microtask boundary", async () => {
  const f = controlledHistory(source, ["/chat"], 0);
  try {
    f.history.push("/library");
    f.history.replace("/settings");
    assert.equal(f.history.location.pathname, "/settings");
    await f.settle();
    assert.equal(f.window.location.pathname, "/settings");
    assert.equal(f.window.history.length, 2);
  } finally {
    f.history.destroy();
  }
});
