import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const componentSource = readFileSync("src/components/ShareChatDialog.tsx", "utf8");
function load(source, modules = {}, globals = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(globals), code)(
    (name) => {
      assert.ok(name in modules, `Unexpected import: ${name}`);
      return modules[name];
    },
    module,
    module.exports,
    ...Object.values(globals),
  );
  return module.exports;
}
const policy = load(readFileSync("src/lib/share-chat-preview.ts", "utf8"));
const conversation = (id = "chat-a") => ({
  id,
  title: "  A private conversation  ",
  messages: [
    { id: "system", role: "system", content: "Private system metadata" },
    {
      id: "user",
      role: "user",
      content: "First line\nSecond line",
      attachments: [{ name: "excluded-file.txt", url: "https://private.invalid/file" }],
    },
    {
      id: "assistant",
      role: "assistant",
      content: "A reply with <literal> markup.",
      activities: [{ tool: "search", label: "Excluded tool data", status: "done" }],
    },
  ],
  mode: "chat",
  createdAt: 1,
  updatedAt: 1,
});
const ownUser = (id = "owner-a") => ({
  id,
  primaryEmailAddress: { emailAddress: `${id}@example.com` },
});
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : Array.isArray(node)
      ? node.map(text).join("")
      : typeof node === "object"
        ? text(node.props?.children)
        : String(node);
const nodes = (node) =>
  !node || typeof node !== "object"
    ? []
    : Array.isArray(node)
      ? node.flatMap(nodes)
      : [node, ...nodes(node.props?.children)];

// Execute the actual component and its callbacks with controlled hooks and a
// deferred server function. No account, network request, or real share is used.
function fixture() {
  const hooks = [],
    effects = [],
    requests = [],
    closed = [],
    successes = [],
    focused = [];
  class Element {
    constructor(type, options = {}) {
      this.type = type;
      this.isConnected = true;
      this.within = true;
      Object.assign(this, options);
    }
    focus() {
      focused.push(this.type);
      document.activeElement = this;
    }
    contains(target) {
      return target.within;
    }
    getClientRects() {
      return this.hidden ? [] : [{}];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
  }
  const document = { activeElement: null };
  const refElements = new Map();
  let cursor = 0,
    dirty = true,
    mounted = true,
    tree;
  let auth = { user: ownUser(), isLoaded: true, isSignedIn: true };
  let props = {
    open: true,
    conversation: conversation(),
    onOpenChange(open) {
      closed.push(open);
      props = { ...props, open };
      dirty = true;
    },
  };
  const effect = (run, dependencies) => {
    const index = cursor++;
    const previous = hooks[index];
    if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
      hooks[index] = { dependencies, cleanup: previous?.cleanup, run };
      effects.push(() => {
        hooks[index].cleanup?.();
        hooks[index].cleanup = run();
      });
    }
  };
  const react = {
    useState(value) {
      const index = cursor++;
      hooks[index] ??= { value: typeof value === "function" ? value() : value };
      return [
        hooks[index].value,
        (next) => {
          const value = typeof next === "function" ? next(hooks[index].value) : next;
          if (!Object.is(value, hooks[index].value)) {
            hooks[index].value = value;
            dirty = true;
          }
        },
      ];
    },
    useId() {
      return `share-${cursor++}`;
    },
    useRef(value) {
      const index = cursor++;
      hooks[index] ??= { current: value };
      return hooks[index];
    },
    useEffect: effect,
    useLayoutEffect: effect,
  };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const share = (payload) => {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
      resolve = yes;
      reject = no;
    });
    requests.push({ payload, resolve, reject });
    return promise;
  };
  const { ShareChatDialog } = load(
    componentSource,
    {
      react,
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "@/components/ui/dialog": Object.fromEntries(
        [
          "Dialog",
          "DialogContent",
          "DialogHeader",
          "DialogTitle",
          "DialogDescription",
          "DialogFooter",
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
        ].map((name) => [name, name]),
      ),
      "@/components/ui/button": { Button: "button" },
      "@/components/ui/input": { Input: "input" },
      "@tanstack/react-start": { useServerFn: () => share },
      "@/lib/shared-chats.functions": { shareChat: {} },
      "@/components/auth/ClerkSafe": { useUser: () => auth },
      "@/lib/share-chat-preview": policy,
      sonner: { toast: { success: (message) => successes.push(message) } },
    },
    { document, HTMLElement: Element },
  );
  function render() {
    for (let pass = 0; dirty && mounted && pass < 15; pass++) {
      dirty = false;
      cursor = 0;
      tree = ShareChatDialog(props);
      for (const [ref, element] of refElements) {
        ref.current = null;
        element.isConnected = false;
      }
      for (const node of nodes(tree)) {
        if (!node.props.ref) continue;
        const ref = node.props.ref;
        if (!refElements.has(ref)) refElements.set(ref, new Element(node.type));
        const element = refElements.get(ref);
        element.isConnected = true;
        ref.current = element;
      }
      while (effects.length) effects.shift()();
    }
    assert.equal(dirty && mounted, false, "Component should reach a stable render");
  }
  const find = (type) => nodes(tree).find((node) => node.type === type);
  const button = (label) =>
    nodes(tree).find((node) => node.type === "button" && text(node) === label);
  render();
  return {
    requests,
    closed,
    successes,
    focused,
    document,
    focus(type, options) {
      const target = new Element(type, options);
      target.focus();
      return target;
    },
    find,
    button,
    text: () => text(tree),
    email(value) {
      find("input").props.onChange({ target: { value } });
      render();
    },
    click(label) {
      const target = button(label);
      assert.ok(target, `Missing button: ${label}`);
      assert.equal(Boolean(target.props.disabled), false, `Disabled button: ${label}`);
      const result = target.props.onClick();
      render();
      return result;
    },
    close() {
      find("Dialog").props.onOpenChange(false);
      render();
    },
    escape() {
      let prevented = false;
      find("DialogContent").props.onEscapeKeyDown({
        preventDefault() {
          prevented = true;
        },
      });
      assert.equal(prevented, true);
      render();
    },
    openDiscardFocus() {
      find("AlertDialogContent").props.onOpenAutoFocus({ preventDefault() {} });
    },
    dismissDiscard(discard = false) {
      assert.equal(find("AlertDialog").props.open, true);
      if (discard)
        find("AlertDialogAction").props.onClick({
          preventDefault() {
            assert.fail("Discard unexpectedly blocked");
          },
        });
      find("AlertDialog").props.onOpenChange(false);
      render();
      find("AlertDialogContent").props.onCloseAutoFocus({ preventDefault() {} });
      render();
    },
    update(next) {
      props = { ...props, ...next };
      dirty = true;
      render();
    },
    auth(next) {
      auth = { ...auth, ...next };
      dirty = true;
      render();
    },
    strictEffects() {
      for (const hook of hooks) {
        if (!hook?.run) continue;
        hook.cleanup?.();
        hook.cleanup = hook.run();
      }
      render();
    },
    unmount() {
      mounted = false;
      for (const hook of hooks) hook?.cleanup?.();
    },
    async flush() {
      await new Promise(setImmediate);
      render();
    },
  };
}

