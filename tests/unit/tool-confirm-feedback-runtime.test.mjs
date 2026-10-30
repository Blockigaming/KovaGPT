import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeChatHistory } from "../../src/lib/chat-history-policy.mjs";
import {
  createHookHarness,
  deferred,
  elements,
  loadUiModule,
  settle,
  text,
} from "../helpers/ui-state-harness.mjs";
import {
  createReviewChatAction,
  reviewChatActionConfirmations,
  REVIEW_CHAT_ACTION_A,
  REVIEW_CHAT_ACTION_B,
  REVIEW_CHAT_ACTION_OWNER,
  REVIEW_CHAT_ACTION_RECONNECT,
  REVIEW_CHAT_ACTION_SUCCESS,
} from "../../review-kit/chat-stream-review-fixture.mjs";

// Executes the actual component and the bounded local action contract. No DOM,
// browser, HTTP server, account, or provider operation is involved.
const label = (tree) => text(tree).replace(/\s+/g, " ").trim();
const response = (json, status = 200) => ({ ok: status < 400, status, json: async () => json });
function fixture(fetchImpl) {
  const requests = [],
    updates = [],
    toasts = [],
    frames = [],
    cards = [],
    listeners = new Set(),
    focusEvents = [];
  const review = createReviewChatAction({ isActive: () => true });
  const document = {
    addEventListener(name, fn) {
      assert.equal(name, "focusin");
      listeners.add(fn);
    },
    removeEventListener(name, fn) {
      assert.equal(name, "focusin");
      listeners.delete(fn);
    },
  };
  class Node {
    constructor(name) {
      this.name = name;
      this.isConnected = true;
    }
    getClientRects() {
      return this.isConnected && !this.hidden ? [{}] : [];
    }
    closest() {
      return this.inert ? {} : null;
    }
    matches() {
      return !!this.disabled;
    }
    focus() {
      document.activeElement = this;
      focusEvents.push(this.name);
      for (const fn of listeners) fn({ target: this });
    }
  }
  document.body = new Node("body");
  document.activeElement = document.body;
  const window = { location: { href: "https://fixture.invalid/chat" } };
  const restore = loadUiModule("src/lib/dialog-return-focus.ts", {}, { window });
  const authFetch = async (url, init) => {
    requests.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    if (fetchImpl) return fetchImpl(url, init);
    let result;
    await review.handler({
      request: () => ({
        url: () => new URL(url, "http://127.0.0.1:4189").href,
        method: () => init?.method ?? "GET",
        headers: () => ({
          "content-type": "application/json",
          "x-kova-owner": REVIEW_CHAT_ACTION_OWNER,
        }),
        postData: () => init?.body,
      }),
      fulfill: (value) => (result = response(value.json, value.status)),
      fallback: () => assert.fail("Unexpected request outside the bounded action fixture"),
    });
    return result;
  };
  const mount = (initial) => {
    const hooks = createHookHarness();
    const { ToolConfirmCard } = loadUiModule(
      "src/components/ToolConfirmCard.tsx",
      {
        react: hooks.react,
        "lucide-react": new Proxy({}, { get: (_, name) => name }),
        sonner: {
          toast: Object.fromEntries(
            ["error", "success", "warning"].map((kind) => [
              kind,
              (...args) => toasts.push({ kind, args }),
            ]),
          ),
        },
        "@/lib/auth-fetch": { authFetch },
        "@/lib/dialog-return-focus": restore,
      },
      { document, window, requestAnimationFrame: (fn) => frames.push(fn), Error },
    );
    let confirm = initial,
      tree,
      attached = new Set(),
      mounted = true;
    const nodes = new Map();
    const render = () => {
      if (!mounted) return;
      tree = hooks.render(ToolConfirmCard, {
        confirm,
        onUpdate(next) {
          updates.push(next);
          confirm = next;
        },
      });
      const next = new Set();
      const walk = (value, path = "root") => {
        if (Array.isArray(value)) return value.forEach((child, i) => walk(child, `${path}.${i}`));
        if (!value?.props) return;
        if (typeof value.type === "string" && /^[a-z]/.test(value.type)) {
          const key = `${path}:${value.type}`;
          if (!nodes.has(key)) nodes.set(key, new Node(`${initial.actionId}:${key}`));
          const node = nodes.get(key);
          node.isConnected = true;
          node.disabled = !!value.props.disabled;
          node.ref = value.props.ref;
          value.node = node;
          if (node.ref) node.ref.current = node;
          next.add(node);
        }
        walk(value.props.children, `${path}.children`);
      };
      walk(tree);
      for (const node of attached) {
        if (next.has(node)) continue;
        node.isConnected = false;
        if (node.ref?.current === node) node.ref.current = null;
        if (document.activeElement === node) document.activeElement = document.body;
      }
      attached = next;
      return tree;
    };
    const card = {
      render,
      get confirm() {
        return confirm;
      },
      get tree() {
        return tree;
      },
      buttons: () => elements(tree, (item) => item.type === "button"),
      feedback: () => elements(tree, (item) => ["alert", "status"].includes(item.props.role))[0],
      click(name) {
        const button = this.buttons().find((item) => label(item) === name);
        assert.ok(button, `Missing action ${name}`);
        button.node.focus();
        button.props.onClick({ currentTarget: button.node });
        render();
        return button;
      },
      replace(next) {
        confirm = next;
        render();
        render();
      },
      unmount() {
        mounted = false;
        hooks.unmount();
        for (const node of attached) node.isConnected = false;
      },
    };
    cards.push(card);
    render();
    return card;
  };
  return {
    mount,
    requests,
    updates,
    toasts,
    listeners,
    document,
    window,
    Node,
    focusEvents,
    review,
    framesNow() {
      while (frames.length) frames.shift()();
    },
    async flush({ frames = true } = {}) {
      await settle();
      for (const card of cards) card.render();
      if (frames) this.framesNow();
    },
  };
}

