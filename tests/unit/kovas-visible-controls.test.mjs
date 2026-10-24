import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as policy from "../../src/lib/custom-kovas-policy.mjs";
import * as storageEvents from "../../src/lib/principal-browser-storage.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const OWNER = "123e4567-e89b-42d3-a456-426614174000";
const ID = "223e4567-e89b-42d3-a456-426614174000";
const VERSION = "323e4567-e89b-42d3-a456-426614174000";
const label = (node) => text(node).replace(/\s+/g, " ").trim();
const button = (tree, name) =>
  elements(tree, (node) => node.type === "button" && label(node) === name)[0];
const search = (tree) => elements(tree, (node) => node.type === "input")[0];
const detail = (changes = {}) => ({
  id: ID,
  owned: false,
  revision: 1,
  visibility: "public",
  blocked: false,
  versionId: VERSION,
  publicationVersion: VERSION,
  config: policy.normalizeKovaConfig({
    name: "Writing Kova",
    description: "Clear writing",
    instructions: "Explain clearly.",
    starters: ["Improve this paragraph"],
    allowFork: true,
  }),
  knowledge: [],
  ...changes,
});

// Execute the actual route's workspace with isolated hooks and read responses.
// These are rendered-prop/source contracts, not native geometry measurements.
function fixture({ ownerId = OWNER, initialId } = {}) {
  const hooks = createHookHarness();
  const requests = [];
  const chats = [];
  const pending = [];
  const drafts = [];
  const navigations = [];
  const module = loadUiModule(
    "src/routes/kovas.tsx",
    {
      react: {
        ...hooks.react,
        lazy: () => "Preview",
        Suspense: "Suspense",
        useEffectEvent: (callback) => callback,
      },
      "@tanstack/react-router": {
        createFileRoute: () => (options) => ({
          ...options,
          useSearch: () => ({ id: initialId }),
        }),
        Link: "Link",
        useNavigate: () => async (destination) => navigations.push(destination),
      },
      "@/components/auth/ClerkSafe": {
        useUser: () => ({ isLoaded: true, user: ownerId ? { id: ownerId } : null }),
        SignInButton: "SignInButton",
      },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/lib/custom-kovas-policy.mjs": policy,
      "@/lib/custom-kovas-client": {
        requestKovas: (account, path, signal, body) => {
          const response = deferred();
          requests.push({ account, path, signal, body, ...response });
          return response.promise;
        },
        newKovaLinkToken: () => {
          throw Error("Unexpected link mutation");
        },
      },
      "@/lib/chat-store": {
        loadConversations: () => [],
        saveConversations: async (...args) => {
          chats.push(args);
          return true;
        },
        savePendingActive: (...args) => pending.push(args),
        saveDraft: (...args) => drafts.push(args),
      },
      "@/lib/principal-browser-storage.mjs": storageEvents,
    },
    {
      window: new EventTarget(),
      location: new URL(`https://kovagpt.com/kovas${initialId ? `?id=${initialId}` : ""}`),
      AbortController,
      URLSearchParams,
      crypto,
    },
  );
  const workspace = module.Route.component().props.children;
  return {
    requests,
    chats,
    pending,
    drafts,
    navigations,
    render: () => hooks.render(workspace.type, workspace.props),
    unmount: hooks.unmount,
  };
}

function target(node, input = false) {
  assert.ok(node, "The intended control is rendered");
  const tokens = node.props.className.split(/\s+/);
  for (const token of [
    "min-h-11",
    "min-w-11",
    `rounded-[var(--kova-radius-${input ? "input" : "compact"})]`,
    "px-3",
    "py-2",
  ])
    assert.ok(tokens.includes(token), `${label(node) || "Search"}: ${token}`);
  assert.equal(tokens.includes("h-11"), false, "Long labels can grow above the minimum height");
}

