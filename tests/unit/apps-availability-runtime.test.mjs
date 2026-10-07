import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  settle,
  deferred,
} from "../helpers/ui-state-harness.mjs";
import * as storage from "../../src/lib/principal-browser-storage.mjs";
import * as launchPolicy from "../../src/lib/core-launch-policy.mjs";

const catalog = loadUiModule("src/lib/connectors-catalog.ts", {
  "./core-launch-policy.mjs": launchPolicy,
});
const owner = "11111111-1111-4111-8111-111111111111";
function apps(status, search = "") {
  const hooks = createHookHarness();
  const messages = [];
  const connects = [];
  const memory = new Map();
  const local = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const auth = {
    isLoaded: true,
    isSignedIn: true,
    user: { id: owner, primaryEmailAddress: { verification: { status: "verified" } } },
  };
  const dependencies = {
    react: { ...hooks.react, useMemo: (fn) => fn() },
    "@tanstack/react-router": { createFileRoute: () => (config) => config },
    "@tanstack/react-start": { useServerFn: (fn) => fn },
    "@/components/auth/ClerkSafe": { useUser: () => auth, SignInButton: "SignInButton" },
    "@/lib/connectors-catalog": catalog,
    "@/lib/core-launch-policy.mjs": launchPolicy,
    "@/lib/github.functions": {},
    "@/lib/auth-fetch": {},
    "@/integrations/supabase/client": {},
    "@/lib/google-client": {
      getGoogleStatus: async () => status,
      startGoogleConnect: async (...args) => connects.push(args),
    },
    "@/lib/principal-browser-storage.mjs": { ...storage, safeBrowserStorage: () => local },
    sonner: {
      toast: {
        success: (message) => messages.push(message),
        error: (message) => messages.push(message),
      },
    },
  };
  for (const module of [
    "lucide-react",
    "@/components/ui/input",
    "@/components/ui/dialog",
    "@/components/AppShell",
    "@/components/WorkspacePageHeader",
    "@/components/ConfirmActionDialog",
    "@/components/ToolConfirmCard",
    "@/components/ui/button",
    "@/components/WorkflowSkillsPanel",
  ])
    dependencies[module] = new Proxy({}, { get: (_, name) => String(name) });
  const location = { search, pathname: "/apps" };
  const window = {
    location,
    addEventListener() {},
    removeEventListener() {},
    history: {
      replaceState(_a, _b, value) {
        location.search = value.includes("?") ? value.slice(value.indexOf("?")) : "";
      },
    },
  };
  const { Route } = loadUiModule("src/routes/apps.tsx", dependencies, {
    window,
    URLSearchParams,
    Date,
  });
  const render = () => hooks.render(Route.component);
  const ready = async () => {
    render();
    await settle();
    render();
    await settle();
    return render();
  };
  return { auth, render, ready, messages, connects, hooks, memory };
}
const disconnected = {
  connected: false,
  state: "disconnected",
  accounts: [],
  selectedConnectionId: null,
  selectionRevision: 0,
};
const button = (tree, label) =>
  elements(
    tree,
    (node) => ["Button", "button"].includes(node.type) && text(node).trim() === label,
  )[0];
function cards(tree) {
  return elements(tree, (node) => node.type?.name === "Section").flatMap((section) =>
    elements(section.type(section.props), (node) => node.type?.name === "AppCard"),
  );
}

test("all 355 planned entries lack a connect flow; source-only entries do not claim live operation", () => {
  assert.equal(catalog.CONNECTOR_CATALOG.length, 360);
  const planned = catalog.CONNECTOR_CATALOG.filter((item) => item.status === "planned");
  assert.equal(planned.length, 355);
  assert.ok(
    planned.every(
      (item) => catalog.connectorConnectFlow(item) === null && !catalog.isConnectorActionable(item),
    ),
  );
  assert.equal(catalog.LIVE_CONNECTOR_IDS.size, 0);
});

test("unknown and unconfigured deployments cannot start Google authorization", async () => {
  for (const configured of [undefined, false]) {
    const h = apps({ ...disconnected, configured });
    const tree = await h.ready();
    const add = button(tree, "Add Google account");
    assert.equal(add.props.disabled, true);
    await add.props.onClick();
    assert.equal(h.connects.length, 0, "handler also enforces availability");
    const googleCards = cards(tree).filter(
      (card) => catalog.connectorConnectFlow(card.props.item) === "google-oauth",
    );
    assert.equal(googleCards.length, 3);
    for (const card of googleCards) {
      const rendered = card.type(card.props);
      assert.equal(button(rendered, "Connect"), undefined);
      assert.match(text(rendered), configured === false ? /Setup required/ : /Status unavailable/);
    }
    h.hooks.unmount();
  }
});

