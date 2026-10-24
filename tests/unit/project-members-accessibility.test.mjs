import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync("src/routes/projects.$projectId.tsx", "utf8");
const component = source.slice(
  source.indexOf("function MembersTab("),
  source.indexOf("// ===================== SETTINGS"),
);
const javascript = ts.transpileModule(`${component}\nreturn MembersTab;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

function fixture(overrides = {}, busy = false) {
  let stateIndex = 0;
  const dependencies = {
    React: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    },
    useState: (initial) => [stateIndex++ === 2 ? busy : initial, () => {}],
    ...Object.fromEntries(
      [
        "Mail",
        "Input",
        "Select",
        "SelectTrigger",
        "SelectValue",
        "SelectContent",
        "SelectItem",
        "Button",
        "Loader2",
        "Send",
        "Crown",
        "Trash2",
      ].map((name) => [name, name]),
    ),
  };
  const render = new Function(...Object.keys(dependencies), javascript)(
    ...Object.values(dependencies),
  );
  const calls = [];
  const tree = render({
    members: [
      { user_id: "owner-id", email: "owner@example.invalid", role: "owner" },
      { user_id: "editor-id", email: "editor@example.invalid", role: "editor" },
      { user_id: "viewer-id-without-email", email: null, role: "viewer" },
    ],
    invites: [
      { id: "pending-id", email: "invite@example.invalid", role: "viewer", status: "pending" },
    ],
    isOwner: true,
    onInvite: async () => {},
    onRemove: async (...args) => calls.push(["remove", ...args]),
    onChangeRole: async (...args) => calls.push(["role", ...args]),
    onRevoke: async (...args) => calls.push(["revoke", ...args]),
    ...overrides,
  });
  function walk(node) {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (!node || typeof node !== "object") return [];
    return [node, ...walk(node.children)];
  }
  const nodes = walk(tree);
  return { nodes, calls, find: (predicate) => nodes.find(predicate) };
}

test("invite email is associated with its visible label and invite role has an accessible name", () => {
  const { find } = fixture();
  const input = find((node) => node.type === "Input");
  const label = find((node) => node.type === "label" && node.props.htmlFor === input.props.id);
  assert.ok(input.props.id);
  assert.ok(label);
  assert.ok(label.children.includes("Invite by email"));
  assert.equal(input.props.type, "email");
  assert.ok(
    find((node) => node.type === "SelectTrigger" && node.props["aria-label"] === "Invite role"),
  );
});

test("member role and removal controls identify their member and retain callback targets", async () => {
  const { find, calls } = fixture();
  for (const [identity, userId] of [
    ["editor@example.invalid", "editor-id"],
    ["viewer-i", "viewer-id-without-email"],
  ]) {
    const trigger = find(
      (node) =>
        node.type === "SelectTrigger" && node.props["aria-label"] === `Role for ${identity}`,
    );
    assert.ok(trigger);
    const select = find((node) => node.type === "Select" && node.children.includes(trigger));
    await select.props.onValueChange("viewer");
    const remove = find((node) => node.props["aria-label"] === `Remove ${identity} from project`);
    assert.ok(remove);
    await remove.props.onClick();
    assert.deepEqual(calls.splice(0), [
      ["role", userId, "viewer"],
      ["remove", userId],
    ]);
  }
  assert.equal(
    find((node) => node.props["aria-label"] === "Role for owner@example.invalid"),
    undefined,
  );
});

test("pending invite revocation identifies its email and preserves the invitation ID", async () => {
  const { find, calls } = fixture();
  const revoke = find(
    (node) => node.props["aria-label"] === "Revoke invitation for invite@example.invalid",
  );
  assert.ok(revoke);
  await revoke.props.onClick();
  assert.deepEqual(calls, [["revoke", "pending-id"]]);
});

test("invite retains an accessible name while busy and nonowners receive no member mutation controls", () => {
  const invite = fixture({}, true).find(
    (node) => node.type === "Button" && node.props["aria-label"] === "Invite",
  );
  assert.ok(invite.props.disabled);
  assert.equal(invite.props["aria-busy"], true);
  const { nodes } = fixture({ isOwner: false });
  assert.equal(nodes.filter((node) => ["Input", "Select", "Button"].includes(node.type)).length, 0);
});