function review(f, email = " Friend@Example.com ") {
  f.email(email);
  f.click("Review snapshot");
  assert.ok(f.button("Share"));
  assert.equal(f.requests.length, 0);
}

test("snapshot validation rejects bad/self addresses, empty text, and server-limit violations", () => {
  const cases = [
    [conversation(), "not-an-email", /valid email/],
    [conversation(), " OWNER-A@EXAMPLE.COM ", /yourself/],
    [{ ...conversation(), messages: [] }, "friend@example.com", /Nothing to share/],
    [
      { ...conversation(), messages: [{ role: "user", content: "  " }] },
      "friend@example.com",
      /Nothing to share/,
    ],
    [
      {
        ...conversation(),
        messages: Array.from({ length: 501 }, () => ({ role: "user", content: "x" })),
      },
      "friend@example.com",
      /too long/,
    ],
    [
      { ...conversation(), messages: [{ role: "user", content: "x".repeat(50_001) }] },
      "friend@example.com",
      /too long/,
    ],
    [{ ...conversation(), title: "x".repeat(201) }, "friend@example.com", /too long/],
    [conversation("x".repeat(101)), "friend@example.com", /too long/],
    [conversation(), `${"x".repeat(250)}@example.com`, /valid email/],
  ];
  for (const [chat, email, expected] of cases) {
    const result = policy.prepareShareSnapshot(chat, email, "owner-a@example.com");
    assert.match(result.error, expected);
    assert.equal(result.payload, undefined);
  }
  assert.equal(
    policy.prepareShareSnapshot({ ...conversation(), title: " " }, "friend@example.com", "").payload
      .title,
    "Shared chat",
  );
});

