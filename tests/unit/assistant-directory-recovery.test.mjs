import test from "node:test";
import assert from "node:assert/strict";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
  settle,
} from "../helpers/ui-state-harness.mjs";

const button = (tree, label) => elements(tree, (n) => n.type === "button" && text(n) === label)[0];
function harness() {
  const hooks = createHookHarness();
  const requests = [];
  const module = loadUiModule(
    "src/routes/assistants.tsx",
    {
      react: hooks.react,
      "@tanstack/react-router": {
        createFileRoute: () => (options) => options,
        Link: "Link",
        Outlet: "Outlet",
        useMatch: () => false,
      },
      "lucide-react": { Search: "Search" },
      "@/components/public/PublicSite": { PublicPageView: "PublicPageView" },
      "@/lib/custom-kovas-client": {
        requestKovas: (_account, url, signal) => {
          const result = deferred();
          requests.push({ url, signal, ...result });
          return result.promise;
        },
      },
    },
    { AbortController },
  );
  const Directory = module.Route.component().type;
  const render = () => hooks.render(Directory);
  return { requests, render, unmount: hooks.unmount };
}
const rows = (count, start = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `kova-${start + i}`,
    config: {
      name: `Example ${start + i}`,
      description: "Fixture only",
      icon: "K",
      mode: "instant",
    },
  }));
const cards = (tree) => elements(tree, (n) => n.type === "Link" && n.props.search?.id);

test("assistant directory distinguishes pending, failure, retry and verified empty results", async () => {
  const h = harness();
  let tree = h.render();
  assert.match(text(tree), /Loading Kovas/);
  assert.doesNotMatch(text(tree), /No assistants published|No matching assistants/);
  h.requests[0].reject(Error("Fixture failure"));
  await settle();
  tree = h.render();
  assert.match(text(tree), /directory is unavailable/);
  assert.doesNotMatch(text(tree), /No assistants published|Loading Kovas/);
  button(tree, "Retry directory").props.onClick();
  h.render();
  tree = h.render();
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].url, h.requests[0].url);
  assert.match(text(tree), /Loading Kovas/);
  assert.doesNotMatch(text(tree), /No assistants published|directory is unavailable/);
  h.requests[1].resolve({ rows: [] });
  await settle();
  tree = h.render();
  assert.match(text(tree), /No assistants published yet/);
  assert.doesNotMatch(text(tree), /Loading Kovas|directory is unavailable|Retry directory/);
  h.unmount();
});

test("failed assistant pagination retries the same read cursor and preserves existing cards", async () => {
  const h = harness();
  h.render();
  h.requests[0].resolve({ rows: rows(21) });
  await settle();
  let tree = h.render();
  assert.equal(cards(tree).length, 20);
  button(tree, "Load more Kovas").props.onClick();
  h.render();
  tree = h.render();
  assert.equal(button(tree, "Load more Kovas").props.disabled, true);
  assert.equal(h.requests[1].url, "/api/kovas/directory?after=kova-19");
  h.requests[1].reject(Error("Fixture pagination failure"));
  await settle();
  tree = h.render();
  assert.equal(cards(tree).length, 20);
  assert.match(text(tree), /directory is unavailable/);
  assert.doesNotMatch(text(tree), /No assistants published yet/);
  button(tree, "Load more Kovas").props.onClick();
  h.render();
  tree = h.render();
  assert.equal(h.requests.length, 3);
  assert.equal(h.requests[2].url, h.requests[1].url);
  assert.equal(cards(tree).length, 20);
  h.requests[2].resolve({ rows: rows(1, 20) });
  await settle();
  tree = h.render();
  assert.equal(cards(tree).length, 21);
  assert.doesNotMatch(text(tree), /directory is unavailable|Loading Kovas|Load more Kovas/);
  h.unmount();
});

test("assistant directory failure preserves search and does not count an aborted read as success", async () => {
  const h = harness();
  let tree = h.render();
  elements(tree, (n) => n.type === "input")[0].props.onChange({ target: { value: "example" } });
  h.render();
  h.requests[0].reject(Error("Fixture failure"));
  await settle();
  tree = h.render();
  assert.equal(elements(tree, (n) => n.type === "input")[0].props.value, "example");
  assert.doesNotMatch(text(tree), /No matching assistants/);
  button(tree, "Retry directory").props.onClick();
  h.render();
  assert.equal(h.requests[0].signal.aborted, true);
  h.unmount();
  assert.equal(h.requests[1].signal.aborted, true);
  h.requests[1].resolve({ rows: rows(1) });
  await settle();
  assert.equal(cards(h.render()).length, 0);
});

test("assistant retry and pagination move focus before replacing their controls", async () => {
  const h = harness();
  h.render();
  h.requests[0].reject(Error("fixture"));
  await settle();
  let tree = h.render();
  let focused = 0;
  elements(tree, (n) => n.props?.["aria-label"] === "Assistant directory")[0].props.ref.current = {
    focus: () => focused++,
  };
  button(tree, "Retry directory").props.onClick();
  assert.equal(focused, 1);
  h.render();
  h.requests[1].resolve({ rows: rows(21) });
  await settle();
  tree = h.render();
  button(tree, "Load more Kovas").props.onClick();
  assert.equal(focused, 2);
  h.unmount();
});
