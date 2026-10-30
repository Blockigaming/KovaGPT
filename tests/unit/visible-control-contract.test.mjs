import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { inspectVisibleControlContract } from "../../scripts/release/visible-control-contract.mjs";
import { inspectBrowserVoiceSource } from "../../scripts/release/voice-unavailable-contract.mjs";

test("visible product controls are backed or explicitly absent", () => {
  assert.deepEqual(inspectVisibleControlContract(), []);
});

test("selected-file preparation never grants microphone or provider bypass permission", async () => {
  const panel = await readFile(
    new URL("../../src/components/AudioToolsPanel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(panel, /type="file"/);
  assert.match(panel, /prepareVoiceRecording\(file, \{ signal: controller.signal \}\)/);
  assert.deepEqual(
    inspectVisibleControlContract({ files: ["src/components/AudioToolsPanel.tsx"] }),
    [],
  );
  assert.deepEqual(inspectBrowserVoiceSource(panel, { allowFilePreparation: true }).errors, []);
  assert.match(inspectBrowserVoiceSource(panel).errors.join("\n"), /audio preparation/);
  for (const added of [
    "navigator.mediaDevices.getUserMedia({ audio: true })",
    "new MediaRecorder(stream)",
  ]) {
    assert.match(
      inspectBrowserVoiceSource(`${panel}\n${added}`, { allowFilePreparation: true }).errors.join(
        "\n",
      ),
      /microphone capture/,
    );
  }
  for (const added of [
    "ELEVENLABS_API_KEY",
    'fetch("https://api.elevenlabs.io/v1/speech-to-text")',
    "new SpeechSynthesisUtterance(text)",
  ]) {
    assert.match(
      inspectBrowserVoiceSource(`${panel}\n${added}`, { allowFilePreparation: true }).errors.join(
        "\n",
      ),
      /provider\/credential bypass/,
    );
  }
  const contract = await readFile(
    new URL("../../scripts/release/visible-control-contract.mjs", import.meta.url),
    "utf8",
  );
  assert.match(contract, /allowMicrophone: path === "src\/components\/ComposerVoiceDialog.tsx"/);
  assert.match(contract, /allowFilePreparation: path === "src\/components\/AudioToolsPanel.tsx"/);
});

test("visible-control audit tolerates a tracked file deleted before staging", () => {
  assert.deepEqual(
    inspectVisibleControlContract({
      files: ["src/lib/deleted-before-stage.ts"],
    }),
    [],
  );
});

test("Voice remains required and provider dependent without claiming live operation", async () => {
  const registry = await readFile(
    new URL("../../src/lib/capability-registry.ts", import.meta.url),
    "utf8",
  );
  assert.match(registry, /voiceScope: "required_provider_dependent"/u);
  assert.match(registry, /voice:[\s\S]*availability: "provider-dependent"/u);
  assert.match(registry, /Microphone conversations require explicit Start and Finish turn/u);
  assert.match(registry, /commercial entitlement/u);
  assert.doesNotMatch(registry, /Voice is intentionally outside/u);
});