test("recipient validation stays in entry; review, Back and Cancel never call the server", () => {
  const f = fixture();
  f.email("wrong");
  f.click("Review snapshot");
  assert.match(f.text(), /Enter a valid email/);
  assert.equal(f.find("input").props["aria-invalid"], true);
  f.email("OWNER-A@EXAMPLE.COM");
  f.click("Review snapshot");
  assert.match(f.text(), /yourself/);
  review(f);
  assert.match(f.text(), /friend@example.com/);
  assert.match(f.text(), /A private conversation/);
  assert.match(f.text(), /First line\nSecond line/);
  assert.match(f.text(), /A reply with <literal> markup\./);
  assert.doesNotMatch(f.text(), /excluded-file|Private system metadata|Excluded tool data/);
  assert.equal(f.focused.at(-1), "h3");
  f.click("Back");
  assert.equal(f.find("input").props.value, " Friend@Example.com ");
  assert.equal(f.focused.at(-1), "input");
  f.click("Review snapshot");
  f.click("Cancel");
  assert.equal(f.find("AlertDialog").props.open, true);
  assert.deepEqual(f.closed, []);
  f.dismissDiscard(true);
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.requests.length, 0);
  f.update({ open: true });
  assert.equal(f.find("input").props.value, "");
  assert.ok(f.button("Review snapshot"));
  f.close();
  assert.equal(f.requests.length, 0);
});

test("explicit final Share sends the exact frozen review once despite later edits and duplicate clicks", async () => {
  const f = fixture();
  review(f);
  f.update({
    conversation: {
      ...conversation(),
      title: "Changed after review",
      messages: [{ role: "user", content: "Later text that was not reviewed" }],
    },
  });
  assert.doesNotMatch(f.text(), /Changed after review|Later text/);
  const submit = f.button("Share").props.onClick;
  const first = submit();
  const duplicate = submit();
  assert.equal(f.requests.length, 1);
  const payload = f.requests[0].payload.data;
  assert.deepEqual(payload, {
    recipient_email: "friend@example.com",
    title: "A private conversation",
    local_chat_reference: "chat-a",
    snapshot: {
      messages: [
        { role: "user", content: "First line\nSecond line" },
        { role: "assistant", content: "A reply with <literal> markup." },
      ],
    },
  });
  for (const value of [
    payload,
    payload.snapshot,
    payload.snapshot.messages,
    ...payload.snapshot.messages,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => {
    payload.snapshot.messages[0].content = "tampered";
  }, TypeError);
  f.requests[0].resolve({ id: "shared-record" });
  await Promise.all([first, duplicate]);
  await f.flush();
  assert.equal(f.successes.length, 1);
  assert.deepEqual(f.closed, []);
  assert.match(f.text(), /Snapshot shared/);
  assert.match(f.text(), /friend@example.com/);
  assert.doesNotMatch(f.text(), /Changed after review|Later text/);
  assert.equal(f.button("Share"), undefined);
  assert.equal(f.button("Back"), undefined);
  assert.equal(f.focused.at(-1), "h3");
  await submit();
  assert.equal(f.requests.length, 1, "Captured submit cannot repeat a confirmed share");
  await f.flush();
  assert.ok(f.button("Done"), "Receipt persists without a timeout");
  f.click("Done");
  assert.deepEqual(f.closed, [false]);
  assert.equal(f.find("AlertDialog").props.open, false);
});

test("pending Share blocks dismissal; failure preserves review and recipient for Back or deliberate retry", async () => {
  const f = fixture();
  review(f);
  const pending = f.click("Share");
  assert.equal(f.button("Back").props.disabled, true);
  assert.equal(f.button("Cancel").props.disabled, true);
  f.close();
  assert.deepEqual(f.closed, []);
  f.requests[0].reject(new Error("Share unavailable."));
  await pending;
  await f.flush();
  assert.match(f.text(), /Share unavailable.*Your review is saved here.*Check Library/s);
  assert.match(f.text(), /friend@example.com/);
  assert.ok(f.button("Share"));
  assert.equal(f.successes.length, 0);
  const retry = f.click("Share");
  assert.equal(f.requests[1].payload.data, f.requests[0].payload.data);
  f.requests[1].reject(new Error("Still unavailable."));
  await retry;
  await f.flush();
  f.click("Back");
  assert.equal(f.find("input").props.value, " Friend@Example.com ");
});

test("an absent server confirmation cannot produce success", async () => {
  const f = fixture();
  review(f);
  const pending = f.click("Share");
  f.requests[0].resolve({});
  await pending;
  await f.flush();
  assert.match(f.text(), /server did not confirm/);
  assert.equal(f.successes.length, 0);
  assert.deepEqual(f.closed, []);
  assert.ok(f.button("Share"));
});

test("account changes hide private content and ignore late success or failure without reviving old reviews", async () => {
  for (const failure of [false, true]) {
    const f = fixture();
    review(f);
    const pending = f.click("Share");
    f.auth({ user: ownUser("owner-b") });
    assert.match(f.text(), /account changed or is unavailable/);
    assert.doesNotMatch(f.text(), /friend@example.com|First line|private conversation/);
    if (failure) f.requests[0].reject(new Error("Old account failure"));
    else f.requests[0].resolve({ id: "old-record" });
    await pending;
    await f.flush();
    assert.equal(f.successes.length, 0);
    assert.deepEqual(f.closed, []);
    assert.doesNotMatch(f.text(), /Old account failure/);
    f.auth({ user: ownUser() });
    assert.equal(f.button("Share"), undefined);
    assert.equal(f.button("Review snapshot"), undefined);
  }
});

test("changing chats resets the review and late completion cannot disturb a newer in-flight share", async () => {
  const f = fixture();
  review(f);
  const first = f.click("Share");
  f.update({ conversation: conversation("chat-b") });
  assert.equal(f.find("input").props.value, "");
  f.email("new-recipient@example.com");
  f.click("Review snapshot");
  const second = f.click("Share");
  assert.equal(f.requests[1].payload.data.local_chat_reference, "chat-b");
  f.requests[0].resolve({ id: "old-record" });
  await first;
  await f.flush();
  assert.equal(f.successes.length, 0);
  assert.deepEqual(f.closed, []);
  assert.equal(f.button("Sharing…").props.disabled, true);
  f.requests[1].resolve({ id: "new-record" });
  await second;
  await f.flush();
  assert.equal(f.successes.length, 1);
  assert.deepEqual(f.closed, []);
  assert.match(f.text(), /new-recipient@example.com/);
  assert.ok(f.button("Done"));
});

test("close/reopen, unmount, and a chat round trip invalidate pending completion", async () => {
  for (const scenario of ["reopen", "unmount", "chat-round-trip"]) {
    const f = fixture();
    review(f);
    const pending = f.click("Share");
    if (scenario === "unmount") f.unmount();
    else if (scenario === "reopen") {
      f.update({ open: false });
      f.update({ open: true });
    } else {
      f.update({ conversation: conversation("chat-b") });
      f.update({ conversation: conversation() });
    }
    f.requests[0].resolve({ id: "late-record" });
    await pending;
    await f.flush();
    assert.equal(f.successes.length, 0, scenario);
    assert.deepEqual(f.closed, [], scenario);
    if (scenario !== "unmount") assert.ok(f.button("Review snapshot"), scenario);
  }
});

test("Strict Mode effect replay still allows a fresh explicit review and share", async () => {
  const f = fixture();
  f.strictEffects();
  review(f);
  const pending = f.click("Share");
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ id: "confirmed" });
  await pending;
  await f.flush();
  assert.equal(f.successes.length, 1);
});

