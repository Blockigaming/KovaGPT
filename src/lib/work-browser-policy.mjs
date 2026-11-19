import { workUuid } from "./work-execution-protocol.mjs";
const fail = () => {
  throw Error("work_browser_input_invalid");
};
export function parseBrowserOwnerInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const allowed = [
    "expectedUserId",
    "runId",
    "sessionId",
    "expectedRevision",
    "expectedSequence",
    "operation",
    "url",
    "view",
    "target",
    "text",
    "key",
    "delta",
    "visual",
  ];
  if (Object.keys(value).some((key) => !allowed.includes(key))) fail();
  for (const key of ["expectedUserId", "runId", "sessionId"]) workUuid(value[key]);
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    value.expectedRevision < 1 ||
    !Number.isSafeInteger(value.expectedSequence) ||
    value.expectedSequence < 0 ||
    value.expectedSequence >= 10000
  )
    fail();
  const fields = {
    open: ["url"],
    navigate: ["url"],
    snapshot: [],
    click: ["view", "target"],
    fill: ["view", "target", "text"],
    press: ["view", "target", "key"],
    scroll: ["delta"],
    takeover: [],
    release: [],
    close: [],
  }[value.operation];
  if (
    !fields ||
    Object.keys(value).some(
      (key) =>
        !allowed.slice(0, 6).includes(key) &&
        !fields.includes(key) &&
        key !== "visual" &&
        !(value.operation === "click" && key === "text"),
    )
  )
    fail();
  for (const key of fields) if (value[key] === undefined) fail();
  if (value.url !== undefined) {
    let url;
    try {
      url = new URL(value.url);
    } catch {
      fail();
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      value.url.length > 2048
    )
      fail();
  }
  if (value.view !== undefined) workUuid(value.view);
  if (value.target !== undefined) workUuid(value.target);
  if (
    value.text !== undefined &&
    (typeof value.text !== "string" ||
      new TextEncoder().encode(value.text).length > 4000 ||
      value.text.includes("\0"))
  )
    fail();
  if (
    value.key !== undefined &&
    !["Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "Space"].includes(value.key)
  )
    fail();
  if (
    value.delta !== undefined &&
    (!Number.isSafeInteger(value.delta) || Math.abs(value.delta) > 900 || value.delta === 0)
  )
    fail();
  if (value.visual !== undefined) validateWorkBrowserVisual(value.operation, value.visual);
  return structuredClone(value);
}

export function validateWorkBrowserVisual(operation, visual) {
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) fail();
  const captureOperations = ["open", "takeover", "navigate", "click"];
  const fields = {
    capture: [],
    frame: [],
    click: ["frame", "x", "y"],
    input: ["text"],
    key: ["key"],
    scroll: ["frame", "x", "y", "deltaX", "deltaY"],
  };
  if (!Object.hasOwn(fields, visual.kind)) fail();
  const expected = fields[visual.kind];
  if (
    (visual.kind === "capture"
      ? !captureOperations.includes(operation)
      : operation !== "snapshot") ||
    Object.keys(visual).length !== expected.length + 1 ||
    expected.some((field) => !Object.hasOwn(visual, field))
  )
    fail();
  if (visual.kind === "click" || visual.kind === "scroll") {
    workUuid(visual.frame);
    if (
      !Number.isSafeInteger(visual.x) ||
      visual.x < 0 ||
      visual.x >= 1280 ||
      !Number.isSafeInteger(visual.y) ||
      visual.y < 0 ||
      visual.y >= 900
    )
      fail();
  }
  if (
    visual.kind === "input" &&
    (typeof visual.text !== "string" ||
      !visual.text ||
      new TextEncoder().encode(visual.text).length > 3000 ||
      visual.text.includes("\0"))
  )
    fail();
  if (
    visual.kind === "key" &&
    ![
      "Enter",
      "Tab",
      "Shift+Tab",
      "Escape",
      "Backspace",
      "Delete",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "ArrowDown",
      "ArrowUp",
      "ArrowLeft",
      "ArrowRight",
      "ControlOrMeta+A",
    ].includes(visual.key)
  )
    fail();
  if (
    visual.kind === "scroll" &&
    (![visual.deltaX, visual.deltaY].every(
      (delta) => Number.isSafeInteger(delta) && Math.abs(delta) <= 900,
    ) ||
      (!visual.deltaX && !visual.deltaY))
  )
    fail();
}
