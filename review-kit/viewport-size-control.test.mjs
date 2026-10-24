import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { SIZES, reviewViewportSizeScript } from "./private-http-review.mjs";

// In-process DOM-contract checks only; no browser or app-state outcome claim.
function harness({ productPresent = true, buttonPresent = true } = {}) {
  const writes = [];
  const frame = {
    style: new Proxy(
      { width: "1440px", height: "900px" },
      {
        set(target, property, value) {
          assert.ok(["width", "height"].includes(property));
          writes.push(property);
          target[property] = value;
          return true;
        },
      },
    ),
    _title: "Original frame title",
    get title() {
      return this._title;
    },
    set title(value) {
      writes.push("title");
      this._title = value;
    },
    get contentWindow() {
      assert.fail("Resizing must not read or modify the app document");
    },
    set src(_) {
      assert.fail("Resizing must not navigate or reload the frame");
    },
    set srcdoc(_) {
      assert.fail("Resizing must not replace the frame document");
    },
  };
  const button = {};
  const choice = { value: "phone" };
  const status = { textContent: "" };
  const nodes = {
    "apply-selected-size": buttonPresent ? button : null,
    product: productPresent ? frame : null,
    "review-size": choice,
    "review-size-status": status,
  };
  runInNewContext(reviewViewportSizeScript(), {
    document: {
      getElementById(id) {
        assert.ok(
          Object.hasOwn(nodes, id),
          "Only the size controller and existing frame may be read",
        );
        return nodes[id];
      },
    },
  });
  return { frame, button, choice, status, writes };
}

test("the size control is inert until user activation and changes only the same frame's dimensions and title", () => {
  const { frame, button, choice, status, writes } = harness();
  assert.deepEqual(writes, []);
  assert.equal(frame.style.width, "1440px");
  assert.equal(frame.title, "Original frame title");
  const originalFrame = frame;
  for (const [key, size] of Object.entries(SIZES)) {
    choice.value = key;
    const before = writes.length;
    button.onclick();
    assert.equal(frame, originalFrame);
    assert.deepEqual(writes.slice(before), ["width", "height", "title"]);
    assert.equal(frame.style.width, size.width + "px");
    assert.equal(frame.style.height, size.height + "px");
    assert.equal(
      frame.title,
      `Kova synthetic review, ${size.width} by ${size.height} pixel CSS viewport`,
    );
    assert.match(status.textContent, /same mounted app frame/);
    assert.match(status.textContent, /Existing session retained; no navigation or reset/);
  }
  choice.value = "phone";
  button.onclick();
  assert.equal(frame.style.width, "390px");
  assert.equal(frame.style.height, "844px");
});

test("unknown or inherited choices cannot resize, and no active frame means no mutation", () => {
  const { frame, button, choice, status, writes } = harness();
  for (const invalid of [
    "",
    "unknown",
    "390",
    "phone?reset=1",
    "__proto__",
    "constructor",
    "toString",
    "https://outside.invalid",
    undefined,
    null,
  ]) {
    choice.value = invalid;
    button.onclick();
    assert.deepEqual(writes, []);
    assert.equal(frame.style.width, "1440px");
    assert.equal(frame.style.height, "900px");
    assert.equal(frame.title, "Original frame title");
    assert.equal(status.textContent, "Choose a listed size in an active review session.");
  }
  const missing = harness({ productPresent: false });
  missing.button.onclick();
  assert.deepEqual(missing.writes, []);
  assert.match(missing.status.textContent, /active review session/);
  assert.deepEqual(harness({ buttonPresent: false }).writes, []);
});

test("the controller exposes a separate non-submit button and preserves all navigation, storage and service boundaries", () => {
  const source = readFileSync(new URL("./private-http-review.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /<button id="apply-selected-size" type="button"\$\{session \? "" : " disabled"\}>Apply selected size<\/button>/,
  );
  assert.match(source, /<p id="review-size-status" role="status"><\/p>/);
  assert.match(source, /CSS viewport sizes, not physical-device certification/);
  assert.match(
    source,
    /<script id="review-viewport-size">\$\{reviewViewportSizeScript\(\)\}<\/script>/,
  );
  const script = reviewViewportSizeScript();
  assert.doesNotMatch(
    script,
    /fetch\(|XMLHttpRequest|\.src\s*=|srcdoc|contentWindow|location|localStorage|sessionStorage|indexedDB|submit\(|review-account|review-scenario|review-theme|review-state|review-path|history\.|innerHTML/,
  );
  assert.ok(script.includes(JSON.stringify(SIZES)));
});
