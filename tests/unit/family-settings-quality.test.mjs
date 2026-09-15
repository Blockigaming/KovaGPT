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

const group = { id: "group-a", name: "My Family", owner_id: "owner-a" };
const token = "a".repeat(48);
const ownerState = {
  group,
  role: "owner",
  members: [
    { id: "owner-row", user_id: "owner-a", role: "owner" },
    { id: "member-row", user_id: "member-b", role: "member" },
  ],
  invites: [
    {
      id: "invite-a",
      token,
      invited_email: "family@example.com",
      accepted_at: null,
      expires_at: "2099-01-01T00:00:00Z",
    },
  ],
};

function panel({
  state = ownerState,
  clipboard = async () => {},
  api = {},
  tier = { tier: "plus", loading: false },
} = {}) {
  const hooks = createHookHarness();
  const auth = { isLoaded: true, user: { id: "owner-a" } };
  const messages = [];
  const calls = [];
  const mutations = Object.fromEntries(
    [
      "createFamilyGroup",
      "createFamilyInvite",
      "removeFamilyMember",
      "revokeFamilyInvite",
      "leaveFamily",
    ].map((name) => [
      name,
      async (args) => {
        calls.push({ name, args });
        return name === "createFamilyInvite" ? { token } : { ok: true };
      },
    ]),
  );
  const functions = { getMyFamily: async () => state, ...mutations, ...api };
  const module = loadUiModule(
    "src/components/FamilySharingPanel.tsx",
    {
      react: hooks.react,
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ConfirmActionDialog": { ConfirmActionDialog: "ConfirmActionDialog" },
      "@/components/auth/ClerkSafe": { useUser: () => auth },
      "lucide-react": { Users: "Users", Copy: "Copy", X: "X", Loader2: "Loader2" },
      sonner: {
        toast: {
          success: (value) => messages.push({ kind: "success", value }),
          error: (value) => messages.push({ kind: "error", value }),
        },
      },
      "@/hooks/useTier": { useTier: () => tier },
      "@/lib/family.functions": functions,
    },
    {
      navigator: { clipboard: { writeText: clipboard } },
      window: { location: { origin: "https://kova.example" } },
    },
  );
  const wrapper = () => module.FamilySharingPanel();
  const root = wrapper();
  return {
    auth,
    calls,
    hooks,
    messages,
    wrapper,
    root,
    render: () => hooks.render(root.type, root.props),
  };
}

async function ready(fixture) {
  fixture.render();
  await settle();
  return fixture.render();
}
const button = (tree, name) =>
  elements(
    tree,
    (node) => node.type === "Button" && (text(node) === name || node.props["aria-label"] === name),
  )[0];
const dialog = (tree) => elements(tree, (node) => node.type === "ConfirmActionDialog")[0];
const manualLink = (tree) =>
  elements(tree, (node) => node.type === "Input" && node.props.readOnly)[0];
const submit = (tree) =>
  elements(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} });

test("creating an invite does not claim copying before the clipboard promise succeeds", async () => {
  const copy = deferred();
  const links = [];
  const fixture = panel({
    clipboard: (link) => {
      links.push(link);
      return copy.promise;
    },
  });
  const tree = await ready(fixture);
  submit(tree);
  submit(tree);
  await settle();
  assert.equal(fixture.calls.filter((call) => call.name === "createFamilyInvite").length, 1);
  assert.equal(links.length, 1);
  assert.equal(fixture.messages.length, 0);
  assert.equal(
    manualLink(fixture.render()).props.value,
    `https://kova.example/?family_invite=${token}`,
  );
  copy.resolve();
  await settle();
  assert.equal(fixture.messages.filter((message) => message.kind === "success").length, 1);
  assert.match(fixture.messages[0].value, /copied/);
});