test("fresh authenticated configuration enables the existing account-bound connect action", async () => {
  const h = apps({ ...disconnected, configured: true });
  const tree = await h.ready();
  const add = button(tree, "Add Google account");
  assert.equal(add.props.disabled, false);
  await add.props.onClick();
  assert.equal(h.connects.length, 1);
  assert.equal(h.connects[0][1], owner);
  assert.ok(
    cards(tree)
      .filter((card) => catalog.connectorConnectFlow(card.props.item) === "google-oauth")
      .every((card) => card.props.configured === true),
  );
  h.hooks.unmount();
});

test("launch lists exactly the thirteen selected plugins and never enables unfinished adapters", async () => {
  assert.deepEqual(
    Array.from(catalog.LAUNCH_PLUGIN_CATALOG, (item) => item.label),
    [
      "Gmail",
      "Google Calendar",
      "Google Drive",
      "Outlook",
      "OneDrive",
      "SharePoint",
      "Microsoft Teams",
      "Notion",
      "GitHub",
      "Linear",
      "Slack",
      "Salesforce",
      "HubSpot",
    ],
  );
  const h = apps({ ...disconnected, configured: true });
  const tree = await h.ready();
  const entries = cards(tree);
  assert.equal(entries.length, 12, "GitHub uses its existing account/repository manager");
  const pending = entries.filter((card) => catalog.connectorConnectFlow(card.props.item) === null);
  assert.equal(pending.length, 9);
  for (const card of pending) {
    const rendered = card.type(card.props);
    assert.equal(button(rendered, "Not available yet").props.disabled, true);
    assert.equal(button(rendered, "Connect"), undefined);
    assert.equal(button(rendered, "Use in chat"), undefined);
  }
  assert.equal(elements(tree, (node) => node.type === "WorkflowSkillsPanel").length, 0);
  assert.equal(button(tree, "Resend verification email"), undefined);
  assert.equal(h.connects.length, 0);
  h.hooks.unmount();
});

test("a copied OAuth callback parameter cannot generate a success message or activity receipt", async () => {
  const h = apps({ ...disconnected, configured: true }, "?google_connected=1");
  await h.ready();
  assert.deepEqual(h.messages, []);
  assert.equal(
    [...h.memory.values()].some((value) => value.includes('"Connected"')),
    false,
  );
  h.hooks.unmount();
});

test("a delayed status response after sign-out cannot enable a previous owner's connection", async () => {
  const pending = deferred();
  const h = apps(pending.promise);
  await h.ready();
  h.auth.isSignedIn = false;
  h.auth.user = null;
  h.render();
  pending.resolve({ ...disconnected, configured: true });
  await settle();
  const tree = h.render();
  assert.equal(button(tree, "Add Google account"), undefined);
  assert.match(text(tree), /Sign in to connect services/);
  assert.equal(h.connects.length, 0);
  h.hooks.unmount();
});

function statusHandler({
  configured,
  health = disconnected,
  auth = { userId: owner, supabaseAdmin: {} },
  fail = false,
}) {
  let reads = 0;
  const { Route } = loadUiModule(
    "src/routes/api/google/status.ts",
    {
      "@tanstack/react-router": { createFileRoute: () => (config) => config },
      "@/lib/api-auth.server": { requireUser: async () => auth },
      "@/lib/google-oauth.server": {
        googleOAuthConfigured: () => configured,
        getGoogleAccountsHealth: async () => {
          reads++;
          if (fail) throw new Error("fixture");
          return health;
        },
      },
      "@/lib/google-rate-limit.server": { enforceGoogleRateLimit: async () => null },
      "@/lib/connectors.server": { safeConnectorError: () => "fixture" },
      "@/lib/lockdown-policy.mjs": { enforceLockdownCapability: async () => null },
    },
    { Response, console: { error() {} } },
  );
  return {
    get: () =>
      Route.server.handlers.GET({ request: new Request("https://kova.test/api/google/status") }),
    reads: () => reads,
  };
}

test("status reports deployment configuration through the existing private authenticated response", async () => {
  for (const configured of [false, true]) {
    const h = statusHandler({ configured });
    const response = await h.get();
    assert.equal((await response.json()).configured, configured);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Vary"), "Authorization");
  }
});

test("unauthorized and failed status reads cannot advertise a connectable provider", async () => {
  const denied = statusHandler({ configured: true, auth: new Response(null, { status: 401 }) });
  assert.equal((await denied.get()).status, 401);
  assert.equal(denied.reads(), 0);
  const response = await statusHandler({ configured: true, fail: true }).get();
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.connected, false);
  assert.notEqual(body.configured, true);
});
