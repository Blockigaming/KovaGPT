import assert from "node:assert/strict";
import test from "node:test";
import {
  isApplicationResourceUrl,
  isFatalRuntimeEvent,
} from "../../scripts/release/browser-runtime-events.mjs";

const base = "http://127.0.0.1:8094/";
for (const url of [
  "http://127.0.0.1:8094/assets/app.js",
  "https://127.0.0.1:8094/assets/app.js",
  "https://127.0.0.1:8094/assets/app.css",
]) {
  test(`application resource failure is counted for ${url}`, () => {
    assert.equal(isApplicationResourceUrl(url, base), true);
    assert.equal(isFatalRuntimeEvent({ type: "request_failed", url }, base), true);
    assert.equal(isFatalRuntimeEvent({ type: "http_error", url }, base), true);
  });
}

for (const url of [
  "https://127.0.0.1:8095/assets/app.js",
  "https://unrelated.test:8094/assets/app.js",
  "https://127.0.0.1.attacker.test:8094/assets/app.js",
  "not a URL",
]) {
  test(`unrelated or invalid origin is not mislabeled: ${url}`, () => {
    assert.equal(isApplicationResourceUrl(url, base), false);
    assert.equal(isFatalRuntimeEvent({ type: "request_failed", url }, base), false);
  });
}

test("the default HTTP port upgrades to the default HTTPS port", () => {
  assert.equal(isApplicationResourceUrl("https://localhost/app.js", "http://localhost:80/"), true);
});

test("HTTPS origins do not silently accept downgraded HTTP resources", () => {
  assert.equal(isApplicationResourceUrl("http://localhost/app.js", "https://localhost/"), false);
});

test("the observed 16 upgraded failures cannot be reported as zero fatal events", () => {
  const events = ["image", "stylesheet", "stylesheet", ...Array(13).fill("script")].map(
    (kind, index) => ({
      type: "request_failed",
      detail: `${kind} GET TLS failure`,
      url: `https://127.0.0.1:8094/assets/fixture-${index}`,
    }),
  );
  assert.equal(events.filter((event) => isFatalRuntimeEvent(event, base)).length, 16);
});

test("page failures remain fatal without a resource URL", () => {
  for (const type of [
    "page_crash",
    "page_error",
    "navigation_error",
    "diagnostic_error",
    "hydration_timeout",
  ]) {
    assert.equal(isFatalRuntimeEvent({ type }, base), true);
  }
  assert.equal(isFatalRuntimeEvent({ type: "console_warning" }, base), false);
});
