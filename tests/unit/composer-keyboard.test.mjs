import assert from "node:assert/strict";
import test from "node:test";

import { shouldSubmitComposerOnEnter } from "../../src/lib/composer-keyboard.mjs";

test("plain Enter follows the desktop send preference", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({ key: "Enter", sendOnEnter: true, isMobileLayout: false }),
    true,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({ key: "Enter", sendOnEnter: false, isMobileLayout: false }),
    false,
  );
});

test("Shift+Enter and composition always preserve text entry", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      shiftKey: true,
      sendOnEnter: true,
      isMobileLayout: false,
    }),
    false,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      isComposing: true,
      sendOnEnter: true,
      isMobileLayout: false,
    }),
    false,
  );
});

test("mobile Enter inserts a newline and an explicit shortcut can still submit", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({ key: "Enter", sendOnEnter: true, isMobileLayout: true }),
    false,
  );
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
      isMobileLayout: false,
    }),
    true,
  );
});

test("Alt+Enter and non-Enter keys never submit", () => {
  assert.equal(
    shouldSubmitComposerOnEnter({
      key: "Enter",
      altKey: true,
      sendOnEnter: true,
      isMobileLayout: false,
    }),
    false,
  );
  assert.equal(
    shouldSubmitComposerOnEnter({ key: "Tab", sendOnEnter: true, isMobileLayout: false }),
    false,
  );
});
