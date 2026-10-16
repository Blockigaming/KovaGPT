import assert from "node:assert/strict";
import test from "node:test";
import { createHookHarness, loadUiModule, deferred, settle } from "../helpers/ui-state-harness.mjs";
function fixture() {
  const hooks = createHookHarness(),
    calls = [],
    adopted = [];
  const { useCollectionPager } = loadUiModule(
    "src/lib/use-collection-pager.ts",
    { react: hooks.react },
    { AbortController, DOMException, Error },
  );
  const fetch = (options) => {
    const call = deferred();
    calls.push({ ...options, ...call });
    return call.promise;
  };
  const adopt = (items) => adopted.push(items);
  let scope = "actor",
    pager;
  const render = () => (pager = hooks.render(() => useCollectionPager(fetch, scope, adopt)));
  render();
  return {
    calls,
    adopted,
    render,
    get pager() {
      return pager;
    },
    scope(value) {
      scope = value;
      render();
    },
    unmount: hooks.unmount,
  };
}
test("paging is explicit, replaces content, prevents double dispatch and retains page on failure", async () => {
  const f = fixture(),
    initial = f.pager.read();
  f.calls[0].resolve({ items: [{ id: "a" }], cursor: "a" });
  await initial;
  f.render();
  assert.equal(f.calls.length, 1);
  f.pager.next();
  f.pager.next();
  assert.equal(f.calls.length, 2);
  f.calls[1].reject(Error("page offline"));
  await settle();
  f.render();
  assert.equal(f.adopted.length, 1);
  assert.match(f.pager.error, /offline/);
  assert.equal(f.pager.page, 1);
  f.pager.retry();
  assert.equal(f.calls[2].data.cursor, "a");
  f.calls[2].resolve({ items: [{ id: "b" }], cursor: null });
  await settle();
  f.render();
  assert.deepEqual(f.adopted.at(-1), [{ id: "b" }]);
  assert.equal(f.pager.page, 2);
  assert.equal(f.pager.hasNext, false);
  f.pager.previous();
  assert.equal(f.calls[3].data.cursor, null);
  f.calls[3].resolve({ items: [{ id: "a" }], cursor: "a" });
  await settle();
});
test("scope change, unmount and mutation invalidation fence even a transport ignoring abort", async () => {
  for (const transition of [
    (f) => f.scope("other"),
    (f) => f.unmount(),
    (f) => f.pager.invalidate(),
  ]) {
    const f = fixture(),
      read = f.pager.read();
    transition(f);
    assert.equal(f.calls[0].signal.aborted, true);
    f.calls[0].resolve({ items: [{ id: "private-old" }], cursor: null });
    await assert.rejects(read, { name: "AbortError" });
    assert.equal(f.adopted.length, 0);
  }
});

test("large collections remain reachable beyond 1000 actions while only one content page is retained", async () => {
  const hooks = createHookHarness();
  const { useCollectionPager } = loadUiModule(
    "src/lib/use-collection-pager.ts",
    { react: hooks.react },
    { AbortController, DOMException, Error },
  );
  let rows = [],
    calls = 0;
  const fetch = async ({ data }) => {
    calls++;
    const n = data.cursor === null ? 0 : Number(data.cursor) + 1;
    return {
      items: [{ id: String(n), body: "x".repeat(12000) }],
      cursor: n < 1100 ? String(n) : null,
    };
  };
  const adopt = (value) => {
    rows = value;
  };
  const render = () => hooks.render(() => useCollectionPager(fetch, "actor", adopt));
  let pager = render();
  await pager.read();
  pager = render();
  for (let action = 0; action < 1100; action++) {
    pager.next();
    await settle();
    pager = render();
    assert.equal(rows.length, 1);
  }
  assert.equal(calls, 1101);
  assert.equal(pager.page, 1101);
  assert.equal(rows[0].id, "1100");
  assert.equal(pager.hasNext, false);
  for (let back = 0; back < 99; back++) {
    pager.previous();
    await settle();
    pager = render();
  }
  assert.equal(pager.hasPrevious, false);
  assert.equal(pager.atHistoryLimit, true);
  assert.equal(pager.page, 1002);
});