test("request identity fails closed for missing accounts, chats, access and every changed lifetime", () => {
  const scope = {
    open: true,
    principalId: "owner",
    conversationId: "chat",
    canAccess: true,
    generation: 1,
  };
  assert.equal(policy.isCurrentShareRequest(scope, { ...scope }), true);
  for (const change of [
    { open: false },
    { principalId: "" },
    { principalId: "other" },
    { conversationId: null },
    { conversationId: "other" },
    { canAccess: false },
    { generation: 2 },
  ]) {
    assert.equal(policy.isCurrentShareRequest(scope, { ...scope, ...change }), false);
  }
  assert.match(componentSource, /max-h-\[40dvh\].*overflow-y-auto/);
  assert.match(componentSource, /<DialogFooter>/);
  assert.match(componentSource, /data-kova-dialog-close\]\]:h-11/);
  assert.doesNotMatch(componentSource, /navigator\.clipboard|window\.open|https?:\/\//);
});

test("pristine Cancel, Escape and Close dismiss without confirmation or a server call", () => {
  for (const dismissal of ["cancel", "escape", "close"]) {
    const f = fixture();
    if (dismissal === "cancel") f.click("Cancel");
    else f[dismissal]();
    assert.deepEqual(f.closed, [false], dismissal);
    assert.equal(f.find("AlertDialog").props.open, false, dismissal);
    assert.equal(f.requests.length, 0, dismissal);
  }
});

