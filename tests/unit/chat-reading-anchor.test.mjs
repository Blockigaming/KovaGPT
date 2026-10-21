import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync("src/lib/chat-reading-anchor.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const {
  captureTranscriptReadingAnchor: capture,
  restoreTranscriptReadingAnchor: restore,
  createTranscriptReadingAnchorController: controller,
} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

// A deterministic layout adapter: text rewraps when the viewport changes width.
// Tests execute the real capture/search/controller functions; this is not pixel QA.
function fixture() {
  const events = new Map(),
    windowEvents = new Map(),
    frames = new Map();
  const observers = [],
    mutations = [],
    writes = [];
  let frameId = 0,
    top = 0;
  const listen = (map, type, fn) => {
    if (!map.has(type)) map.set(type, new Set());
    map.get(type).add(fn);
  };
  const window = {
    requestAnimationFrame(fn) {
      const id = ++frameId;
      frames.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    addEventListener(type, fn) {
      listen(windowEvents, type, fn);
    },
    removeEventListener(type, fn) {
      windowEvents.get(type)?.delete(fn);
    },
    ResizeObserver: class {
      targets = new Set();
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(target) {
        this.targets.add(target);
      }
      unobserve(target) {
        this.targets.delete(target);
      }
      disconnect() {
        this.targets.clear();
      }
    },
    MutationObserver: class {
      connected = false;
      constructor(callback) {
        this.callback = callback;
        mutations.push(this);
      }
      observe() {
        this.connected = true;
      }
      disconnect() {
        this.connected = false;
      }
    },
  };
  const document = {
    defaultView: window,
    createTreeWalker(message) {
      let read = false;
      return {
        nextNode() {
          if (read) return null;
          read = true;
          return message.text;
        },
      };
    },
    createRange() {
      let node,
        start = 0,
        end = 0;
      return {
        selectNodeContents(next) {
          node = next;
          start = 0;
          end = next.data.length;
        },
        setStart(next, offset) {
          node = next;
          start = offset;
        },
        setEnd(next, offset) {
          node = next;
          end = offset;
        },
        getClientRects() {
          const result = [];
          const columns = Math.max(1, Math.floor((element.clientWidth - 20) / 8));
          for (let index = start; index < end;) {
            const line = Math.floor(index / columns);
            const stop = Math.min(end, (line + 1) * columns);
            result.push(
              rect(
                20 + (element.textShift ?? 0) + (index % columns) * 8,
                node.parentElement.getBoundingClientRect().top + 10 + line * 20,
                (stop - index) * 8,
                20,
              ),
            );
            index = stop;
          }
          return result;
        },
      };
    },
  };
  const element = {
    ownerDocument: document,
    clientWidth: 320,
    clientHeight: 220,
    clientTop: 0,
    clientLeft: 0,
    style: { scrollBehavior: "smooth", overflowAnchor: "auto" },
    messages: [],
    get scrollHeight() {
      return this.messages.reduce((sum, message) => sum + message.height(), 0);
    },
    get scrollTop() {
      return top;
    },
    set scrollTop(value) {
      top = Math.max(0, Math.min(value, Math.max(0, this.scrollHeight - this.clientHeight)));
      writes.push({ top, behavior: this.style.scrollBehavior });
    },
    getBoundingClientRect() {
      return rect(10, 100, this.clientWidth, this.clientHeight);
    },
    querySelectorAll() {
      return this.messages;
    },
    addEventListener(type, fn) {
      listen(events, type, fn);
    },
    removeEventListener(type, fn) {
      events.get(type)?.delete(fn);
    },
  };
  for (let index = 0; index < 30; index++) {
    const message = {
      dataset: { messageId: `message-${index}` },
      ownerDocument: document,
      closest() {
        return null;
      },
      contains(node) {
        return node === this.text;
      },
      height() {
        const columns = Math.max(1, Math.floor((element.clientWidth - 20) / 8));
        return Math.ceil(this.text.data.length / columns) * 20 + 20;
      },
      getBoundingClientRect() {
        const before = element.messages
          .slice(0, element.messages.indexOf(this))
          .reduce((sum, item) => sum + item.height(), 0);
        return rect(10, 100 + before - element.scrollTop, element.clientWidth, this.height());
      },
    };
    message.text = {
      data:
        `Message ${index}: ` +
        Array.from({ length: 170 }, (_, i) => i.toString(36).padStart(3, "0")).join(" "),
      ownerDocument: document,
      parentElement: message,
    };
    element.messages.push(message);
  }
  function emit(type, extra = {}) {
    for (const fn of [...(events.get(type) ?? [])]) fn({ type, ...extra });
  }
  function emitWindow(type) {
    for (const fn of [...(windowEvents.get(type) ?? [])]) fn({ type });
  }
  function resized(width, height = element.clientHeight) {
    element.clientWidth = width;
    element.clientHeight = height;
    for (const observer of observers)
      observer.callback([...observer.targets].map((target) => ({ target })));
  }
  function mutated() {
    for (const observer of mutations) if (observer.connected) observer.callback([]);
  }
  function flush() {
    const current = [...frames.values()];
    frames.clear();
    for (const fn of current) fn();
  }
  function readInside(index = 23, line = 4, clipped = 7) {
    const before = element.messages.slice(0, index).reduce((sum, item) => sum + item.height(), 0);
    element.scrollTop = before + 10 + line * 20 + clipped;
    writes.length = 0;
  }
  function lineOffset(anchor) {
    const range = document.createRange();
    range.setStart(anchor.text.node, anchor.text.offset);
    range.setEnd(anchor.text.node, anchor.text.offset + 1);
    return range.getClientRects()[0].top - element.getBoundingClientRect().top;
  }
  return {
    element,
    emit,
    emitWindow,
    resized,
    mutated,
    flush,
    readInside,
    lineOffset,
    writes,
    frames,
    observers,
    mutations,
    events,
    windowEvents,
  };
}

test("reflow preserves the same character/line while numeric scrollTop and message-top offset change", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  assert.equal(anchor.kind, "content");
  assert.equal(anchor.messageId, "message-23");
  assert.equal(anchor.text.viewportOffset, -7);
  const oldTop = f.element.scrollTop;
  f.element.clientWidth = 590;
  const result = restore(f.element, anchor);
  assert.equal(result.reason, "text-line");
  assert.equal(result.applied, true);
  assert.notEqual(f.element.scrollTop, oldTop);
  assert.equal(f.lineOffset(anchor), -7);
  assert.equal(f.writes.at(-1).behavior, "auto");
  assert.equal(f.element.style.scrollBehavior, "smooth");
});

