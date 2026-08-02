import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const root = await readFile("src/routes/__root.tsx", "utf8");

test("root shell declares language, viewport fit, theme color, and recoverable errors", () => {
  assert.match(root, /<html lang="en"/);
  assert.match(root, /viewport-fit=cover/);
  assert.match(root, /theme-color/);
  assert.match(root, /errorComponent: ErrorComponent/);
  assert.match(root, />\s*Retry\s*</);
});