test("B reconnect feedback persists beside Retry/Cancel; completed A and the proposal are retained", async () => {
  const f = fixture();
  const [complete, pending] = reviewChatActionConfirmations();
  const a = f.mount(complete),
    b = f.mount(pending);
  assert.equal(a.buttons().length, 0);
  assert.equal(b.feedback(), undefined);
  b.click("Confirm");
  await f.flush();
  assert.equal(b.confirm.status, "failed");
  assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_RECONNECT);
  assert.equal(b.feedback().props.role, "alert");
  assert.equal(b.feedback().props.tabIndex, -1);
  assert.match(b.feedback().props.className, /bg-destructive\/10 text-foreground/);
  assert.doesNotMatch(b.feedback().props.className, /text-destructive/);
  assert.equal(f.document.activeElement, b.feedback().node);
  assert.deepEqual(b.buttons().map(label), ["Retry", "Cancel"]);
  for (const button of b.buttons())
    assert.equal(button.props["aria-describedby"], b.feedback().props.id);
  assert.ok(label(b.tree).includes(pending.summary));
  assert.ok(label(b.tree).includes(pending.argsPreview.body_preview));
  f.toasts.length = 0;
  b.render();
  assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_RECONNECT, "independent of transient toast");
  assert.equal(a.confirm, complete);
  assert.equal(label(a.feedback()), complete.resultText);
  assert.deepEqual(
    f.requests.map((item) => item.body),
    [{ action_id: REVIEW_CHAT_ACTION_B, decision: "confirm" }],
  );
});

test("stored reconnect failure restores with its explanation and controls without grabbing focus", () => {
  const [complete, pending] = reviewChatActionConfirmations();
  const stored = normalizeChatHistory(
    {
      id: "action-review",
      title: "Action review",
      mode: "instant",
      createdAt: 1,
      updatedAt: 2,
      messages: [
        {
          id: "action-message",
          role: "assistant",
          content: "Review these two actions.",
          pendingConfirms: [
            complete,
            { ...pending, status: "failed", resultText: REVIEW_CHAT_ACTION_RECONNECT },
          ],
        },
      ],
    },
    REVIEW_CHAT_ACTION_OWNER,
  );
  const f = fixture();
  const [savedA, savedB] = JSON.parse(JSON.stringify(stored)).messages[0].pendingConfirms;
  const a = f.mount(savedA),
    b = f.mount(savedB);
  assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_RECONNECT);
  assert.deepEqual(b.buttons().map(label), ["Retry", "Cancel"]);
  assert.equal(a.buttons().length, 0);
  assert.equal(label(a.feedback()), complete.resultText);
  assert.equal(f.document.activeElement, f.document.body);
  assert.equal(f.requests.length, 0);
});

