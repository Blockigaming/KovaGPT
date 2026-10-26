import assert from "node:assert/strict";
import test from "node:test";
import { reactFixture, text } from "../helpers/kova-react-fixture.mjs";

function fixture({ hasPendingMessage = false } = {}) {
  let account = { isLoaded: true, user: null };
  let generation = 0;
  let adapterFails = false;
  let schedulingFails = false;
  const frames = [];
  const calls = [];
  const returnTarget = { name: "attach-trigger" };
  const window = {
    location: { href: "https://example.test/chat" },
    requestAnimationFrame(callback) {
      if (schedulingFails) throw new Error("Frame unavailable");
      frames.push(callback);
    },
  };
  const open = (mode) => {
    calls.push(mode);
    if (adapterFails) throw new Error("Auth adapter unavailable");
  };
  const f = reactFixture(
    "src/components/ComposerSignInDialog.tsx",
    (module) => () =>
      module.ComposerSignInDialog({
        description: "Sign in to attach a file.",
        onClose: () => calls.push("close"),
        returnFocusTarget: returnTarget,
        hasPendingMessage,
      }),
    {
      modules: {
        "@/components/auth/ClerkSafe": {
          useClerkSafe: () => ({
            openSignIn: () => open("sign-in"),
            openSignUp: () => open("sign-up"),
          }),
          useUser: () => account,
        },
        "@/components/ui/dialog": {
          Dialog: "dialog",
          DialogContent: "dialog-content",
          DialogDescription: "dialog-description",
          DialogHeader: "dialog-header",
          DialogTitle: "dialog-title",
        },
        "@/lib/kova-auth-browser": { kovaAuthGeneration: () => generation },
        "@/lib/dialog-return-focus": {
          restoreDialogFocus: (...args) => calls.push(["focus", ...args]),
        },
      },
      globals: { window },
    },
  );
  return {
    ...f,
    calls,
    frames,
    returnTarget,
    window,
    adapterFails(value) {
      adapterFails = value;
    },
    schedulingFails(value) {
      schedulingFails = value;
    },
    changeGeneration() {
      generation++;
    },
    signIn() {
      account = { isLoaded: true, user: { id: "new-account" } };
    },
    runFrame() {
      assert.ok(frames.length, "A handoff frame must be queued");
      assert.doesNotThrow(() => frames.shift()());
    },
  };
}

for (const [label, mode] of [
  ["Sign in", "sign-in"],
  ["Create account", "sign-up"],
]) {
  test(`${mode}: a scheduled adapter failure keeps the prompt available for retry`, async () => {
    const f = fixture();
    await f.flush();
    f.adapterFails(true);
    await f.click(label);
    assert.equal(f.frames.length, 1);
    f.runFrame();
    await f.flush();
    assert.deepEqual(f.calls, [mode]);
    assert.equal(f.find("button", (node) => text(node) === label).props.disabled, false);
    assert.match(f.text(), /Could not open sign in\. Your draft is unchanged\. Try again\./);
    assert.equal(f.nodes().find((node) => node.props?.role === "alert")?.type, "p");

    f.adapterFails(false);
    await f.click(label);
    f.runFrame();
    await f.flush();
    assert.deepEqual(f.calls, [mode, mode, "close"]);
    assert.doesNotMatch(f.text(), /Could not open sign in/);
  });
}

test("a failed frame scheduler remains recoverable without closing the prompt", async () => {
  const f = fixture();
  await f.flush();
  f.schedulingFails(true);
  await f.click("Sign in");
  assert.deepEqual(f.calls, []);
  assert.equal(f.frames.length, 0);
  assert.match(f.text(), /Could not open sign in/);
  assert.equal(f.find("button", (node) => text(node) === "Sign in").props.disabled, false);
  f.schedulingFails(false);
  await f.click("Sign in");
  f.runFrame();
  assert.deepEqual(f.calls, ["sign-in", "close"]);
});

test("duplicate activation schedules one handoff and closes only after the adapter accepts it", async () => {
  const f = fixture();
  await f.flush();
  const signIn = f.find("button", (node) => text(node) === "Sign in");
  signIn.props.onClick();
  signIn.props.onClick();
  assert.equal(f.frames.length, 1);
  assert.deepEqual(f.calls, []);
  f.runFrame();
  assert.deepEqual(f.calls, ["sign-in", "close"]);
});

test("a changed auth generation blocks a stale frame and permits a fresh explicit attempt", async () => {
  const f = fixture();
  await f.flush();
  await f.click("Sign in");
  f.changeGeneration();
  f.runFrame();
  await f.flush();
  assert.deepEqual(f.calls, []);
  assert.equal(f.find("button", (node) => text(node) === "Sign in").props.disabled, false);
  await f.click("Sign in");
  f.runFrame();
  assert.deepEqual(f.calls, ["sign-in", "close"]);
});

test("a URL change or resolved account prevents a queued guest handoff", async () => {
  for (const change of [
    (f) => {
      f.window.location.href = "https://example.test/other";
    },
    (f) => f.signIn(),
  ]) {
    const f = fixture();
    await f.flush();
    await f.click("Sign in");
    change(f);
    await f.flush();
    f.runFrame();
    await f.flush();
    assert.deepEqual(f.calls, []);
    assert.equal(f.find("button", (node) => text(node) === "Not now").props.disabled, false);
  }
});

test("a pending draft prevents auth handoff and retains a direct way back to the draft", async () => {
  const f = fixture({ hasPendingMessage: true });
  await f.flush();
  for (const label of ["Sign in", "Create account"]) {
    const button = f.find("button", (node) => text(node) === label);
    assert.equal(button.props.disabled, true);
    button.props.onClick();
  }
  assert.equal(f.frames.length, 0);
  assert.deepEqual(f.calls, []);
  await f.click("Not now");
  assert.deepEqual(f.calls, ["close"]);
});

test("focus restoration suppresses the old trigger only after a successful handoff", async () => {
  for (const fails of [true, false]) {
    const f = fixture();
    await f.flush();
    f.adapterFails(fails);
    await f.click("Sign in");
    f.runFrame();
    await f.flush();
    let prevented = false;
    f.find("dialog-content").props.onCloseAutoFocus({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.deepEqual(f.calls.at(-1), [
      "focus",
      f.returnTarget,
      "https://example.test/chat",
      !fails,
    ]);
  }
});