async function openDetail(t, view = detail()) {
  const h = fixture({ initialId: ID });
  t.after(h.unmount);
  h.render();
  assert.deepEqual(
    h.requests.map(({ path }) => path),
    ["/api/kovas?scope=owned", `/api/kovas?scope=read&id=${ID}`],
  );
  h.requests[0].resolve({ rows: [] });
  h.requests[1].resolve(view);
  await settle();
  if (view.owned) {
    assert.equal(h.requests[2].path, `/api/kovas?scope=versions&id=${ID}`);
    h.requests[2].resolve({ rows: [] });
    await settle();
  }
  return h;
}

test("Kovas header, scope buttons and labelled search use 44px minimums and semantic tokens", (t) => {
  for (const ownerId of [OWNER, null]) {
    const h = fixture({ ownerId });
    t.after(h.unmount);
    const tree = h.render();
    target(button(tree, ownerId ? "Create a Kova" : "Sign in to create or chat"));
    target(button(tree, "My Kovas"));
    target(button(tree, "Community directory"));
    target(search(tree), true);
    assert.equal(button(tree, "My Kovas").props.disabled, !ownerId);
    assert.equal(button(tree, "Community directory").props.disabled, false);
    const searchLabel = elements(tree, (node) => node.type === "label")[0];
    assert.equal(label(searchLabel), "Search loaded Kovas");
    assert.ok(elements(searchLabel).includes(search(tree)), "Search keeps its native label");
    assert.ok(searchLabel.props.className.includes("flex-wrap items-center gap-2"));
    assert.ok(searchLabel.props.className.includes("max-w-full"));
    assert.ok(search(tree).props.className.includes("max-w-full"));
    const header = elements(tree, (node) => node.type === "header")[0];
    assert.equal(header.props.className, "flex flex-wrap items-center gap-2");
    const scopes = elements(
      tree,
      (node) => node.type === "div" && node.props.children?.includes?.(button(tree, "My Kovas")),
    )[0];
    assert.equal(scopes.props.className, "flex flex-wrap items-center gap-2");
    const moderation = elements(tree, (node) => node.type === "Link")[0];
    assert.equal(moderation.props.to, "/admin/kovas");
    assert.equal(moderation.props.className, "underline", "Prose links retain their text styling");
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0].body, undefined);
    if (!ownerId) {
      assert.equal(h.requests[0].account, null);
      assert.equal(h.requests[0].path, "/api/kovas/directory");
      assert.equal(elements(tree, (node) => node.type === "SignInButton")[0].props.mode, "modal");
    }
  }
  const css = readFileSync("src/styles/visual-tokens.css", "utf8");
  assert.match(css, /:root\s*\{[^}]*--kova-radius-compact:\s*10px;/);
  assert.match(css, /:root\s*\{[^}]*--kova-radius-input:\s*14px;/);
});

for (const owned of [false, true]) {
  test(`read-only ${owned ? "owned" : "community"} detail retains actions with full-size targets`, async (t) => {
    const h = await openDetail(t, detail({ owned }));
    const tree = h.render();
    const section = elements(tree, (node) => node.type === "section")[0];
    assert.equal(section.props.className, "space-y-3 rounded-xl border p-4");
    const actions = elements(section, (node) => node.type === "div")[0];
    assert.equal(actions.props.className, "flex flex-wrap gap-2");
    const names = ["Start a chat", "Improve this paragraph", "Create a private copy", "Report"];
    if (owned) names.push("Edit Kova");
    for (const name of names) {
      const action = button(section, name);
      target(action);
      assert.equal(action.props.disabled, false);
      assert.equal(typeof action.props.onClick, "function");
    }
    assert.equal(Boolean(button(section, "Edit Kova")), owned);
    assert.doesNotMatch(label(tree), /Edit saved Kova|Create private Kova/);
    assert.ok(
      h.requests.every(({ body }) => body === undefined),
      "Opening detail only reads",
    );
    assert.equal(h.chats.length, 0);
    assert.equal(h.navigations.length, 0);
  });
}