test("explicit Retry completes only B once and prevents stale or repeated completed-action replay", async () => {
  const f = fixture();
  const [complete, pending] = reviewChatActionConfirmations();
  const a = f.mount(complete),
    b = f.mount(pending);
  b.click("Confirm");
  await f.flush();
  const retry = b.click("Retry");
  retry.props.onClick({ currentTarget: retry.node });
  assert.equal(f.requests.length, 2, "synchronous repeated click cannot issue a third request");
  assert.ok(b.buttons().every((item) => item.props.disabled));
  assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_RECONNECT, "failure survives pending retry");
  await settle();
  retry.props.onClick({ currentTarget: retry.node });
  assert.equal(f.requests.length, 2, "settled callback cannot replay before React commits");
  await f.flush();
  assert.equal(b.confirm.status, "confirmed");
  assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_SUCCESS);
  assert.equal(b.buttons().length, 0);
  assert.equal(f.document.activeElement, b.feedback().node);
  retry.props.onClick({ currentTarget: retry.node });
  assert.equal(f.requests.length, 2);
  assert.ok(f.requests.every((item) => item.body.action_id === REVIEW_CHAT_ACTION_B));
  assert.equal(a.confirm, complete);
  assert.equal(a.confirm.actionId, REVIEW_CHAT_ACTION_A);
  assert.equal(f.listeners.size, 0);
});

test("Cancel after B failure resolves only that action and removes obsolete reconnect instructions", async () => {
  const f = fixture();
  const [complete, pending] = reviewChatActionConfirmations();
  const a = f.mount(complete),
    b = f.mount(pending);
  b.click("Confirm");
  await f.flush();
  b.click("Cancel");
  await f.flush();
  assert.equal(b.confirm.status, "cancelled");
  assert.equal(b.buttons().length, 0);
  assert.match(label(b.feedback()), /Synthetic B cancelled locally/);
  assert.doesNotMatch(label(b.feedback()), /reconnect/i);
  assert.equal(f.document.activeElement, b.feedback().node);
  assert.equal(a.confirm, complete);
  assert.deepEqual(f.requests.at(-1).body, {
    action_id: REVIEW_CHAT_ACTION_B,
    decision: "cancel",
  });
});

