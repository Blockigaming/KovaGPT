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
  const window = new EventTarget();
  window.confirm = () => assert.fail("Kova actions use the shared confirmation dialog");
  window.prompt = () => assert.fail("Reports use the shared input dialog");
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
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/dialog": Object.fromEntries(
        [
          "Dialog",
          "DialogContent",
          "DialogDescription",
          "DialogFooter",
          "DialogHeader",
          "DialogTitle",
        ].map((name) => [name, name]),
      ),
      "@/components/ui/select": Object.fromEntries(
        ["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((name) => [
          name,
          name,
        ]),
      ),
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
      window,
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
    clearStorage() {
      const event = new Event(storageEvents.PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT);
      event.detail = { principal: storageEvents.browserStoragePrincipal(ownerId) };
      window.dispatchEvent(event);
    },
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

async function openDetail(t, view = detail(), versions = []) {
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
    h.requests[2].resolve({ rows: versions });
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

const confirmation = (tree) => elements(tree, (node) => node.type === "ConfirmActionDialog")[0];
const reportDialog = (tree) => elements(tree, (node) => node.type === "Dialog")[0];
const reportInput = (tree) => elements(tree, (node) => node.props.id === "kova-report-reason")[0];
const reportForm = (tree) => elements(tree, (node) => node.type === "form")[0];
function opener() {
  const focuses = [];
  return { isConnected: true, focus: (options) => focuses.push(options), focuses };
}

test("Kova copy opens a cancelable shared review and consumes explicit confirmation once", async (t) => {
  const h = await openDetail(t);
  const trigger = opener();
  button(h.render(), "Create a private copy").props.onClick({ currentTarget: trigger });
  let review = confirmation(h.render());
  assert.equal(review.props.open, true);
  assert.equal(review.props.confirmLabel, "Create copy");
  assert.equal(h.requests.length, 2, "Opening review does not mutate");
  review.props.onOpenChange(false);
  review.props.onConfirm();
  assert.equal(h.requests.length, 2, "Canceled callbacks cannot mutate");
  review.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(trigger.focuses.length, 1);
  assert.equal(trigger.focuses[0].preventScroll, true);

  button(h.render(), "Create a private copy").props.onClick({ currentTarget: trigger });
  review = confirmation(h.render());
  review.props.onConfirm();
  review.props.onConfirm();
  assert.equal(h.requests.length, 3);
  const request = h.requests[2];
  assert.equal(request.account, OWNER);
  assert.equal(request.body.id, ID);
  assert.equal(request.body.action, "fork");
  assert.equal(request.body.payload.consent, VERSION);
  assert.equal(request.body.revision, 1);
});

test("Kova confirmations reject changed selection, draft and cleared principal scopes", async (t) => {
  for (const invalidate of ["selection", "draft", "storage"]) {
    const h = await openDetail(t, detail({ owned: true }));
    button(h.render(), "Delete Kova").props.onClick({ currentTarget: opener() });
    const review = confirmation(h.render());
    assert.equal(review.props.open, true);
    if (invalidate === "selection") button(h.render(), "Create a Kova").props.onClick();
    if (invalidate === "draft") {
      button(h.render(), "Edit Kova").props.onClick();
      const inputs = elements(h.render(), (node) => node.type === "input");
      inputs
        .find((node) => node.props.maxLength === 120)
        .props.onChange({ target: { value: "Changed draft" } });
    }
    if (invalidate === "storage") h.clearStorage();
    const current = h.render();
    (confirmation(current) ?? review).props.onConfirm();
    assert.ok(
      h.requests.every(({ body }) => body === undefined),
      invalidate,
    );
  }
});

test("Kova deletion and old-version actions preserve mutation targets behind review", async (t) => {
  const OLD = "423e4567-e89b-42d3-a456-426614174000";
  for (const [label, action, versionId] of [
    ["Delete Kova", "delete", undefined],
    ["Restore copy", "restore", OLD],
    ["Delete old version", "deleteVersion", OLD],
  ]) {
    const h = await openDetail(t, detail({ owned: true }), [
      { id: OLD, version: 2, created_at: "2026-10-01T00:00:00Z" },
    ]);
    button(h.render(), label).props.onClick({ currentTarget: opener() });
    assert.equal(h.requests.length, 3);
    const review = confirmation(h.render());
    assert.equal(review.props.open, true);
    review.props.onConfirm();
    assert.equal(h.requests.length, 4);
    assert.equal(h.requests[3].body.action, action);
    assert.equal(h.requests[3].body.id, ID);
    assert.equal(h.requests[3].body.payload.versionId, versionId);
  }
});

test("Kova draft discard keeps clean reload direct and dirty reload cancelable", async (t) => {
  const h = await openDetail(t, detail({ owned: true }));
  button(h.render(), "Edit Kova").props.onClick();
  let tree = h.render();
  const name = elements(tree, (node) => node.type === "input" && node.props.maxLength === 120)[0];
  name.props.onChange({ target: { value: "Unsaved name" } });
  button(h.render(), "Discard draft").props.onClick({ currentTarget: opener() });
  let review = confirmation(h.render());
  assert.equal(review.props.open, true);
  review.props.onOpenChange(false);
  assert.equal(h.requests.length, 3);
  tree = h.render();
  assert.equal(
    elements(tree, (node) => node.type === "input" && node.props.maxLength === 120)[0].props.value,
    "Unsaved name",
  );
  button(tree, "Discard draft").props.onClick({ currentTarget: opener() });
  review = confirmation(h.render());
  review.props.onConfirm();
  assert.equal(h.requests.length, 4);
  assert.equal(h.requests[3].path, `/api/kovas?scope=read&id=${ID}`);
});

test("Kova reporting requires explicit nonblank submit and preserves bounded report payload", async (t) => {
  const h = await openDetail(t);
  const trigger = opener();
  button(h.render(), "Report").props.onClick({ currentTarget: trigger });
  let tree = h.render();
  assert.equal(reportDialog(tree).props.open, true);
  assert.equal(h.requests.length, 2);
  reportInput(tree).props.onChange({ target: { value: "   " } });
  reportForm(h.render()).props.onSubmit({ preventDefault() {} });
  assert.equal(h.requests.length, 2, "Blank reports are not submitted");
  reportInput(h.render()).props.onChange({ target: { value: "  Specific concern  " } });
  reportDialog(h.render()).props.onOpenChange(false);
  assert.equal(h.requests.length, 2, "Cancel does not report");
  button(h.render(), "Report").props.onClick({ currentTarget: trigger });
  const reason = `  ${"Concern ".repeat(300)}`;
  reportInput(h.render()).props.onChange({ target: { value: reason } });
  tree = h.render();
  const form = reportForm(tree);
  form.props.onSubmit({ preventDefault() {} });
  form.props.onSubmit({ preventDefault() {} });
  assert.equal(h.requests.length, 3, "The review is consumed once");
  assert.equal(h.requests[2].body.action, "report");
  assert.equal(h.requests[2].body.payload.reason, reason.slice(0, 2000));
  const content = elements(tree, (node) => node.type === "DialogContent")[0];
  content.props.onCloseAutoFocus({ preventDefault() {} });
  assert.equal(trigger.focuses.length, 1);
  assert.equal(trigger.focuses[0].preventScroll, true);
});

test("Kova report review cannot submit after selection or storage reset", async (t) => {
  for (const reset of ["selection", "storage"]) {
    const h = await openDetail(t);
    button(h.render(), "Report").props.onClick({ currentTarget: opener() });
    reportInput(h.render()).props.onChange({ target: { value: "Specific concern" } });
    const stale = reportForm(h.render());
    if (reset === "selection") button(h.render(), "Create a Kova").props.onClick();
    else h.clearStorage();
    const current = h.render();
    (reportForm(current) ?? stale).props.onSubmit({ preventDefault() {} });
    assert.ok(h.requests.every(({ body }) => body === undefined));
  }
});

test("Kova model mode uses the shared selector without changing existing modes or plan hints", async (t) => {
  const h = await openDetail(t, detail({ owned: true }));
  button(h.render(), "Edit Kova").props.onClick();
  let tree = h.render();
  assert.equal(elements(tree, (node) => node.type === "select").length, 0);
  const selector = elements(tree, (node) => node.type === "Select")[0];
  assert.equal(selector.props.value, "instant");
  assert.equal(selector.props.disabled, false);
  assert.deepEqual(
    elements(tree, (node) => node.type === "SelectItem").map((node) => node.props.value),
    [...policy.KOVA_MODES],
  );
  selector.props.onValueChange("thinking");
  tree = h.render();
  assert.equal(elements(tree, (node) => node.type === "Select")[0].props.value, "thinking");
  const trigger = elements(tree, (node) => node.type === "SelectTrigger")[0];
  assert.equal(trigger.props.id, "kova-model-mode");
  assert.equal(trigger.props["aria-describedby"], "kova-model-mode-hint");
  assert.match(label(tree), /Each caller’s plan must support this mode/);
});
