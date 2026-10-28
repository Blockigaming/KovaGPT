import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";

const first = { id: "organization-a", name: "First organization", role: "owner", revision: 3 };
const second = { id: "organization-b", name: "Second organization", role: "member", revision: 5 };
const available = {
  available: true,
  canClose: false,
  retentionEnforced: false,
  organizations: [first, second],
  invitations: [],
};
const unavailable = { available: false, canClose: false, retentionEnforced: false };
const detail = (organization = first) => ({
  ...available,
  organization: { ...organization, retentionDaysDraft: null, policyVersion: "test" },
  members: [],
});
const retryLabel = "Retry loading organization access";

function fixture() {
  const hooks = createHookHarness();
  const effects = [],
    calls = [],
    focuses = [];
  const useEffect = hooks.react.useEffect;
  hooks.react.useEffect = (effect, deps) =>
    useEffect(() => {
      let cleanup;
      effects.push(() => {
        cleanup = effect();
      });
      return () => cleanup?.();
    }, deps);
  const window = { location: { href: "https://kova.test/organization" } };
  const node = (name) => ({
    name,
    isConnected: true,
    hidden: false,
    disabled: false,
    getClientRects() {
      return this.hidden ? [] : [{}];
    },
    closest: () => null,
    matches() {
      return this.disabled;
    },
    focus() {
      focuses.push(name);
      document.activeElement = this;
    },
  });
  const document = { body: node("body"), activeElement: null };
  document.activeElement = document.body;
  const client = loadUiModule("src/lib/organization-client.ts", {
    "@/integrations/supabase/client": { supabase: {} },
  });
  const account = { user: { id: "account-a" }, isLoaded: true, isSignedIn: true };
  const Page = loadUiModule(
    "src/components/OrganizationAdminPage.tsx",
    {
      react: hooks.react,
      "lucide-react": { Building2: "Building2", Download: "Download", RefreshCw: "RefreshCw" },
      "@/components/AppShell": { AppShell: "AppShell" },
      "@/components/WorkspacePageHeader": { WorkspacePageHeader: "WorkspacePageHeader" },
      "@/components/auth/ClerkSafe": { useUser: () => account, SignInButton: "SignInButton" },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/select": {
        Select: "Select",
        SelectContent: "SelectContent",
        SelectItem: "SelectItem",
        SelectTrigger: "SelectTrigger",
        SelectValue: "SelectValue",
      },
      "@/components/ui/input": { Input: "Input" },
      "@/components/OrganizationScimControls": { OrganizationScimControls: "ScimControls" },
      "@/lib/dialog-return-focus": loadUiModule("src/lib/dialog-return-focus.ts", {}, { window }),
      "@/lib/organization-client": {
        ...client,
        organizationRequest(owner, path, signal, body) {
          const pending = deferred();
          calls.push({ owner, path, signal, body, ...pending });
          return pending.promise;
        },
      },
    },
    {
      window,
      document,
      AbortController,
      crypto: { randomUUID: () => "synthetic-mutation-id" },
    },
  ).default;
  const content = () => elements(Page(), (element) => typeof element.type === "function")[0];
  const Component = content().type;
  const props = { userId: "account-a" };
  let tree;
  let attached = new Set();
  const nodes = new Map();
  const find = (type, label) =>
    elements(
      tree,
      (element) => element.type === type && (label === undefined || text(element).trim() === label),
    )[0];
  function render() {
    tree = hooks.render(Component, props);
    const next = new Set();
    for (const element of elements(tree)) {
      if (element.type !== "Button" && !element.props.ref) continue;
      const label = element.props["aria-label"] ?? text(element).trim();
      if (!nodes.has(label)) nodes.set(label, node(label));
      const target = nodes.get(label);
      target.isConnected = true;
      target.disabled = !!element.props.disabled;
      if (element.props.ref) element.props.ref.current = target;
      next.add(target);
    }
    for (const target of attached) {
      if (next.has(target)) continue;
      target.isConnected = false;
      if (document.activeElement === target) document.activeElement = document.body;
    }
    attached = next;
    while (effects.length) effects.shift()();
    return tree;
  }
  function click(label) {
    const button = find("Button", label);
    assert.ok(button, `Missing button: ${label}`);
    const target = nodes.get(label);
    document.activeElement = target;
    button.props.onClick({ currentTarget: target });
    render();
  }
  function select(id) {
    const select = find("Select");
    assert.ok(select, "Missing organization selector");
    const target = nodes.get("Choose organization");
    document.activeElement = target;
    select.props.onValueChange(id);
    render();
  }
  render();
  return {
    account,
    calls,
    client,
    content,
    document,
    find,
    focuses,
    node,
    nodes,
    props,
    render,
    click,
    select,
    window,
    unmount: () => hooks.unmount(),
    async flush() {
      await settle();
      render();
    },
    async resolve(data, call = calls.at(-1)) {
      call.resolve(data);
      await this.flush();
    },
    async reject(cause = Error("Synthetic read failure"), call = calls.at(-1)) {
      call.reject(cause);
      await this.flush();
    },
  };
}