test("confirmation actions inherit shared pill geometry, 36px/44px targets and one icon size owner", async () => {
  const pending = deferred();
  const f = fixture(() => pending.promise);
  const b = f.mount(reviewChatActionConfirmations()[1]);
  const primitive = readFileSync("src/components/ui/button.tsx", "utf8");
  assert.match(primitive, /rounded-full/);
  assert.match(primitive, /default: "h-9 px-\[15\.96px\] py-0"/);
  assert.match(primitive, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.match(primitive, /\[&_svg\]:size-\[18px\]/);
  assert.deepEqual(
    b.buttons().map((button) => button.props.variant),
    ["default", "outline"],
  );
  for (const button of b.buttons()) {
    assert.equal(button.props.className, undefined, "Consumer leaves control geometry to Button");
    const icon = elements(button, (item) => ["Check", "X"].includes(item.type))[0];
    assert.ok(icon);
    assert.equal(icon.props.className, undefined, "Shared Button owns the 18px icon scale");
  }
  b.click("Confirm");
  const spinner = elements(b.tree, (item) => item.type === "Loader2")[0];
  assert.equal(spinner.props.className, "animate-spin");
  pending.resolve(response({ ok: false, error: REVIEW_CHAT_ACTION_RECONNECT }, 400));
  await f.flush();
  assert.deepEqual(b.buttons().map(label), ["Retry", "Cancel"]);
  assert.deepEqual(
    b.buttons().map((button) => button.props.variant),
    ["default", "outline"],
  );
});

test("late action feedback never steals focus from a later input, navigation, or hidden card", async () => {
  for (const interruption of ["input", "input then body", "URL", "hidden", "inert"]) {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    const b = f.mount(reviewChatActionConfirmations()[1]);
    b.click("Confirm");
    if (interruption.startsWith("input")) {
      new f.Node("unrelated composer draft").focus();
      if (interruption.endsWith("body")) f.document.body.focus();
    }
    if (interruption === "URL") f.window.location.href += "/elsewhere";
    pending.resolve(response({ ok: false, error: REVIEW_CHAT_ACTION_RECONNECT }, 400));
    await f.flush({ frames: false });
    if (interruption === "hidden") b.feedback().node.hidden = true;
    if (interruption === "inert") b.feedback().node.inert = true;
    const focused = f.document.activeElement;
    f.framesNow();
    assert.equal(f.document.activeElement, focused, interruption);
    assert.equal(f.listeners.size, 0);
    assert.equal(label(b.feedback()), REVIEW_CHAT_ACTION_RECONNECT);
  }
});

test("unmount or replacing an action invalidates late updates, stale clicks, and queued focus", async () => {
  for (const interruption of ["unmount pending", "replace pending", "unmount frame"]) {
    const pending = deferred();
    const f = fixture(() => pending.promise);
    const [complete, initial] = reviewChatActionConfirmations();
    const b = f.mount(initial);
    const old = b.click("Confirm");
    if (interruption === "unmount pending") b.unmount();
    if (interruption === "replace pending") b.replace(complete);
    pending.resolve(response({ ok: false, error: REVIEW_CHAT_ACTION_RECONNECT }, 400));
    await f.flush({ frames: false });
    if (interruption === "unmount frame") b.unmount();
    const focused = f.document.activeElement;
    f.framesNow();
    old.props.onClick({ currentTarget: old.node });
    assert.equal(f.requests.length, 1);
    assert.equal(f.updates.length, interruption === "unmount frame" ? 1 : 0, interruption);
    assert.equal(f.document.activeElement, focused);
    assert.equal(f.listeners.size, 0);
  }
});

test("non-reconnect and uncertain results remain truthful and do not gain unsafe Retry", async () => {
  const failure =
    "Google could not confirm whether the action completed. Check Google before trying again.";
  const f = fixture(async () => response({ ok: false, error: failure }, 400));
  const b = f.mount(reviewChatActionConfirmations()[1]);
  b.click("Confirm");
  await f.flush();
  assert.equal(label(b.feedback()), failure);
  assert.equal(b.buttons().length, 0);
  const uncertain = f.mount({ ...b.confirm, status: "uncertain" });
  assert.equal(uncertain.feedback().props.role, "alert");
  assert.equal(uncertain.buttons().length, 0);
});

test("reconciled pending Gmail send keeps its recovery explanation inside the card", async () => {
  const f = fixture(async (url, init) => {
    if (init?.method === "POST") throw new Error("Connection lost");
    assert.match(url, /\/api\/chat\/confirm\?action_id=/);
    return response({ ok: true, status: "pending" });
  });
  const b = f.mount({ ...reviewChatActionConfirmations()[1], tool: "gmail_send" });
  b.click("Send");
  await f.flush();
  assert.equal(b.confirm.status, "pending");
  assert.equal(b.feedback().props.role, "alert");
  assert.match(label(b.feedback()), /Review the email before trying again/);
  assert.deepEqual(b.buttons().map(label), ["Send", "Cancel"]);
  assert.equal(f.requests.length, 2);
});

test("the chat update path targets the exact action and does not modify the separate composer", () => {
  const source = readFileSync("src/routes/index.tsx", "utf8");
  const update = source.slice(
    source.indexOf("onUpdatePendingConfirm={(messageId, next)"),
    source.indexOf("onFollowUp={", source.indexOf("onUpdatePendingConfirm={(messageId, next)")),
  );
  assert.match(update, /if \(c\.id !== active\.id\) return c/);
  assert.match(update, /msg\.id !== messageId/);
  assert.match(update, /pc\.actionId === next\.actionId \? next : pc/);
  assert.doesNotMatch(update, /setInput|setAttachments|\bsend\(/);
});