test("clipboard failure preserves a selectable link even if the follow-up family read fails", async () => {
  let reads = 0;
  const fixture = panel({
    clipboard: async () => {
      throw Error("permission denied");
    },
    api: {
      getMyFamily: async () => {
        if (++reads > 1) throw Error("network");
        return ownerState;
      },
    },
  });
  submit(await ready(fixture));
  await settle();
  const tree = fixture.render();
  assert.equal(
    fixture.messages.some((message) => message.kind === "success"),
    false,
  );
  assert.match(fixture.messages[0].value, /Select and copy/);
  const input = manualLink(tree);
  assert.ok(input);
  assert.match(input.props.value, /family_invite=/);
  let selected = false;
  input.props.onFocus({
    currentTarget: {
      select: () => {
        selected = true;
      },
    },
  });
  assert.equal(selected, true);
  assert.ok(input.props["aria-describedby"]);
  assert.equal(elements(tree, (node) => node.props.role === "alert").length, 1);
  assert.ok(button(tree, "Try again"));
});

test("manual copy remains available while the post-create refresh is still pending", async () => {
  const refresh = deferred();
  let reads = 0;
  const fixture = panel({
    api: { getMyFamily: () => (++reads === 1 ? Promise.resolve(ownerState) : refresh.promise) },
  });
  submit(await ready(fixture));
  await settle();
  assert.match(text(fixture.render()), /Loading family center/);
  assert.ok(manualLink(fixture.render()));
  refresh.resolve(ownerState);
  await settle();
});

test("member removal and invitation revocation require confirmation and cancel is harmless", async () => {
  const fixture = panel();
  let tree = await ready(fixture);
  button(tree, "Remove family member member-b").props.onClick();
  tree = fixture.render();
  assert.equal(dialog(tree).props.open, true);
  assert.equal(fixture.calls.length, 0);
  dialog(tree).props.onOpenChange(false);
  assert.equal(dialog(fixture.render()).props.open, false);
  assert.equal(fixture.calls.length, 0);
  button(fixture.render(), "Revoke invite for family@example.com").props.onClick();
  const confirm = dialog(fixture.render()).props.onConfirm;
  confirm();
  confirm();
  await settle();
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].name, "revokeFamilyInvite");
  assert.equal(fixture.calls[0].args.data.inviteId, "invite-a");
});

test("family members cannot see owner invitation controls and leaving is confirmed", async () => {
  const fixture = panel({ state: { ...ownerState, role: "member", invites: [] } });
  let tree = await ready(fixture);
  assert.equal(elements(tree, (node) => node.type === "form").length, 0);
  assert.equal(button(tree, "Remove family member member-b"), undefined);
  button(tree, "Leave family").props.onClick();
  tree = fixture.render();
  assert.equal(fixture.calls.length, 0);
  assert.equal(dialog(tree).props.confirmLabel, "Leave family");
  dialog(tree).props.onConfirm();
  await settle();
  assert.equal(fixture.calls[0].name, "leaveFamily");
});

test("expired and accepted invites are not presented as reusable links", async () => {
  const fixture = panel({
    state: {
      ...ownerState,
      invites: [
        { ...ownerState.invites[0], id: "expired", expires_at: "2000-01-01T00:00:00Z" },
        {
          ...ownerState.invites[0],
          id: "invalid",
          invited_email: "invalid@example.com",
          expires_at: "invalid",
        },
        {
          ...ownerState.invites[0],
          id: "accepted",
          invited_email: "accepted@example.com",
          accepted_at: "2026-01-01",
        },
      ],
    },
  });
  const tree = await ready(fixture);
  assert.equal(button(tree, "Copy invite for family@example.com").props.disabled, true);
  assert.equal(button(tree, "Copy invite for invalid@example.com").props.disabled, true);
  assert.equal(button(tree, "Copy invite for accepted@example.com"), undefined);
  assert.match(text(tree), /Expired/);
  assert.match(text(tree), /Expiration unavailable/);
});

test("late mutation completion cannot populate an unmounted account or claim success", async () => {
  const creation = deferred();
  const fixture = panel({ api: { createFamilyInvite: () => creation.promise } });
  submit(await ready(fixture));
  fixture.hooks.unmount();
  fixture.auth.user = { id: "account-b" };
  assert.equal(fixture.wrapper().key, "account-b");
  creation.resolve({ token });
  await settle();
  assert.equal(fixture.messages.length, 0);
  assert.equal(manualLink(fixture.render()), undefined);
});