test("every transition frame and breakpoint resize preserves the cached text anchor", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  assert.equal(f.element.style.overflowAnchor, "none");
  for (const width of [340, 380, 420, 470, 510, 590, 768, 1023, 1024, 830, 320]) {
    f.resized(width);
    assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset, `width${width}`);
    f.emit("scroll"); // A correction scroll is not a new reading target.
  }
  c.dispose();
  assert.equal(f.element.style.overflowAnchor, "auto");
});

test("a browser clamp scroll before ResizeObserver does not replace the pre-reflow passage", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.element.clientWidth = 1024;
  // Shrinking content height may clamp scrollTop and emit scroll before the resize receipt.
  f.element.scrollTop = f.element.scrollTop;
  assert.notEqual(f.lineOffset(anchor), anchor.text.viewportOffset);
  f.emit("scroll");
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  assert.equal(f.frames.size, 0);
  f.resized(1024);
  f.emit("scroll");
  f.flush();
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  c.dispose();
});

test("real scrolling during a transition rebases and no longer restores the previous passage", () => {
  const f = fixture();
  f.readInside();
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.resized(420);
  f.emit("scroll");
  f.emit("wheel");
  f.readInside(9, 2, 3);
  f.emit("scroll");
  f.flush();
  const next = capture(f.element);
  assert.equal(next.messageId, "message-9");
  f.resized(590);
  assert.equal(f.lineOffset(next), next.text.viewportOffset);
  c.dispose();
});

