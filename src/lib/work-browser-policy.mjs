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
    Object.keys(value).some((key) => !allowed.slice(0, 6).includes(key) && !fields.includes(key))
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
  return structuredClone(value);
}
