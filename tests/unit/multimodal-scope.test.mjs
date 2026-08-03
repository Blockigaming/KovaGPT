import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");

test("provider voice remains disabled while local browser read-aloud needs no AI secret", () => {
  const matrix = read("docs/kova-final-completion-matrix.md");
  const chatInput = read("src/components/ChatInput.tsx");
  const chatMessage = read("src/components/ChatMessage.tsx");
  const start = read("src/start.ts");
  const server = read("src/server.ts");

  assert.match(matrix, /Voice: INTENTIONALLY DISABLED/);
  assert.doesNotMatch(chatInput, /createSpeechRecognition|Start voice input|MicOff/);
  assert.match(chatMessage, /speechSynthesis/);
  assert.match(chatMessage, /Read aloud/);
  assert.doesNotMatch(chatMessage, /OPENAI_API_KEY|audio\/speech|realtime/);
  assert.match(start, /microphone=\(\)/);
  assert.match(server, /microphone=\(\)/);
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
