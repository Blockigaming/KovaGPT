import assert from "node:assert/strict";
import test from "node:test";
import {
  createHookHarness,
  loadUiModule,
  elements,
  text,
  deferred,
} from "../helpers/ui-state-harness.mjs";

function fixture() {
  let h = createHookHarness();
  let isLoaded = true;
  let user = {
    id: "owner-a",
    fullName: "Sample reviewer",
    primaryEmailAddress: { emailAddress: "review@example.test" },
  };
  const requests = [];
  const frames = [];
  let focused = null;
  const persistentStorage = new Proxy(
    {},
    {
      get() {
        throw new Error("Support drafts must not use persistent browser storage");
      },
    },
  );
  const document = {
    body: {},
    activeElement: {},
    getElementById: (id) => ({
      focus: () => {
        focused = id;
      },
    }),
  };
  const { HelpSupportForm } = loadUiModule(
    "src/components/HelpSupportForm.tsx",
    {
      react: new Proxy({}, { get: (_target, key) => h.react[key] }),
      "lucide-react": { CheckCircle2: "CheckCircle2", Loader2: "Loader2" },
      "@/components/auth/ClerkSafe": { useUser: () => ({ user, isLoaded }) },
      "@/components/ui/button": { Button: "Button" },
      "@/components/ui/input": { Input: "Input" },
      "@/components/ui/label": { Label: "Label" },
      "@/components/ui/textarea": { Textarea: "Textarea" },
      "@/components/ui/searchable-picker": { SearchablePicker: "SearchablePicker" },
      "@/lib/fetch-with-timeout": {
        fetchWithTimeout: (_url, init) => {
          const result = deferred();
          requests.push({ ...result, init });
          return result.promise;
        },
      },
    },
    {
      document,
      window: {
        location: { href: "https://review.invalid/help" },
        localStorage: persistentStorage,
        sessionStorage: persistentStorage,
      },
      localStorage: persistentStorage,
      sessionStorage: persistentStorage,
      navigator: { userAgent: "local-test" },
      requestAnimationFrame: (fn) => frames.push(fn),
    },
  );
  let tree;
  const render = () => {
    tree = h.render(HelpSupportForm);
    for (const node of elements(tree))
      if (node.props.ref && typeof node.props.ref === "object")
        node.props.ref.current = {
          focus: () => {
            focused = node.props.role;
          },
        };
    return tree;
  };
  render();
  render();
  const change = (id, value) => {
    elements(tree, (x) => x.props.id === id)[0].props.onChange({ target: { value } });
    render();
  };
  const submit = () =>
    elements(tree, (x) => x.type === "form")[0].props.onSubmit({ preventDefault() {} });
  return {
    render,
    change,
    submit,
    requests,
    document,
    frames,
    get tree() {
      return tree;
    },
    get focused() {
      return focused;
    },
    changeOwner(id = "owner-b", loaded = true) {
      isLoaded = loaded;
      user =
        id === null
          ? null
          : {
              id,
              fullName: id === "owner-a" ? "Sample reviewer" : "Second reviewer",
              primaryEmailAddress: {
                emailAddress: id === "owner-a" ? "review@example.test" : "second@example.test",
              },
            };
      render();
      render();
    },
    unmount: () => h.unmount(),
    remount() {
      h.unmount();
      h = createHookHarness();
      render();
      render();
    },
  };
}

test("support submit has synchronous duplicate guard and confirms only accepted response", async () => {
  const f = fixture();
  f.change("support-message", "A disposable support question.");
  const first = f.submit();
  f.submit();
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await first;
  f.render();
  f.frames.forEach((fn) => fn());
  assert.match(text(f.tree), /Request accepted/);
  assert.doesNotMatch(text(f.tree), /Message sent/);
  assert.equal(f.focused, "status");
});

test("uncertain support outcome retains content and cannot submit another copy", async () => {
  const f = fixture();
  f.change("support-message", "Keep this exact draft.");
  const pending = f.submit();
  f.requests[0].reject(new Error("Timeout"));
  await pending;
  f.render();
  f.frames.forEach((fn) => fn());
  assert.match(text(f.tree), /couldn’t confirm|could confirm|confirm whether/);
  assert.equal(
    elements(f.tree, (x) => x.props.id === "support-message")[0].props.value,
    "Keep this exact draft.",
  );
  assert.equal(elements(f.tree, (x) => x.props.type === "submit")[0].props.disabled, true);
  await f.submit();
  assert.equal(f.requests.length, 1);
  assert.equal(f.focused, "alert");
});

