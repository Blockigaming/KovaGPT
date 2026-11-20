export type CloudBrowserSize = { width: number; height: number };
export type CloudBrowserFrame = CloudBrowserSize & { id: string; jpeg: string };

export type CloudBrowserControl =
  | { kind: "takeover" | "release" }
  | ({ kind: "frame" } & Partial<CloudBrowserSize>)
  | { kind: "click"; frame: string; x: number; y: number }
  | { kind: "scroll"; frame: string; x: number; y: number; deltaX: number; deltaY: number }
  | { kind: "input"; text: string }
  | { kind: "key"; key: string };

export const cloudBrowserId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const cloudBrowserWidth = 1600;
export const cloudBrowserHeight = 1200;
const keys = new Set([
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
]);
const integer = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high;

export function parseCloudBrowserControl(
  body: Record<string, unknown>,
): CloudBrowserControl | null {
  const { kind } = body;
  const count = Object.keys(body).length;
  if (kind === "takeover" || kind === "release") return count === 1 ? { kind } : null;
  if (kind === "frame") {
    if (count === 1) return { kind };
    const { width, height } = body;
    return count === 3 &&
      integer(width, 160, cloudBrowserWidth) &&
      integer(height, 160, cloudBrowserHeight)
      ? { kind, width, height }
      : null;
  }
  if (kind === "input") {
    const { text } = body;
    return count === 2 &&
      typeof text === "string" &&
      text.length > 0 &&
      new TextEncoder().encode(text).length <= 3000 &&
      !text.includes("\0")
      ? { kind, text }
      : null;
  }
  if (kind === "key") {
    const { key } = body;
    return count === 2 && typeof key === "string" && keys.has(key) ? { kind, key } : null;
  }
  if (kind === "click" || kind === "scroll") {
    const { frame, x, y } = body;
    if (
      typeof frame !== "string" ||
      !cloudBrowserId.test(frame) ||
      !integer(x, 0, cloudBrowserWidth - 1) ||
      !integer(y, 0, cloudBrowserHeight - 1)
    )
      return null;
    if (kind === "click") return count === 4 ? { kind, frame, x, y } : null;
    const { deltaX, deltaY } = body;
    return count === 6 &&
      integer(deltaX, -900, 900) &&
      integer(deltaY, -900, 900) &&
      (deltaX !== 0 || deltaY !== 0)
      ? { kind, frame, x, y, deltaX, deltaY }
      : null;
  }
  return null;
}
