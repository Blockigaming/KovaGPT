const ELEMENT_TYPES = new Set([
  "arrow",
  "diamond",
  "ellipse",
  "embeddable",
  "frame",
  "freedraw",
  "image",
  "line",
  "magicframe",
  "rectangle",
  "text",
]);

export function summarizeExcalidrawScene(source) {
  let scene;
  try {
    scene = JSON.parse(source);
  } catch {
    throw new Error("This file is not a valid Excalidraw scene.");
  }
  if (scene?.type !== "excalidraw" || scene.version !== 2 || !Array.isArray(scene.elements)) {
    throw new Error("Select an Excalidraw version 2 scene file.");
  }
  const elements = [];
  for (const element of scene.elements) {
    if (!ELEMENT_TYPES.has(element?.type) || element.isDeleted) continue;
    const entry = { type: element.type };
    if (element.type === "text" && typeof element.text === "string") {
      entry.text = element.text.slice(0, 500);
    }
    // Preserve the diagram layout without bringing in embedded files, URLs,
    // element metadata, or instructions from its application state.
    if (Number.isFinite(element.x) && Number.isFinite(element.y)) {
      entry.position = [Math.round(element.x), Math.round(element.y)];
    }
    elements.push(entry);
    if (elements.length === 100) break;
  }
  return JSON.stringify({ kind: "Excalidraw diagram", elements }, null, 2);
}

export function serializeExcalidrawDrawing(strokes, background) {
  const elements = strokes.map(({ points, color, width: strokeWidth }, index) => {
    const [x, y] = points[0];
    const relative = points.map(([pointX, pointY]) => [pointX - x, pointY - y]);
    if (relative.length === 1) relative.push([0.01, 0.01]);
    const xs = relative.map(([pointX]) => pointX);
    const ys = relative.map(([, pointY]) => pointY);
    return {
      id: `kova-stroke-${index}`,
      type: "freedraw",
      x,
      y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      angle: 0,
      points: relative,
      pressures: relative.map(() => 0.5),
      simulatePressure: false,
      strokeColor: color,
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      boundElements: null,
      roundness: null,
      frameId: null,
      link: null,
      locked: false,
      seed: index + 1,
      version: 1,
      versionNonce: index + 1,
      isDeleted: false,
      updated: 0,
      lastCommittedPoint: null,
    };
  });
  return JSON.stringify({
    type: "excalidraw",
    version: 2,
    source: "https://kovagpt.com",
    elements,
    appState: { viewBackgroundColor: background },
    files: {},
  });
}