test("a user scroll pending in the same frame takes priority over resize compensation", () => {
  const f = fixture();
  f.readInside();
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.emit("touchstart");
  f.readInside(8, 2, 4);
  f.emit("scroll");
  const top = f.element.scrollTop;
  f.resized(340);
  assert.equal(f.element.scrollTop, top);
  f.flush();
  const next = capture(f.element);
  assert.notEqual(next.messageId, "message-23");
  f.resized(590);
  assert.equal(f.lineOffset(next), next.text.viewportOffset);
  c.dispose();
});

test("a click or non-scrolling key during reflow does not replace the reading target", () => {
  for (const type of ["pointerdown", "touchstart", "keydown", "wheel"]) {
    const f = fixture();
    f.readInside();
    const anchor = capture(f.element);
    const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
    f.emit(type, { key: " " });
    f.resized(590);
    f.flush();
    assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset, type);
    c.dispose();
  }
});

test("an ongoing touch or scrollbar gesture can keep scrolling across resize frames", () => {
  for (const [start, end] of [
    ["touchstart", "touchend"],
    ["pointerdown", "pointerup"],
  ]) {
    const f = fixture();
    f.readInside();
    const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
    f.emit(start);
    f.readInside(15, 1, 2);
    f.emit("scroll");
    f.flush();
    // The next manual scroll arrives after width changes but before its RO callback.
    f.element.clientWidth = 420;
    f.readInside(9, 2, 3);
    f.emit("scroll");
    const next = capture(f.element);
    f.resized(420);
    f.flush();
    assert.equal(f.lineOffset(next), next.text.viewportOffset);
    f.emitWindow(end);
    f.resized(590);
    assert.equal(f.lineOffset(next), next.text.viewportOffset);
    c.dispose();
  }
});

test("unprompted non-clamp scrolls during reflow remain navigation rather than compensation", () => {
  const f = fixture();
  f.readInside();
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.element.clientWidth = 340;
  f.readInside(9, 2, 3);
  f.emit("scroll");
  const next = capture(f.element);
  f.resized(340);
  f.flush();
  f.resized(590);
  assert.equal(f.lineOffset(next), next.text.viewportOffset);
  c.dispose();
});

test("bottom-follow retains the end across reflow and manual reading can leave it", () => {
  const f = fixture();
  let following = true;
  f.element.scrollTop = f.element.scrollHeight - f.element.clientHeight;
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => following });
  f.resized(590, 300);
  assert.equal(f.element.scrollTop, f.element.scrollHeight - f.element.clientHeight);
  f.emit("scroll");
  following = false;
  f.emit("keydown", { key: "PageUp" });
  f.readInside(12);
  f.emit("scroll");
  f.flush();
  const next = capture(f.element);
  f.resized(420);
  assert.equal(f.lineOffset(next), next.text.viewportOffset);
  assert.notEqual(f.element.scrollTop, f.element.scrollHeight - f.element.clientHeight);
  c.dispose();
});

test("explicit Jump capture promotes the end before its smooth scroll event", () => {
  const f = fixture();
  f.readInside();
  let following = false;
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => following });
  following = true;
  c.followEnd();
  f.resized(590);
  assert.equal(f.element.scrollTop, f.element.scrollHeight - f.element.clientHeight);
  c.dispose();
});

test("correction scroll changing near-bottom classification cannot replace the cached passage", () => {
  const f = fixture();
  f.readInside();
  let following = false;
  const anchor = capture(f.element);
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => following });
  // Model the React distance callback seeing a transient browser clamp near the end.
  f.element.clientWidth = 1024;
  f.element.scrollTop = f.element.scrollTop;
  following = true;
  f.emit("scroll");
  f.resized(1024);
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  // Reopening captures geometry again after React's near-bottom classification.
  c.capture();
  f.resized(320);
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  c.dispose();
});

test("navigation capture flushes a pending manual-scroll rebase before the next transition", () => {
  const f = fixture();
  let following = true;
  f.element.scrollTop = f.element.scrollHeight - f.element.clientHeight;
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => following });
  following = false;
  f.emit("wheel");
  f.readInside(8, 1, 3);
  f.emit("scroll");
  const anchor = capture(f.element);
  c.capture();
  assert.equal(f.frames.size, 0);
  f.resized(590);
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  c.dispose();
});

