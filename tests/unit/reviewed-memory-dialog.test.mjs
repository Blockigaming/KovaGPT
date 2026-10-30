import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture, text } from "../helpers/kova-react-fixture.mjs";
const conversation = { id: "chat-one", messages: [] };
function fixture(options = {}) {
  let props = {
    ownerId: "owner-one",
    isScopeCurrent: () => true,
    conversation,
    onClose: () => {
      closed++;
    },
    returnFocusTarget: null,
    returnFocusUrl: "https://kova.invalid/",
  };
  let closed = 0;
  const calls = [];
  const document = { activeElement: null };
  const rendered = reactFixture(
    "src/components/ReviewedMemoryDialog.tsx",
    (exports) => () => exports.ReviewedMemoryDialog(props),
    {
      globals: { AbortController, document },
      modules: {
        "@/components/ui/checkbox": { Checkbox: "input" },
        "@/components/ui/dialog": Object.fromEntries(
          [
            "Dialog",
            "DialogContent",
            "DialogDescription",
            "DialogHeader",
            "DialogFooter",
            "DialogTitle",
          ].map((name) => [name, name]),
        ),
        "@/components/ui/alert-dialog": Object.fromEntries(
          [
            "AlertDialog",
            "AlertDialogAction",
            "AlertDialogCancel",
            "AlertDialogContent",
            "AlertDialogDescription",
            "AlertDialogFooter",
            "AlertDialogHeader",
            "AlertDialogTitle",
          ].map((name) => [
            name,
            name === "AlertDialogAction" || name === "AlertDialogCancel" ? "button" : name,
          ]),
        ),
        "@/lib/dialog-return-focus": { restoreDialogFocus() {} },
        "@/lib/reviewed-memory-client.mjs": {
          loadReviewedMemorySource: options.load ?? (async () => ({ revision: 3 })),
          saveReviewedMemory: async (input) => {
            calls.push(input);
            return options.save?.(input);
          },
        },
      },
    },
  );
  return {
    ...rendered,
    rendered,
    document,
    calls,
    get closed() {
      return closed;
    },
    change: (next) => {
      props = { ...props, ...next };
    },
    edit: async (value) => {
      rendered.find("textarea").props.onChange({ target: { value } });
      await rendered.flush();
    },
    confirm: async () => {
      rendered.find("input").props.onCheckedChange(true);
      await rendered.flush();
    },
  };
}

