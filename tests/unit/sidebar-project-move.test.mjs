import assert from "node:assert/strict";
import test from "node:test";
import { completeProjectChatMove } from "../../src/lib/project-chat-move.mjs";
const source = { id: "chat", updatedAt: 1, messages: [{ role: "user", content: "Project notes" }] };
function fixture(options = {}) {
  let active = [source, { id: "other" }],
    current = true;
  const calls = [];
  return {
    calls,
    run: () =>
      completeProjectChatMove({
        source,
        isCurrent: () => current,
        readActive: () => active,
        archive: async (chat) => {
          calls.push(["archive", chat]);
          if (options.switchOwner) current = false;
          if (options.editAfter) active = [{ ...source, updatedAt: 2 }];
          return options.archive !== false;
        },
        remove: async (items) => {
          calls.push(["remove", items]);
          active = items;
          return true;
        },
        ...options.dependencies,
      }),
    edit: () => {
      active = [{ ...source, updatedAt: 2 }];
    },
  };
}
test("a confirmed project copy archives before removing its source and preserves other chats", async () => {
  const f = fixture();
  assert.equal(await f.run(), true);
  assert.deepEqual(
    f.calls.map(([name]) => name),
    ["archive", "remove"],
  );
  assert.deepEqual(f.calls[1][1], [{ id: "other" }]);
});
test("changed chats, archive failures and account changes retain the source", async () => {
  for (const options of [{ archive: false }, { switchOwner: true }, { editAfter: true }]) {
    const f = fixture(options);
    assert.equal(await f.run(), false);
    assert.equal(
      f.calls.some(([name]) => name === "remove"),
      false,
    );
  }
  const changed = fixture();
  changed.edit();
  assert.equal(await changed.run(), false);
  assert.equal(changed.calls.length, 0);
});
