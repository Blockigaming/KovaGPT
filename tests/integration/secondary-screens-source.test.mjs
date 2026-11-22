import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile("src/styles.css", "utf8");
const pluginStyles = await readFile("src/styles/spec400-plugins.css", "utf8");
const managementStyles = await readFile("src/styles/spec400-management.css", "utf8");
const apps = await readFile("src/routes/apps.tsx", "utf8");
const tasks = await readFile("src/routes/scheduled-tasks.tsx", "utf8");
const taskEditor = await readFile("src/components/ScheduledTaskEditor.tsx", "utf8");
const pricing = await readFile("src/routes/pricing.tsx", "utf8");
const reset = await readFile("src/routes/reset-password.tsx", "utf8");
const auth = await readFile("src/components/auth/AuthDialog.tsx", "utf8");
const button = await readFile("src/components/ui/button.tsx", "utf8");

test("secondary routes share page, form, plan, plugin, and auth primitives", () => {
  assert.match(apps, /kova-secondary-page/);
  assert.match(apps, /import "@\/styles\/spec400-plugins\.css"/);
  assert.match(apps, /className="spec400-plugin-card"/);
  assert.match(
    pluginStyles,
    /\.spec400-plugin-card \{[^}]*border-radius: (?:22px|var\(--kova-radius-card\))/,
  );
  assert.match(tasks, /import "@\/styles\/spec400-management\.css"/);
  assert.match(tasks, /<ScheduledTaskEditor\s/);
  assert.match(
    taskEditor,
    /<form\s+ref=\{editorRef\}\s+className="spec400-schedule-editor space-y-4"/,
  );
  assert.match(
    managementStyles,
    /\.spec400-schedule-dialog\[data-kova-dialog-surface\] \{[^}]*border-radius: var\(--kova-radius-panel\)/,
  );
  assert.match(pricing, /kova-plan-card/);
  assert.match(reset, /kova-auth-page/);
  assert.match(auth, /kova-auth-surface/);
});

test("secondary primitives include focus, touch, safe-area, and reduced-motion behavior", () => {
  assert.match(styles, /\.kova-secondary-page :is\(input, textarea, select\):focus-visible/);
  assert.match(styles, /\.kova-secondary-page button/);
  assert.match(styles, /var\(--safe-bottom\)/);
  assert.match(
    apps,
    /<Button\s+type="button"\s+variant="outline"[\s\S]*?className="spec400-plugin-card-action"/,
  );
  assert.match(button, /data-ui-reference="chatgpt\.button\.pill"/);
  assert.match(button, /default: "h-9 px-\[15\.96px\] py-0"/);
  assert.match(button, /\[@media\(pointer:coarse\)\]:min-h-11/);
  assert.match(button, /focus-visible:ring-2 focus-visible:ring-ring/);
  assert.match(pluginStyles, /\.spec400-plugins button:active,[\s\S]*?transform: none/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