function assertReadOnly(calls) {
  assert.ok(
    calls.every((call) => call.body === undefined),
    "Read recovery must never submit a body",
  );
}

test("initial GET failure ends loading and offers an actual read-only Retry to a confirmed unavailable state", async () => {
  const f = fixture();
  assert.match(text(f.render()), /Loading organization availability/);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].owner, "account-a");
  assert.equal(f.calls[0].path, "/api/organizations");
  await f.reject();
  assert.match(text(f.render()), /Organization access could not be loaded/);
  assert.doesNotMatch(
    text(f.render()),
    /Loading organization|request could not be confirmed|Retry the same request|not available yet/,
  );
  assert.equal(f.render().props["aria-busy"], false);
  assert.equal(f.focuses.length, 0, "Initial background load must not move focus");
  f.click(retryLabel);
  assert.equal(f.document.activeElement, f.nodes.get("Organization access"));
  assert.equal(f.render().props.tabIndex, -1);
  assert.match(text(f.render()), /Loading organization availability/);
  assert.equal(f.find("Button", retryLabel), undefined);
  assert.equal(f.render().props["aria-busy"], true);
  await f.resolve(unavailable);
  assert.match(text(f.render()), /Organization administration is not available yet/);
  assert.doesNotMatch(text(f.render()), /Loading organization|could not be loaded/);
  assert.deepEqual(f.focuses, [
    "Organization access",
    "Organization administration is not available yet",
  ]);
  assertReadOnly(f.calls);
});

test("available data, failed Refresh, and successful Retry have distinct states and safe focus", async () => {
  const f = fixture();
  await f.resolve(available);
  assert.ok(f.find("Select"));
  assert.equal(f.focuses.length, 0);
  f.click("Refresh");
  assert.equal(f.find("Select"), undefined, "Stale administrative controls must not remain active");
  await f.reject(new f.client.OrganizationRequestError(503, "service_unavailable"));
  assert.deepEqual(f.focuses, ["Organization access", retryLabel]);
  f.click(retryLabel);
  await f.resolve(available);
  assert.ok(f.find("Select"));
  assert.deepEqual(f.focuses, [
    "Organization access",
    retryLabel,
    "Organization access",
    "Choose organization",
  ]);
  assertReadOnly(f.calls);
});

for (const [status, message] of [
  [401, /Sign in again to load organization access for this account/],
  [403, /permission to view this organization/],
])
  test(`read ${status} preserves useful access guidance without mutation or server-detail wording`, async () => {
    const f = fixture();
    await f.reject(new f.client.OrganizationRequestError(status, "private-server-detail"));
    assert.match(text(f.render()), message);
    assert.doesNotMatch(
      text(f.render()),
      /private-server-detail|same request|Loading organization/,
    );
    assert.ok(f.find("Button", retryLabel));
    assertReadOnly(f.calls);
  });

test("detail failure offers GET-only Retry for the selected organization and restores its selector", async () => {
  const f = fixture();
  await f.resolve(available);
  f.select(first.id);
  await f.resolve(available);
  assert.equal(f.calls.at(-1).path, `/api/organizations?organizationId=${first.id}`);
  await f.reject();
  assert.doesNotMatch(text(f.render()), /Loading organization|Your role/);
  assert.deepEqual(f.focuses, ["Organization access", retryLabel]);
  f.click(retryLabel);
  assert.equal(f.calls.at(-1).path, "/api/organizations");
  await f.resolve(available);
  assert.equal(f.calls.at(-1).path, `/api/organizations?organizationId=${first.id}`);
  await f.resolve(detail());
  assert.match(text(f.render()), /Your role:.*owner/);
  assert.equal(f.find("Select").props.value, first.id);
  assert.deepEqual(f.focuses, [
    "Organization access",
    retryLabel,
    "Organization access",
    "Choose organization",
  ]);
  assertReadOnly(f.calls);
});

test("configuration turning unavailable between index and detail produces unavailable, never stale controls", async () => {
  const f = fixture();
  await f.resolve(available);
  f.select(first.id);
  await f.resolve(available);
  await f.resolve(unavailable);
  assert.match(text(f.render()), /Organization administration is not available yet/);
  assert.equal(f.find("Select"), undefined);
  assert.equal(f.find("Button", "Leave organization"), undefined);
  assertReadOnly(f.calls);
});

for (const stage of ["index", "detail"])
  test(`a malformed ${stage} response is a read error, not confirmed unavailability`, async () => {
    const f = fixture();
    if (stage === "detail") {
      await f.resolve(available);
      f.select(first.id);
      await f.resolve(available);
    }
    await f.resolve({});
    assert.match(text(f.render()), /Organization access could not be loaded/);
    assert.doesNotMatch(text(f.render()), /Loading organization|not available yet/);
    assert.ok(f.find("Button", retryLabel));
    assertReadOnly(f.calls);
  });