test("dirty recipient dismissal focuses Keep editing and preserves the exact draft and invoker", () => {
  for (const dismissal of ["cancel", "escape", "close"]) {
    const f = fixture();
    f.email(" unfinished recipient ");
    const invoker = f.focus(`invoker-${dismissal}`);
    if (dismissal === "cancel") f.click("Cancel");
    else f[dismissal]();
    assert.deepEqual(f.closed, [], dismissal);
    assert.equal(f.find("AlertDialog").props.open, true, dismissal);
    assert.equal(f.find("input").props.value, " unfinished recipient ");
    f.openDiscardFocus();
    assert.equal(f.focused.at(-1), "AlertDialogCancel");
    f.dismissDiscard(); // Radix Cancel or Escape both request open=false.
    assert.equal(f.document.activeElement, invoker);
    assert.equal(f.find("input").props.value, " unfinished recipient ");
    assert.deepEqual(f.closed, []);
    assert.equal(f.requests.length, 0);
  }
});

test("review dismissal keeps the frozen preview and blocks Share until the nested alert closes", async () => {
  const f = fixture();
  review(f);
  const submit = f.button("Share").props.onClick;
  f.escape();
  assert.equal(f.find("AlertDialog").props.open, true);
  await submit();
  assert.equal(f.requests.length, 0, "A captured Share cannot run underneath the confirmation");
  f.dismissDiscard();
  assert.match(f.text(), /First line\nSecond line/);
  assert.match(f.text(), /friend@example.com/);
  assert.ok(f.button("Share"));
  assert.deepEqual(f.closed, []);
});

test("Discard closes only after the nested focus scope and invalidates captured Share", async () => {
  const f = fixture();
  review(f);
  const submit = f.button("Share").props.onClick;
  f.click("Cancel");
  f.find("AlertDialogAction").props.onClick({
    preventDefault() {
      assert.fail();
    },
  });
  f.find("AlertDialog").props.onOpenChange(false);
  assert.deepEqual(f.closed, [], "Do not unmount the parent before nested focus cleanup");
  f.find("AlertDialogContent").props.onCloseAutoFocus({ preventDefault() {} });
  assert.deepEqual(f.closed, [false]);
  await submit();
  assert.equal(f.requests.length, 0);
  f.update({ open: true });
  assert.equal(f.find("input").props.value, "");
  assert.equal(f.find("AlertDialog").props.open, false);
  assert.ok(f.button("Review snapshot"));
  assert.equal(f.button("Share"), undefined);
});

test("Keep editing avoids detached, disabled, hidden, inert or unrelated focus targets", () => {
  for (const options of [
    { isConnected: false },
    { disabled: true },
    { hidden: true },
    { inert: true },
    { within: false },
  ]) {
    for (const stage of ["entry", "review"]) {
      const f = fixture();
      if (stage === "review") review(f);
      else f.email("draft");
      f.focus("unsafe-target", options);
      f.close();
      f.openDiscardFocus();
      f.dismissDiscard();
      assert.equal(f.focused.at(-1), stage === "review" ? "h3" : "input");
      assert.deepEqual(f.closed, []);
      assert.equal(f.requests.length, 0);
    }
  }
});

test("pending Share blocks Escape, outside dismissal and stale Discard callbacks without hiding its spinner", async () => {
  const f = fixture();
  review(f);
  f.close();
  const staleDiscard = f.find("AlertDialogAction").props.onClick;
  f.dismissDiscard();
  const pending = f.click("Share");
  f.escape();
  f.close();
  let outsidePrevented = false;
  f.find("DialogContent").props.onInteractOutside({
    preventDefault() {
      outsidePrevented = true;
    },
  });
  assert.equal(outsidePrevented, true);
  let discardPrevented = false;
  staleDiscard({
    preventDefault() {
      discardPrevented = true;
    },
  });
  assert.equal(discardPrevented, true);
  assert.equal(f.find("AlertDialog").props.open, false);
  assert.equal(f.find("DialogContent").props["aria-busy"], true);
  assert.equal(f.button("Sharing…").props.disabled, true);
  assert.equal(f.button("Cancel").props.disabled, true);
  assert.deepEqual(f.closed, []);
  assert.equal(f.requests.length, 1);
  assert.ok(
    nodes(f.button("Sharing…")).some(
      (node) =>
        node.props.className === "spec400-loading-spinner" && node.props["aria-hidden"] === "true",
    ),
  );
  f.requests[0].reject(new Error("Unavailable"));
  await pending;
  await f.flush();
  assert.ok(f.button("Share"));
});

