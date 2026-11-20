import assert from "node:assert/strict";
import test from "node:test";
import { parseCloudBrowserControl as parse } from "../../src/lib/cloud-browser-control.ts";

test("Browserbase control accepts bounded viewport changes and same-frame pointer input", () => {
  const frame = "75361397-312d-4be8-8123-9f6de919b17a";
  for (const action of [
    { kind: "takeover" },
    { kind: "release" },
    { kind: "frame" },
    { kind: "frame", width: 320, height: 644 },
    { kind: "click", frame, x: 100, y: 20 },
    { kind: "scroll", frame, x: 100, y: 20, deltaX: 0, deltaY: 200 },
    { kind: "input", text: "public search" },
  ]) {
    assert.deepEqual(parse(action), action);
  }
});

test("Browserbase input rejects URLs, unknown actions, and oversized or malformed activity", () => {
  for (const action of [
    { kind: "navigate", url: "https://example.com" },
    { kind: "takeover", ownerId: "another-principal" },
    { kind: "frame", width: 1601, height: 644 },
    { kind: "frame", width: 320 },
    { kind: "click", frame: "unverified", x: 100, y: 20 },
    { kind: "input", text: "😊".repeat(800) },
    { kind: "key", key: "Control+L" },
  ]) {
    assert.equal(parse(action), null);
  }
});
