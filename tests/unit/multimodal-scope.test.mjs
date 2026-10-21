import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("interactive Voice uses the server-backed dialog while browser-native speech stays excluded", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const capabilityRegistry = read("src/lib/capability-registry.ts");
  const chatInput = read("src/components/ChatInput.tsx");
  const chatMessage = read("src/components/ChatMessage.tsx");
  const start = read("src/start.ts");
  const server = read("src/server.ts");

  assert.match(matrix, /Voice: REQUIRED \/ PROVIDER-DEPENDENT/);
  assert.match(capabilityRegistry, /voiceScope: "required_provider_dependent"/);
  assert.match(capabilityRegistry, /voice:[\s\S]*availability: "provider-dependent"/);
  for (const source of [chatInput, chatMessage]) {
    assert.doesNotMatch(
      source,
      /SpeechRecognition|webkitSpeechRecognition|speechSynthesis|SpeechSynthesisUtterance|OPENAI_API_KEY|ELEVENLABS_API_KEY|xi-api-key|api\.elevenlabs\.io|api\.openai\.com/i,
    );
  }
  assert.match(chatInput, /<ComposerVoiceDialog\b/u);
  assert.match(chatInput, /onVoiceSubmit=\{/u);
  assert.match(chatInput, /latestAssistantText=\{/u);
  assert.doesNotMatch(chatMessage, /OPENAI_API_KEY|audio\/speech|realtime/);
  assert.match(start, /microphone=\(self\)/g);
  assert.match(server, /microphone=\(self\)/g);
});

test("image workflow maps settings to provider payload and metadata", () => {
  const source =
    read("src/lib/multimodal/image-workflows.server.ts") +
    read("src/lib/multimodal/image-request-policy.mjs");
  const route = read("src/routes/api/generate-image.ts");
  for (const token of [
    "ImageOperation",
    "variation",
    "edit",
    "transparentBackground",
    "imageProviderPayload",
    "imageResultMetadata",
    "imageActionSet",
    "parentImageId",
  ]) {
    assert.match(source, new RegExp(`\\b${token}\\b`), `image workflow should include ${token}`);
  }
  assert.match(route, /normalizeImageSettings/);
  assert.match(route, /imageResultMetadata\(settings\)/);
});