test("a failed share retains its alert and preview through Keep editing; Discard does not claim cancellation or revocation", async () => {
  const f = fixture();
  review(f);
  const pending = f.click("Share");
  f.requests[0].reject(new Error("Connection interrupted."));
  await pending;
  await f.flush();
  f.click("Cancel");
  assert.match(text(f.find("AlertDialogDescription")), /does not revoke any earlier share/);
  f.dismissDiscard();
  assert.match(f.text(), /Connection interrupted.*Your review is saved here.*Check Library/s);
  assert.match(f.text(), /friend@example.com/);
  assert.match(f.text(), /First line\nSecond line/);
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.closed, []);
  f.escape();
  f.dismissDiscard(true);
  f.update({ open: true });
  assert.doesNotMatch(f.text(), /Connection interrupted|friend@example.com|First line/);
  assert.equal(f.find("input").props.value, "");
  assert.equal(f.requests.length, 1);
});

test("account, chat, external close and unmount changes invalidate open discard callbacks and focus", () => {
  for (const change of ["account", "chat", "close", "unmount"]) {
    const f = fixture();
    review(f);
    f.close();
    const staleAction = f.find("AlertDialogAction").props.onClick;
    const staleFocus = f.find("AlertDialogContent").props.onCloseAutoFocus;
    if (change === "account") f.auth({ user: ownUser("owner-b") });
    else if (change === "chat") f.update({ conversation: conversation("chat-b") });
    else if (change === "close") f.update({ open: false });
    else f.unmount();
    const focusedBefore = f.focused.length;
    let prevented = false;
    staleAction({
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(prevented, true, change);
    staleFocus({ preventDefault() {} });
    assert.equal(f.focused.length, focusedBefore, change);
    assert.deepEqual(f.closed, [], change);
    assert.equal(f.requests.length, 0, change);
    if (change !== "unmount") {
      assert.equal(f.find("AlertDialog").props.open, false, change);
      assert.doesNotMatch(f.text(), /friend@example.com|First line/);
    }
    if (change === "account") {
      f.auth({ user: ownUser() });
      assert.equal(f.button("Review snapshot"), undefined);
    }
  }
});

test("persistent success is scoped to the current account, chat and open lifetime", async () => {
  for (const change of ["account", "chat", "reopen"]) {
    const f = fixture();
    review(f);
    const pending = f.click("Share");
    f.requests[0].resolve({ id: "confirmed" });
    await pending;
    await f.flush();
    assert.match(f.text(), /Snapshot shared/);
    assert.ok(f.button("Done"));
    assert.deepEqual(f.closed, []);
    if (change === "account") f.auth({ user: ownUser("owner-b") });
    else if (change === "chat") f.update({ conversation: conversation("chat-b") });
    else {
      f.update({ open: false });
      f.update({ open: true });
    }
    assert.doesNotMatch(f.text(), /Snapshot shared|friend@example.com/);
    assert.equal(f.button("Done"), undefined);
    assert.equal(f.requests.length, 1);
    if (change === "account") {
      f.auth({ user: ownUser() });
      assert.equal(f.button("Review snapshot"), undefined);
      assert.doesNotMatch(f.text(), /Snapshot shared|friend@example.com/);
    } else {
      assert.equal(f.find("input").props.value, "");
    }
  }
});

test("old discard callbacks cannot dismiss or focus a newer chat's confirmation", () => {
  const f = fixture();
  review(f);
  f.close();
  const oldAction = f.find("AlertDialogAction").props.onClick;
  const oldFocus = f.find("AlertDialogContent").props.onCloseAutoFocus;
  const oldOpenFocus = f.find("AlertDialogContent").props.onOpenAutoFocus;
  const oldOpenChange = f.find("AlertDialog").props.onOpenChange;
  f.update({ conversation: conversation("new-chat") });
  review(f, "new@example.com");
  f.close();
  const focusedBefore = f.focused.length;
  let prevented = false;
  oldAction({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  oldOpenChange(false);
  oldOpenFocus({ preventDefault() {} });
  oldFocus({ preventDefault() {} });
  f.update({});
  assert.equal(f.find("AlertDialog").props.open, true);
  assert.equal(f.focused.length, focusedBefore);
  assert.deepEqual(f.closed, []);
  assert.equal(f.requests.length, 0);
  f.dismissDiscard();
  assert.match(f.text(), /new@example.com/);
  assert.ok(f.button("Share"));
});
