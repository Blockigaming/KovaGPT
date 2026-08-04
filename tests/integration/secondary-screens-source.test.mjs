import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const apps = await readFile("src/routes/apps.tsx", "utf8");
const tasks = await readFile("src/routes/scheduled-tasks.tsx", "utf8");
const pricing = await readFile("src/routes/pricing.tsx", "utf8");
const reset = await readFile("src/routes/reset-password.tsx", "utf8");
const auth = await readFile("src/components/auth/AuthDialog.tsx", "utf8");

test("secondary routes share page, form, plan, connector, and auth primitives", () => {
  assert.match(apps, /kova-secondary-page/);
  assert.match(apps, /kova-connector-card/);
  assert.match(tasks, /kova-form-surface/);
  assert.match(pricing, /kova-plan-card/);
  assert.match(reset, /kova-auth-page/);
  assert.match(auth, /kova-auth-surface/);
});

test("secondary primitives include focus, touch, safe-area, and reduced-motion behavior", () => {
  assert.match(styles, /\.kova-secondary-page :is\(input, textarea, select\):focus-visible/);
  assert.match(styles, /\.kova-secondary-page button/);
  assert.match(styles, /var\(--safe-bottom\)/);
  assert.match(styles, /\.kova-connector-card:hover/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
