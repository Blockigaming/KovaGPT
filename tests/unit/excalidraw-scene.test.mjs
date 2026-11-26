import assert from "node:assert/strict";
import test from "node:test";
import {
  serializeExcalidrawDrawing,
  summarizeExcalidrawScene,
} from "../../src/lib/excalidraw-scene.mjs";

test("Excalidraw scene attachments contain bounded text and layout without links or embedded files", () => {
  const payload = {
    type: "excalidraw",
    version: 2,
    elements: [
      { type: "text", text: "Decision", x: 10, y: 20, link: "private-link" },
      { type: "text", text: "deleted text", isDeleted: true },
      { type: "arrow", x: 29.2, y: 21.8 },
      { type: "script", text: "unexpected" },
    ],
    appState: { private: "private-state" },
    files: { first: { dataURL: "private-media" } },
  };
  const summary = summarizeExcalidrawScene(JSON.stringify(payload));
  assert.deepEqual(JSON.parse(summary).elements, [
    { type: "text", text: "Decision", position: [10, 20] },
    { type: "arrow", position: [29, 22] },
  ]);
  assert.doesNotMatch(summary, /private|deleted text|unexpected/);
  assert.throws(() => summarizeExcalidrawScene('{"type":"excalidraw","version":1}'), /version 2/);
});

test("Kova strokes export as editable Excalidraw freedraw elements", () => {
  const raw = serializeExcalidrawDrawing(
    [
      {
        color: "#ffffff",
        width: 5,
        points: [
          [30, 40],
          [12, 55],
        ],
      },
    ],
    "#202020",
  );
  const scene = JSON.parse(raw);
  assert.equal(scene.type, "excalidraw");
  assert.equal(scene.version, 2);
  assert.equal(scene.appState.viewBackgroundColor, "#202020");
  assert.deepEqual(scene.elements[0].points, [
    [0, 0],
    [-18, 15],
  ]);
  assert.equal(scene.elements[0].type, "freedraw");
  assert.equal(scene.elements[0].strokeWidth, 5);
  assert.deepEqual(JSON.parse(summarizeExcalidrawScene(raw)).elements, [
    { type: "freedraw", position: [30, 40] },
  ]);
});