test("family failures have a retry state instead of an empty-family upsell", async () => {
  let fail = true;
  const fixture = panel({
    api: {
      getMyFamily: async () => {
        if (fail) throw Error("network");
        return ownerState;
      },
    },
  });
  let tree = await ready(fixture);
  assert.equal(elements(tree, (node) => node.props.role === "alert").length, 1);
  assert.doesNotMatch(text(tree), /Upgrade to invite/);
  fail = false;
  button(tree, "Try again").props.onClick();
  await settle();
  tree = fixture.render();
  assert.match(text(tree), /My Family/);
  assert.equal(elements(tree, (node) => node.props.role === "alert").length, 0);
});

test("empty and error family actions wrap enlarged text and retain usable touch targets", async () => {
  const empty = panel({ state: { group: null, role: null, members: [], invites: [] } });
  const failed = panel({
    api: {
      getMyFamily: async () => {
        throw Error("network");
      },
    },
  });
  for (const [fixture, label] of [
    [empty, "Create family group"],
    [failed, "Try again"],
  ]) {
    const action = button(await ready(fixture), label);
    assert.ok(action, `${label} must remain available`);
    const classes = action.props.className.split(" ");
    for (const required of ["h-auto", "min-h-11", "min-w-0", "max-w-full", "whitespace-normal"]) {
      assert.ok(classes.includes(required), `${label} must retain ${required}`);
    }
  }
});

test("a loading subscription does not flash the free-plan upsell", async () => {
  const fixture = panel({
    state: { group: null, role: null, members: [], invites: [] },
    tier: { tier: "free", loading: true },
  });
  const tree = await ready(fixture);
  assert.match(text(tree), /Checking your plan/);
  assert.doesNotMatch(text(tree), /Upgrade to invite/);
  assert.equal(button(tree, "Create family group"), undefined);
});

function familyRead(results) {
  const auth = Symbol("auth");
  const calls = [];
  const module = loadUiModule("src/lib/family.functions.ts", {
    "@tanstack/react-start": {
      createServerFn: () => ({
        middleware(list) {
          assert.equal(list[0], auth);
          return this;
        },
        validator() {
          return this;
        },
        handler: (fn) => fn,
      }),
    },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: auth },
    zod: { z: {} },
  });
  return {
    calls,
    run: () =>
      module.getMyFamily({
        context: {
          userId: "owner-a",
          supabase: {
            from(table) {
              const call = { table, filters: [] };
              const result = results[calls.length];
              assert.ok(result, `Unexpected read from ${table}`);
              calls.push(call);
              return {
                select() {
                  return this;
                },
                eq(...args) {
                  call.filters.push(args);
                  return this;
                },
                order() {
                  return this;
                },
                maybeSingle: async () => result,
                then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
              };
            },
          },
        },
      }),
  };
}
const ok = (data) => ({ data, error: null });

test("family read errors are not reported as a missing or empty family", async () => {
  const owner = [ok(group), ok(null), ok(ownerState.members), ok(ownerState.invites)];
  for (let index = 0; index < owner.length; index++) {
    const responses = [...owner];
    responses[index] = { data: null, error: { message: "private internal details" } };
    await assert.rejects(familyRead(responses).run(), (error) => {
      assert.match(error.message, /Could not load/);
      assert.doesNotMatch(error.message, /private internal details/);
      return true;
    });
  }
  await assert.rejects(
    familyRead([ok(null), ok({ group_id: "group-a", role: "member" }), ok(null)]).run(),
    /Could not load/,
  );
});

test("family reads remain caller-scoped and non-owners never query invitation tokens", async () => {
  const owner = familyRead([ok(group), ok(null), ok(ownerState.members), ok(ownerState.invites)]);
  assert.equal((await owner.run()).role, "owner");
  assert.deepEqual(
    owner.calls.map((call) => call.filters),
    [
      [["owner_id", "owner-a"]],
      [["user_id", "owner-a"]],
      [["group_id", "group-a"]],
      [["group_id", "group-a"]],
    ],
  );
  const member = familyRead([
    ok(null),
    ok({ group_id: "group-a", role: "member" }),
    ok(group),
    ok(ownerState.members),
  ]);
  const result = await member.run();
  assert.equal(result.role, "member");
  assert.equal(result.invites.length, 0);
  assert.equal(
    member.calls.some((call) => call.table === "family_invites"),
    false,
  );
  const absent = await familyRead([ok(null), ok(null)]).run();
  assert.equal(absent.group, null);
});
