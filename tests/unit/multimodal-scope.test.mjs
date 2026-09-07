import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("provider voice and browser read-aloud remain absent", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const chatInput = read("src/components/ChatInput.tsx");
  const chatMessage = read("src/components/ChatMessage.tsx");
  const start = read("src/start.ts");
  const server = read("src/server.ts");

  assert.match(matrix, /Voice: INTENTIONALLY DISABLED/);
  for (const source of [chatInput, chatMessage]) {
    assert.doesNotMatch(
      source,
      /SpeechRecognition|webkitSpeechRecognition|speechSynthesis|SpeechSynthesisUtterance|Start voice input|Read aloud|MicOff|Dictate|dictation/i,
    );
  }
  assert.doesNotMatch(chatMessage, /OPENAI_API_KEY|audio\/speech|realtime/);
  assert.match(start, /microphone=\(\)/g);
  assert.match(server, /microphone=\(\)/g);
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