test("review starts blank with explicit cross-chat/replacement consequences and Cancel never writes", async () => {
  const f = fixture();
  await f.flush();
  assert.equal(f.find("textarea").props.value, "");
  assert.match(f.rendered.text(), /future chats/);
  assert.match(f.rendered.text(), /replaces any saved memory from this chat/);
  await f.edit("This answer only");
  assert.equal(f.calls.length, 0);
  await f.click("Cancel");
  assert.equal(f.closed, 0);
  assert.equal(f.find("AlertDialog").props.open, true);
  await f.click("Keep editing");
  assert.equal(f.find("textarea").props.value, "This answer only");
  await f.click("Cancel");
  await f.click("Discard draft");
  assert.equal(f.closed, 1);
  assert.equal(f.calls.length, 0);
});
test("Save requires reviewed text and confirmation, and any edit resets that confirmation", async () => {
  const f = fixture();
  await f.flush();
  await f.edit("Keep it brief");
  await f.confirm();
  assert.equal(
    f.find("button", (n) => text(n) === "Save memory for future chats").props.disabled,
    false,
  );
  await f.edit("For future chats, keep it brief");
  assert.equal(f.find("input").props.checked, false);
  assert.equal(
    f.find("button", (n) => text(n) === "Save memory for future chats").props.disabled,
    true,
  );
  await f.confirm();
  await f.click("Save memory for future chats");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].text, "For future chats, keep it brief");
  assert.equal(f.closed, 1);
  assert.deepEqual(f.messages, [["success", "Reviewed memory saved for future chats"]]);
});
test("same-turn duplicate Save is synchronously blocked and pending Cancel cannot claim rollback", async () => {
  let release;
  const f = fixture({
    save: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  await f.flush();
  await f.edit("Keep this");
  await f.confirm();
  const click = f.find("button", (n) => text(n) === "Save memory for future chats").props.onClick;
  click();
  click();
  await f.flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.find("button", (n) => text(n) === "Cancel").props.disabled, true);
  f.find("Dialog").props.onOpenChange(false);
  assert.equal(f.closed, 0);
  release();
  await f.flush();
  assert.equal(f.closed, 1);
});
test("failure stays visible with exact draft retained and no success", async () => {
  const f = fixture({
    save: async () => {
      throw new Error("Storage unavailable");
    },
  });
  await f.flush();
  await f.edit("Exact text");
  await f.confirm();
  await f.click("Save memory for future chats");
  assert.match(f.rendered.text(), /Storage unavailable/);
  assert.equal(f.find("textarea").props.value, "Exact text");
  assert.equal(f.closed, 0);
  assert.equal(f.messages.length, 0);
});
test("ineligible short/unsynced conversation exposes explanation and cannot save", async () => {
  const f = fixture({
    load: async () => {
      throw new Error("Four non-temporary messages are required");
    },
  });
  await f.flush();
  assert.match(f.rendered.text(), /Four non-temporary messages/);
  assert.equal(
    f.find("button", (n) => text(n) === "Save memory for future chats").props.disabled,
    true,
  );
  assert.equal(f.calls.length, 0);
});
test("owner change or unmount fences a late response and drops private draft", async () => {
  let release;
  const f = fixture({
    save: () =>
      new Promise((r) => {
        release = r;
      }),
  });
  await f.flush();
  await f.edit("Private exact text");
  await f.confirm();
  f.find("button", (n) => text(n) === "Save memory for future chats").props.onClick();
  f.change({ ownerId: "owner-two" });
  await f.flush();
  assert.equal(f.find("textarea").props.value, "");
  release();
  await f.flush();
  assert.equal(f.messages.length, 0);
  assert.equal(f.closed, 0);
  f.unmount();
});

test("editing immediately before an old Save callback invalidates its reviewed consent", async () => {
  const f = fixture();
  await f.flush();
  await f.edit("First exact text");
  await f.confirm();
  const oldSave = f.find("button", (n) => text(n) === "Save memory for future chats").props.onClick;
  f.find("textarea").props.onChange({ target: { value: "Changed text" } });
  oldSave();
  await f.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.find("input").props.checked, false);
});
test("route, account-reset, or eligibility scope invalidation prevents an old callback", async () => {
  let current = true;
  const f = fixture();
  f.change({ isScopeCurrent: () => current });
  await f.flush();
  await f.edit("Exact text");
  await f.confirm();
  const oldSave = f.find("button", (n) => text(n) === "Save memory for future chats").props.onClick;
  current = false;
  oldSave();
  await f.flush();
  assert.equal(f.calls.length, 0);
});

test("Cancel on an untouched draft closes without a discard prompt or writes", async () => {
  const f = fixture();
  await f.flush();
  await f.click("Cancel");
  assert.equal(f.closed, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.find("AlertDialog").props.open, false);
});

test("pending Save focuses a retained status and a late error reveals only while it still owns focus", async () => {
  let reject;
  const f = fixture({
    save: () =>
      new Promise((resolve, fail) => {
        reject = fail;
      }),
  });
  await f.flush();
  await f.edit("Exact text");
  await f.confirm();
  const actions = [];
  const target = {
    focus(options) {
      actions.push(["focus", options]);
      f.document.activeElement = target;
    },
    scrollIntoView(options) {
      actions.push(["reveal", options]);
    },
  };
  f.find("p", (n) => n.props.tabIndex === -1).props.ref.current = target;
  f.find("button", (n) => text(n) === "Save memory for future chats").props.onClick();
  await f.flush();
  assert.deepEqual(
    actions.map(([name]) => name),
    ["focus", "reveal"],
  );
  f.document.activeElement = { id: "another control" };
  reject(new Error("Storage unavailable"));
  await f.flush();
  assert.deepEqual(
    actions.map(([name]) => name),
    ["focus", "reveal"],
  );
  const error = f.find("p", (n) => n.props.role === "alert");
  assert.match(error.props.className, /text-foreground/);
  assert.match(f.find("DialogFooter").props.className, /w-full/);
  assert.match(
    f.find("label", (n) => text(n).includes("Use this exact text")).props.className,
    /min-h-11/,
  );
  await f.click("Cancel");
  assert.match(f.rendered.text(), /does not undo a save already attempted/);
});
