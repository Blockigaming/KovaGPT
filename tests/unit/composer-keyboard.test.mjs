import assert from "node:assert/strict";
import test from "node:test";

import { shouldSubmitComposerOnEnter } from "../../src/lib/composer-keyboard.mjs";

test("plain Enter follows the desktop send preference", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      sendOnEnter: true,
      isMobileLayout: false,
    }),
    true,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      sendOnEnter: false,
      isMobileLayout: false,
    }),
    false,
  );
});

test("Shift+Enter, Alt+Enter, IME composition, and keyCode 229 preserve text entry", () => {
  for (const event of [
    { key: "Enter", shiftKey: true },
    { key: "Enter", altKey: true },
    { key: "Enter", isComposing: true },
    { key: "Enter", keyCode: 229 },
    { key: "Process", keyCode: 229 },
  ]) {
    assert.equal(
      shouldSubmitComposerOnEnter({
        ...event,
        sendOnEnter: true,
        isMobileLayout: false,
      }),
      false,
    );
  }
});

test("mobile and coarse-pointer Enter insert a newline", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      sendOnEnter: true,
      isMobileLayout: true,
    }),
    false,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      sendOnEnter: true,
      isMobileLayout: false,
      isCoarsePointer: true,
    }),
    false,
  );
});

test("Ctrl/Command+Enter is an explicit submit shortcut", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      ctrlKey: true,
      sendOnEnter: false,
      isMobileLayout: true,
    }),
    true,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      metaKey: true,
      sendOnEnter: false,
      isCoarsePointer: true,
    }),
    true,
  );
});

test("empty, disabled, and streaming composers never submit from the keyboard", () => {
  for (const state of [
    { hasContent: false },
    { disabled: true },
    { isStreaming: true },
  ]) {
    assert.equal(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        ctrlKey: true,
        sendOnEnter: true,
        ...state,
      }),
      false,
    );
  }
});

test("non-Enter keys never submit", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Tab",
      sendOnEnter: true,
      isMobileLayout: false,
    }),
    false,
  );
});