test("known rejection permits correction without clearing the draft", async () => {
  const f = fixture();
  f.change("support-message", "Original draft.");
  const pending = f.submit();
  f.requests[0].resolve({ ok: false, status: 400, json: async () => ({ error: "Rejected" }) });
  await pending;
  f.render();
  assert.match(text(f.tree), /did not accept/);
  f.change("support-message", "Corrected draft.");
  f.submit();
  assert.equal(f.requests.length, 2);
});

test("account changes and unmount invalidate completion and private draft state", async () => {
  const f = fixture();
  f.change("support-message", "Owner A private draft.");
  const pending = f.submit();
  f.changeOwner();
  f.requests[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await pending;
  f.render();
  assert.doesNotMatch(text(f.tree), /Request accepted/);
  assert.equal(elements(f.tree, (x) => x.props.id === "support-message")[0].props.value, "");
  const g = fixture();
  g.change("support-message", "Unmount draft");
  const p = g.submit();
  g.unmount();
  g.requests[0].reject(new Error("late"));
  await p;
  assert.equal(g.frames.length, 0);
});

test("invalid submission focuses the actual field and no external request begins", async () => {
  const f = fixture();
  f.change("support-email", "bad");
  await f.submit();
  assert.equal(f.focused, "support-email");
  assert.equal(f.requests.length, 0);
});

test("pending submission focuses its persistent status before disabling Send", () => {
  const f = fixture();
  f.change("support-message", "Pending exact draft");
  f.submit();
  assert.equal(f.focused, "status");
  f.render();
  assert.match(text(f.tree), /Waiting for confirmation/);
  assert.equal(elements(f.tree, (x) => x.props.type === "submit")[0].props.disabled, true);
});

function actionLayout(tree) {
  const form = elements(tree, (node) => node.type === "form")[0];
  const children = form.props.children.filter((node) => node && typeof node === "object");
  const actionIndex = children.findIndex(
    (node) => elements(node, (child) => child.props.type === "submit").length === 1,
  );
  const footer = children[actionIndex];
  const send = elements(footer, (node) => node.props.type === "submit")[0];
  const pendingIndex = children.findIndex((node) => node.props.role === "status");
  const resultIndex = children.findIndex((node) => node.props.role === "alert");
  return {
    footer,
    send,
    pending: children[pendingIndex],
    result: children[resultIndex],
    actionIndex,
    pendingIndex,
    resultIndex,
    // The ordinary-flow nodes before Send retain their geometry classes.
    // This is a rendered layout contract, not a browser pixel measurement.
    preceding: children.slice(0, actionIndex + 1).map((node) => ({
      type: node.type,
      className: node.props.className,
      fields: elements(node, (child) => child.props.id).map((child) => ({
        id: child.props.id,
        className: child.props.className,
        value: child.props.value,
      })),
    })),
  };
}

test("pending and terminal feedback follow the stable action instead of shifting it in document flow", async () => {
  for (const outcome of ["rejection", "rate-limit", "uncertain", "transport"]) {
    const f = fixture();
    f.change("support-message", "Keep this exact draft and its textarea geometry.");
    const before = actionLayout(f.tree);
    assert.ok(before.actionIndex >= 0);
    assert.ok(before.pendingIndex > before.actionIndex);
    assert.equal(before.pending.props.className, "sr-only");
    assert.equal(before.pending.props.tabIndex, -1);
    assert.equal(before.resultIndex, -1);
    const request = f.submit();
    assert.equal(f.focused, "status", "The persistent pending target is focused synchronously");
    f.render();
    const sending = actionLayout(f.tree);
    assert.deepEqual(sending.preceding, before.preceding);
    assert.equal(sending.footer.props.className, before.footer.props.className);
    assert.equal(sending.send.props.className, before.send.props.className);
    assert.match(sending.send.props.className, /h-12 w-full shrink-0/);
    assert.equal(sending.send.props.disabled, true);
    assert.equal(elements(sending.send, (node) => node.type === "Loader2").length, 1);
    assert.ok(sending.pendingIndex > sending.actionIndex);
    assert.equal(sending.pending.props.ref, before.pending.props.ref);
    assert.equal(sending.pending.props.className, "text-sm text-muted-foreground");
    assert.equal(sending.pending.props["aria-live"], "polite");
    assert.equal(sending.pending.props["aria-hidden"], undefined);
    assert.match(text(sending.pending), /Sending your support request\. Waiting for confirmation/);

    if (outcome === "transport") f.requests[0].reject(Error("Connection ended"));
    else
      f.requests[0].resolve({
        ok: false,
        status: outcome === "rejection" ? 400 : outcome === "rate-limit" ? 429 : 503,
        json: async () => ({ success: false }),
      });
    await request;
    f.render();
    const terminal = actionLayout(f.tree);
    assert.deepEqual(terminal.preceding, before.preceding);
    assert.equal(terminal.footer.props.className, before.footer.props.className);
    assert.equal(terminal.send.props.className, before.send.props.className);
    assert.equal(terminal.send.props.disabled, outcome === "uncertain" || outcome === "transport");
    assert.equal(terminal.pending.props.className, "sr-only");
    assert.ok(terminal.resultIndex > terminal.actionIndex);
    assert.equal(terminal.result.props.tabIndex, -1);
    assert.equal(terminal.result.props["aria-hidden"], undefined);
    assert.match(text(terminal.result), /Your message is still here/);
    assert.doesNotMatch(
      terminal.result.props.className,
      /sr-only|hidden|absolute|h-\d|min-h-|max-h-/,
    );
    f.frames.splice(0).forEach((frame) => frame());
    assert.equal(f.focused, "alert", "The existing guarded result focus remains available");
    assert.equal(f.requests.length, 1);
    f.unmount();
  }
});

async function acceptedFixture() {
  const f = fixture();
  f.change("support-message", "Accepted old message");
  const pending = f.submit();
  f.requests[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await pending;
  f.render();
  f.frames.splice(0).forEach((fn) => fn());
  return f;
}
function startAnother(f) {
  const origin = {};
  f.document.activeElement = origin;
  elements(f.tree, (x) => x.type === "Button" && text(x).includes("Send another"))[0].props.onClick(
    { currentTarget: origin },
  );
  f.render();
  f.document.activeElement = f.document.body;
}
test("Send another clears only the sent message and focuses the new Message field", async () => {
  const f = await acceptedFixture();
  startAnother(f);
  f.frames.splice(0).forEach((fn) => fn());
  assert.equal(f.focused, "support-message");
  assert.equal(elements(f.tree, (x) => x.props.id === "support-message")[0].props.value, "");
  assert.equal(
    elements(f.tree, (x) => x.props.id === "support-email")[0].props.value,
    "review@example.test",
  );
  assert.equal(
    elements(f.tree, (x) => x.props.id === "support-name")[0].props.value,
    "Sample reviewer",
  );
});
test("Send another does not steal a later control focus", async () => {
  const f = await acceptedFixture();
  startAnother(f);
  f.document.activeElement = {};
  const before = f.focused;
  f.frames.splice(0).forEach((fn) => fn());
  assert.equal(f.focused, before);
});
test("Send another focus is canceled by account change or unmount", async () => {
  for (const action of [(f) => f.changeOwner(), (f) => f.unmount()]) {
    const f = await acceptedFixture();
    startAnother(f);
    action(f);
    const before = f.focused;
    f.frames.splice(0).forEach((fn) => fn());
    assert.equal(f.focused, before);
  }
});

test("support completion preserves focus moved to another control while sending", async () => {
  const f = fixture();
  f.change("support-message", "Keep my current focus");
  const pending = f.submit();
  f.document.activeElement = {};
  f.requests[0].resolve({ ok: false, status: 400, json: async () => ({ error: "Rejected" }) });
  await pending;
  f.render();
  const before = f.focused;
  f.frames.splice(0).forEach((fn) => fn());
  assert.equal(f.focused, before);
  assert.match(text(f.tree), /did not accept/);
});

test("support outcome prose retains theme foreground contrast and destructive framing", async () => {
  const f = fixture();
  f.change("support-message", "Preserved support draft");
  const pending = f.submit();
  f.requests[0].resolve({ ok: false, status: 400, json: async () => ({ error: "Rejected" }) });
  await pending;
  f.render();
  const alert = elements(
    f.tree,
    (x) => x.props.role === "alert" && text(x).includes("Support did not accept"),
  )[0];
  assert.match(alert.props.className, /text-foreground/);
  assert.doesNotMatch(alert.props.className, /text-destructive/);
  assert.match(alert.props.className, /border-destructive/);
  assert.match(alert.props.className, /bg-destructive/);
});

const field = (f, id) => elements(f.tree, (node) => node.props.id === id)[0];
const sendButton = (f) => elements(f.tree, (node) => node.props.type === "submit")[0];
const changeTopic = (f, value) => {
  field(f, "support-topic").props.onValueChange(value);
  f.render();
};

test("Help route remount retains every draft field and validation without an external request", () => {
  const f = fixture();
  f.change("support-name", "Edited contact");
  f.change("support-email", "invalid-email");
  changeTopic(f, "Privacy & security");
  // Both edits happen before another render; persistence must not depend on a later effect.
  field(f, "support-message").props.onChange({ target: { value: "Private unsent text" } });
  field(f, "support-email").props.onBlur();
  elements(
    f.tree,
    (node) => node.props["aria-hidden"] === "true" && node.type === "input",
  )[0].props.onChange({ target: { value: "honeypot-value" } });
  f.remount();
  assert.equal(field(f, "support-name").props.value, "Edited contact");
  assert.equal(field(f, "support-email").props.value, "invalid-email");
  assert.equal(field(f, "support-topic").props.value, "Privacy & security");
  assert.equal(field(f, "support-message").props.value, "Private unsent text");
  assert.equal(
    elements(f.tree, (node) => node.props["aria-hidden"] === "true" && node.type === "input")[0]
      .props.value,
    "honeypot-value",
  );
  assert.match(text(f.tree), /Enter a valid email address/);
  assert.equal(f.requests.length, 0);
  assert.equal(sendButton(f).props.disabled, false);
});

test("known rejection and rate limit survive remount and allow explicit corrected submissions", async () => {
  for (const status of [400, 429]) {
    const f = fixture();
    f.change("support-message", "Rejected draft");
    const pending = f.submit();
    f.requests[0].resolve({ ok: false, status, json: async () => ({ success: false }) });
    await pending;
    f.remount();
    assert.match(text(f.tree), status === 429 ? /Too many support requests/ : /did not accept/);
    assert.equal(field(f, "support-message").props.value, "Rejected draft");
    assert.equal(sendButton(f).props.disabled, false);
    f.change("support-message", "Corrected after navigation");
    const retry = f.submit();
    assert.equal(f.requests.length, 2);
    assert.equal(JSON.parse(f.requests[1].init.body).message, "Corrected after navigation");
    f.requests[1].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    await retry;
  }
});

test("uncertain transport, server and malformed-success outcomes stay locked across route remounts", async () => {
  for (const outcome of ["transport", "server", "malformed"]) {
    const f = fixture();
    f.change("support-message", "Potentially accepted private text");
    const pending = f.submit();
    if (outcome === "transport") f.requests[0].reject(new Error("Network ended"));
    else
      f.requests[0].resolve({
        ok: outcome === "malformed",
        status: outcome === "malformed" ? 200 : 503,
        json: async () => ({}),
      });
    await pending;
    f.remount();
    assert.match(text(f.tree), /confirm whether support accepted/);
    assert.equal(field(f, "support-message").props.value, "Potentially accepted private text");
    assert.equal(sendButton(f).props.disabled, true);
    await f.submit();
    f.remount();
    await f.submit();
    assert.equal(f.requests.length, 1);
  }
});

test("leaving pending Help locks its remounted draft and invalidates every late outcome", async () => {
  for (const outcome of ["accepted", "rejected", "transport"]) {
    const f = fixture();
    f.change("support-message", "Pending during navigation");
    const pending = f.submit();
    const staleSubmit = elements(f.tree, (node) => node.type === "form")[0].props.onSubmit;
    f.remount();
    assert.match(text(f.tree), /left this support form before we could confirm/);
    assert.equal(field(f, "support-message").props.value, "Pending during navigation");
    assert.equal(sendButton(f).props.disabled, true);
    await f.submit();
    await staleSubmit({ preventDefault() {} });
    assert.equal(f.requests.length, 1);
    if (outcome === "transport") f.requests[0].reject(new Error("Late failure"));
    else
      f.requests[0].resolve({
        ok: outcome === "accepted",
        status: outcome === "accepted" ? 200 : 400,
        json: async () => ({ success: outcome === "accepted" }),
      });
    await pending;
    f.render();
    assert.doesNotMatch(text(f.tree), /Request accepted|did not accept/);
    assert.match(text(f.tree), /left this support form before we could confirm/);
    assert.equal(f.frames.length, 0);
    assert.equal(sendButton(f).props.disabled, true);
    f.remount();
    await f.submit();
    assert.equal(f.requests.length, 1);
  }
});

test("principal A to B to A restores only each owner's draft, including after route remount", () => {
  const f = fixture();
  f.change("support-name", "A edited contact");
  f.change("support-email", "a-private@example.test");
  f.change("support-message", "A private draft");
  changeTopic(f, "Privacy & security");
  f.changeOwner();
  assert.equal(field(f, "support-message").props.value, "");
  assert.equal(field(f, "support-topic").props.value, "");
  assert.equal(field(f, "support-email").props.value, "second@example.test");
  f.change("support-message", "B private draft");
  f.changeOwner("owner-a");
  assert.equal(field(f, "support-name").props.value, "A edited contact");
  assert.equal(field(f, "support-email").props.value, "a-private@example.test");
  assert.equal(field(f, "support-message").props.value, "A private draft");
  assert.equal(field(f, "support-topic").props.value, "Privacy & security");
  f.remount();
  assert.equal(field(f, "support-message").props.value, "A private draft");
  f.changeOwner();
  f.remount();
  assert.equal(field(f, "support-message").props.value, "B private draft");
  assert.equal(field(f, "support-email").props.value, "second@example.test");
});

test("pending A to B to A never revives the old operation or enables another copy", async () => {
  const f = fixture();
  f.change("support-message", "A private pending draft");
  const pending = f.submit();
  f.changeOwner();
  assert.equal(sendButton(f).props.disabled, false);
  assert.equal(field(f, "support-message").props.value, "");
  f.change("support-message", "B independent draft");
  f.changeOwner("owner-a");
  assert.equal(field(f, "support-message").props.value, "A private pending draft");
  assert.equal(sendButton(f).props.disabled, true);
  f.requests[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await pending;
  f.render();
  assert.doesNotMatch(text(f.tree), /Request accepted/);
  await f.submit();
  assert.equal(f.requests.length, 1);
  f.changeOwner();
  assert.equal(field(f, "support-message").props.value, "B independent draft");
  assert.equal(sendButton(f).props.disabled, false);
});

test("accepted outcome survives remount and account changes until Send another explicitly resets it", async () => {
  const f = fixture();
  f.change("support-name", "Retained contact");
  f.change("support-email", "retained@example.test");
  f.change("support-message", "Accepted private message");
  changeTopic(f, "Billing & subscription");
  const staleSubmit = elements(f.tree, (node) => node.type === "form")[0].props.onSubmit;
  const pending = f.submit();
  f.requests[0].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await pending;
  // The old handler is fenced synchronously even before React renders success.
  await staleSubmit({ preventDefault() {} });
  assert.equal(f.requests.length, 1);
  f.remount();
  assert.match(text(f.tree), /Request accepted/);
  assert.match(text(f.tree), /retained@example.test/);
  f.changeOwner();
  assert.doesNotMatch(text(f.tree), /Request accepted|retained@example.test/);
  f.changeOwner("owner-a");
  assert.match(text(f.tree), /Request accepted/);
  startAnother(f);
  f.remount();
  assert.equal(field(f, "support-message").props.value, "");
  assert.equal(field(f, "support-topic").props.value, "");
  assert.equal(field(f, "support-email").props.value, "retained@example.test");
  assert.equal(field(f, "support-name").props.value, "Retained contact");
  assert.equal(field(f, "support-message").props["aria-invalid"], false);
  assert.equal(sendButton(f).props.disabled, false);
  assert.doesNotMatch(text(f.tree), /Request accepted|Your message is still here/);
  f.change("support-message", "Explicitly new message");
  const next = f.submit();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  await next;
});

test("unresolved auth hides guest and account drafts until their principal is known", () => {
  const f = fixture();
  f.change("support-message", "A private draft");
  f.changeOwner(null);
  assert.equal(field(f, "support-message").props.value, "");
  f.change("support-email", "guest@example.test");
  f.change("support-message", "Guest draft");
  f.changeOwner(null, false);
  assert.match(text(f.tree), /Loading support form/);
  assert.equal(elements(f.tree, (node) => node.type === "form").length, 0);
  f.remount();
  assert.match(text(f.tree), /Loading support form/);
  f.changeOwner("owner-a");
  assert.equal(field(f, "support-message").props.value, "A private draft");
  f.changeOwner(null);
  assert.equal(field(f, "support-message").props.value, "Guest draft");
  assert.equal(field(f, "support-email").props.value, "guest@example.test");
});