for (const lateResult of ["success", "error"])
  test(`newer reads win when an older detail finishes with ${lateResult}`, async () => {
    const f = fixture();
    await f.resolve(available);
    const selector = f.find("Select");
    const trigger = f.nodes.get("Choose organization");
    f.select(first.id);
    await f.resolve(available);
    const oldDetail = f.calls.at(-1);
    selector.props.onValueChange(second.id);
    f.render();
    await f.resolve(available);
    await f.resolve(detail(second));
    const focusCount = f.focuses.length;
    if (lateResult === "success") await f.resolve(detail(first), oldDetail);
    else await f.reject(Error("Old detail failure"), oldDetail);
    assert.equal(f.find("Select").props.value, second.id);
    assert.match(text(f.render()), /Your role:.*member/);
    assert.doesNotMatch(text(f.render()), /could not be loaded|Your role:.*owner/);
    assert.equal(f.focuses.length, focusCount);
    assertReadOnly(f.calls);
  });

for (const interruption of ["later focus", "navigation", "hidden target", "unmount"])
  test(`read recovery does not steal focus after ${interruption}`, async () => {
    const f = fixture();
    await f.reject();
    f.click(retryLabel);
    if (interruption === "later focus") f.document.activeElement = f.node("Sidebar");
    if (interruption === "navigation") f.window.location.href = "https://kova.test/library";
    if (interruption === "hidden target") {
      const target = f.node("Choose organization");
      target.hidden = true;
      f.nodes.set("Choose organization", target);
    }
    if (interruption === "unmount") f.unmount();
    await f.resolve(available);
    assert.deepEqual(f.focuses, ["Organization access"]);
    if (interruption === "unmount") {
      assert.equal(f.calls.at(-1).signal.aborted, true);
      assert.equal(f.find("Select"), undefined);
    }
    assertReadOnly(f.calls);
  });

test("account replacement aborts the captured lifetime and late old-account reads cannot publish or focus", async () => {
  const f = fixture();
  await f.reject();
  f.click(retryLabel);
  const oldRead = f.calls.at(-1);
  assert.equal(f.content().key, "account-a", "Account content must stay keyed by verified user ID");
  f.account.user = { id: "account-b" };
  assert.equal(f.content().key, "account-b");
  f.props.userId = "account-b";
  f.render();
  f.render();
  assert.equal(oldRead.signal.aborted, true);
  assert.equal(f.calls.at(-1).owner, "account-b");
  assert.notEqual(oldRead.signal, f.calls.at(-1).signal);
  await f.resolve(unavailable);
  await f.resolve(available, oldRead);
  assert.match(text(f.render()), /Organization administration is not available yet/);
  assert.equal(f.find("Select"), undefined);
  assert.deepEqual(f.focuses, ["Organization access"]);
  assertReadOnly(f.calls);
});

test("removed organization selection is cleared by Retry without fetching stale detail", async () => {
  const f = fixture();
  await f.resolve(available);
  f.select(first.id);
  await f.reject();
  f.click(retryLabel);
  const callsBeforeResult = f.calls.length;
  await f.resolve({ ...available, organizations: [second] });
  assert.equal(f.calls.length, callsBeforeResult);
  assert.equal(f.find("Select").props.value, "");
  assert.equal(f.find("Button", "Leave organization"), undefined);
  assertReadOnly(f.calls);
});

test("mutation retries preserve the original body and a failed post-save GET uses only read recovery", async () => {
  const f = fixture();
  await f.resolve(available);
  f.select(first.id);
  await f.resolve(available);
  await f.resolve(detail());
  f.click("Leave organization");
  const mutation = f.calls.at(-1);
  assert.equal(mutation.body.action, "leave");
  assert.equal(mutation.body.organizationId, first.id);
  assert.equal(mutation.body.expectedRevision, first.revision);
  assert.equal(mutation.body.mutationId, "synthetic-mutation-id");
  await f.reject(new f.client.OrganizationRequestError(503, "mutation_uncertain"));
  assert.match(text(f.render()), /The request could not be confirmed/);
  assert.equal(f.find("Button", retryLabel), undefined);
  f.click("Retry the same request");
  assert.equal(
    f.calls.at(-1).body,
    mutation.body,
    "Mutation retry must retain exact idempotency body",
  );
  await f.resolve({ revision: 4 });
  assert.equal(f.calls.at(-1).body, undefined);
  await f.reject();
  assert.match(text(f.render()), /Organization changes saved/);
  assert.match(text(f.render()), /Organization access could not be loaded/);
  assert.equal(f.find("Button", "Retry the same request"), undefined);
  f.click(retryLabel);
  await f.resolve(available);
  assert.equal(f.calls.filter((call) => call.body).length, 2);
  assert.equal(f.find("Select").props.value, "");
});