test("same passage survives React text-node replacement without a message/component change", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  const message = f.element.messages[23];
  message.text = { ...message.text };
  f.element.clientWidth = 590;
  assert.equal(restore(f.element, anchor).reason, "text-line");
  const replacement = capture(f.element);
  assert.equal(replacement.messageId, anchor.messageId);
  assert.equal(replacement.text.viewportOffset, anchor.text.viewportOffset);
});

test("replacement text with repeated phrases retains the original character offset", () => {
  const f = fixture();
  const message = f.element.messages[23];
  message.text.data = "repeated passage with identical wording ".repeat(50);
  f.readInside(23, 8, 7);
  const anchor = capture(f.element);
  assert.notEqual(anchor.text.node.data.indexOf(anchor.text.signature), anchor.text.offset);
  message.text = { ...message.text };
  f.element.clientWidth = 590;
  assert.equal(restore(f.element, anchor).reason, "text-line");
  assert.equal(f.lineOffset({ ...anchor, text: { ...anchor.text, node: message.text } }), -7);
});

test("the captured character intersects the viewport horizontally as well as vertically", () => {
  const f = fixture();
  f.element.textShift = -80;
  f.readInside(23, 0, 0);
  const anchor = capture(f.element);
  assert.equal(anchor.text.offset, 8);
  assert.equal(anchor.text.viewportOffset, 0);
});

test("earlier-message growth and text-node replacement preserve the current passage", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.element.messages[3].text.data += " earlier content".repeat(150);
  f.element.messages[23].text = { ...f.element.messages[23].text };
  f.mutated();
  const next = capture(f.element);
  assert.equal(next.messageId, anchor.messageId);
  assert.equal(next.text.signature, anchor.text.signature);
  assert.equal(next.text.viewportOffset, anchor.text.viewportOffset);
  c.dispose();
});

test("missing messages clamp safely and hidden transcripts are not repositioned", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  f.element.messages.splice(1);
  const result = restore(f.element, anchor);
  assert.equal(result.reason, "message-removed");
  assert.equal(result.clamped, true);
  assert.equal(f.element.scrollTop, f.element.scrollHeight - f.element.clientHeight);
  const top = f.element.scrollTop;
  f.element.clientHeight = 0;
  assert.equal(capture(f.element), null);
  assert.equal(restore(f.element, anchor).reason, "hidden");
  assert.equal(f.element.scrollTop, top);
});

test("scope changes and disposal cancel observer writes, pending frames and temporary styles", () => {
  const f = fixture();
  f.readInside();
  let current = true;
  const c = controller(f.element, { isCurrent: () => current, isFollowingBottom: () => false });
  f.emit("wheel");
  assert.equal(f.frames.size, 1);
  current = false;
  const top = f.element.scrollTop;
  f.resized(590);
  f.mutated();
  assert.equal(f.element.scrollTop, top);
  c.dispose();
  c.dispose();
  assert.equal(f.frames.size, 0);
  assert.equal(f.observers[0].targets.size, 0);
  assert.equal(f.mutations[0].connected, false);
  assert.equal(
    [...f.events.values()].every((set) => set.size === 0),
    true,
  );
  assert.equal(
    [...f.windowEvents.values()].every((set) => set.size === 0),
    true,
  );
  assert.equal(f.element.style.overflowAnchor, "auto");
});

test("a hidden transcript retains its passage until visible and replacement scope starts independently", () => {
  const f = fixture();
  f.readInside();
  const anchor = capture(f.element);
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.resized(590, 0);
  f.resized(420, 220);
  assert.equal(f.lineOffset(anchor), anchor.text.viewportOffset);
  c.dispose();
  f.readInside(4, 1, 2);
  const replacement = capture(f.element);
  const next = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.resized(590);
  assert.equal(f.lineOffset(replacement), replacement.text.viewportOffset);
  next.dispose();
});

test("start position stays at start and a removed-message mutation drops obsolete observations", () => {
  const f = fixture();
  assert.deepEqual(capture(f.element), { kind: "start" });
  const c = controller(f.element, { isCurrent: () => true, isFollowingBottom: () => false });
  f.resized(590);
  assert.equal(f.element.scrollTop, 0);
  const removed = f.element.messages.pop();
  f.mutated();
  assert.equal(f.observers[0].targets.has(removed), false);
  c.dispose();
});
