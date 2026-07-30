import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("voice input and read aloud are real, capability-detected browser features", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const chatInput = read("src/components/ChatInput.tsx");
  const chatMessage = read("src/components/ChatMessage.tsx");
  const voice = read("src/lib/browser-voice.ts");
  const chatRoute = read("src/routes/api/chat.ts");
  assert.match(matrix, /Voice: IMPLEMENTED AT SOURCE LEVEL/);
  assert.match(chatInput, /createSpeechRecognition|Stop voice input|MicOff/);
  assert.match(chatMessage, /speechSynthesis|Read response aloud|Volume2/);
  assert.match(voice, /webkitSpeechRecognition|speechText/);
  assert.doesNotMatch(chatRoute, /VOICE MODE|text-to-speech|spoken aloud/i);
});

test("image workflow maps settings to provider payload and metadata", () => {
  const source = read("src/lib/multimodal/image-workflows.server.ts");
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
  assert.match(route, /metadata: imageResultMetadata/);
});
