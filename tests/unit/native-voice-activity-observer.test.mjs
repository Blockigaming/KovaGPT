import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const source = readFileSync("ios-native/Sources/KovaGPTApp.swift", "utf8");
const script = source.match(/private static let voiceObserver = """([\s\S]*?)"""/u)[1];

function fixture({ origin = "https://kovagpt.com", subframe = false } = {}) {
  const sent = [];
  let observed;
  let pagehide;
  let phase = null;
  const window = {
    webkit: {
      messageHandlers: {
        kovaVoiceActivity: { postMessage: (value) => sent.push(JSON.parse(JSON.stringify(value))) },
      },
    },
    addEventListener(name, callback) {
      if (name === "pagehide") pagehide = callback;
    },
  };
  window.top = subframe ? {} : window;
  const document = {
    documentElement: {},
    querySelector(selector) {
      assert.equal(selector, '.kova-voice-dialog[data-voice-mode="voice"]');
      return phase === null ? null : { getClientRects: () => [1], getAttribute: () => phase };
    },
  };
  class MutationObserver {
    constructor(callback) {
      observed = callback;
    }
    observe() {}
  }
  vm.runInNewContext(script, { window, document, MutationObserver, location: { origin } });
  return {
    sent,
    phase(value) {
      phase = value;
      observed();
    },
    hide() {
      pagehide();
    },
  };
}

test("native voice activity observes real DOM phases with no audio/transcript collection", () => {
  const f = fixture();
  assert.deepEqual(f.sent, [{ phase: "inactive" }]);
  f.phase("recording");
  f.phase("recording");
  f.phase("transcribing");
  f.phase("speaking");
  f.phase(null);
  assert.deepEqual(f.sent, [
    { phase: "inactive" },
    { phase: "recording" },
    { phase: "transcribing" },
    { phase: "speaking" },
    { phase: "inactive" },
  ]);
  f.hide();
  assert.deepEqual(f.sent.at(-1), { phase: "inactive" });
});
test("voice activity cannot publish from a subframe or another website", () => {
  assert.deepEqual(fixture({ subframe: true }).sent, []);
  assert.deepEqual(fixture({ origin: "https://kovagpt.com.attacker.invalid" }).sent, []);
  assert.deepEqual(fixture({ origin: "http://kovagpt.com" }).sent, []);
});