test("scope and loaded search keep their read-only filtering and detail selection behavior", async (t) => {
  const h = fixture();
  t.after(h.unmount);
  h.render();
  h.requests[0].resolve({ rows: [detail()] });
  await settle();
  let tree = h.render();
  search(tree).props.onChange({ target: { value: "  no match  " } });
  tree = h.render();
  assert.equal(elements(tree, (node) => node.type === "strong").length, 0);
  assert.equal(h.requests.length, 1, "Loaded search makes no new request");
  search(tree).props.onChange({ target: { value: "Clear writing" } });
  button(tree, "Community directory").props.onClick();
  h.render();
  assert.equal(h.requests[1].path, "/api/kovas/directory");
  assert.equal(h.requests[1].account, null);
  h.requests[1].resolve({ rows: [detail()] });
  await settle();
  tree = h.render();
  assert.equal(search(tree).props.value, "Clear writing");
  const card = elements(
    tree,
    (node) => node.type === "button" && /Writing Kova/.test(label(node)),
  )[0];
  assert.equal(card.props.className, "rounded-xl border p-4 text-left");
  card.props.onClick();
  tree = h.render();
  for (const name of ["Create a Kova", "My Kovas", "Community directory"])
    assert.equal(button(tree, name).props.disabled, true);
  assert.equal(h.requests[2].path, `/api/kovas?scope=read&id=${ID}`);
  h.requests[2].resolve(detail());
  await settle();
  tree = h.render();
  assert.equal(search(tree).props.value, "Clear writing");
  assert.equal(button(tree, "Start a chat").props.disabled, false);
  assert.ok(h.requests.every(({ body }) => body === undefined));
});

test("moderation, fork permission and publication still control detail action availability", async (t) => {
  for (const [view, blocked, copyDisabled, reportVisible] of [
    [detail({ blocked: true }), true, true, true],
    [detail({ config: { ...detail().config, allowFork: false } }), false, true, true],
    [detail({ publicationVersion: null }), false, false, false],
  ]) {
    const h = await openDetail(t, view);
    const tree = h.render();
    assert.equal(button(tree, "Start a chat").props.disabled, blocked);
    assert.equal(button(tree, "Improve this paragraph").props.disabled, blocked);
    assert.equal(button(tree, "Create a private copy").props.disabled, copyDisabled);
    assert.equal(Boolean(button(tree, "Report")), reportVisible);
    if (reportVisible) assert.equal(button(tree, "Report").props.disabled, false);
    assert.ok(h.requests.every(({ body }) => body === undefined));
  }
});

test("unavailable and canceled detail reads do not start chats, navigate or mutate", async (t) => {
  const h = fixture({ initialId: ID });
  t.after(h.unmount);
  h.render();
  h.requests[0].resolve({ rows: [] });
  h.requests[1].reject(Error("This Kova is unavailable."));
  await settle();
  const tree = h.render();
  assert.match(label(elements(tree, (node) => node.props.role === "alert")[0]), /unavailable/);
  assert.equal(button(tree, "Start a chat"), undefined);
  assert.equal(button(tree, "Create a Kova").props.disabled, false);
  assert.equal(h.chats.length, 0);
  assert.equal(h.navigations.length, 0);

  const canceled = fixture({ initialId: ID });
  canceled.render();
  canceled.unmount();
  assert.ok(canceled.requests.every(({ signal }) => signal.aborted));
  canceled.requests[1].resolve(detail());
  await settle();
  assert.equal(button(canceled.render(), "Start a chat"), undefined);
  assert.ok(canceled.requests.every(({ body }) => body === undefined));
});

test("explicit chat and starter actions retain the version reference, optional draft and home route", async (t) => {
  for (const name of ["Start a chat", "Improve this paragraph"]) {
    const h = await openDetail(t);
    const before = h.requests.length;
    button(h.render(), name).props.onClick();
    await settle();
    assert.equal(h.chats.length, 1);
    const [account, rows] = h.chats[0];
    assert.equal(account, OWNER);
    assert.equal(rows[0].kova.id, ID);
    assert.equal(rows[0].kova.versionId, VERSION);
    assert.deepEqual(h.pending, [[OWNER, rows[0].id]]);
    assert.deepEqual(h.drafts, name === "Start a chat" ? [] : [[OWNER, rows[0].id, name]]);
    assert.equal(h.navigations.length, 1);
    assert.equal(h.navigations[0].to, "/");
    assert.equal(h.requests.length, before, "Starting chat does not mutate the Kova");
  }
});
