import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
test("400 owner requirements remain intact with the color override", () => {
  const ledger = JSON.parse(read("docs/spec400/acceptance.json"));
  assert.equal(ledger.items.length, 400);
  assert.deepEqual(
    ledger.items.map((x) => x.id),
    Array.from({ length: 400 }, (_, i) => i + 1),
  );
  assert.match(ledger.override, /9cc coloring/);
});
test("shared specification leaves the canonical ChatGPT palette and geometry in visual tokens", () => {
  const css = read("src/styles/spec400-system.css");
  for (const token of ["background", "foreground", "primary", "accent", "card", "sidebar"])
    assert.doesNotMatch(css, new RegExp(`--${token}\\s*:`));
  const geometry = read("src/styles/visual-tokens.css");
  assert.doesNotMatch(css, /--(?:radius|kova-radius-[a-z-]+|kova-sidebar(?:-rail)?-width)\s*:/);
  assert.match(geometry, /--radius: var\(--kova-radius-card\)/);
  assert.match(geometry, /--kova-radius-card:\s*16px;/);
  assert.match(geometry, /--kova-sidebar-width:\s*260px;/);
  assert.match(geometry, /--kova-sidebar-rail-width:\s*60px;/);
  const sidebar = read("src/styles/sidebar-core.css");
  assert.match(
    sidebar,
    /width: var\(--sidebar-expanded, var\(--kova-sidebar-width, 260px\)\);\s*min-width: var\(--sidebar-expanded, var\(--kova-sidebar-width, 260px\)\)/,
  );
  assert.match(
    sidebar,
    /width: var\(--kova-sidebar-rail-width, 60px\);\s*min-width: var\(--kova-sidebar-rail-width, 60px\)/,
  );
});
test("all six locally hosted IBM font files are actual WOFF2 assets", () => {
  for (const family of ["Sans", "Mono"])
    for (const weight of ["Regular", "Medium", "SemiBold"]) {
      const bytes = fs.readFileSync(
        new URL(`../../public/fonts/IBMPlex${family}-${weight}.woff2`, import.meta.url),
      );
      assert.equal(bytes.subarray(0, 4).toString(), "wOF2");
      assert.ok(bytes.length > 1000);
    }
});
test("usage failures cannot be reported as verified zero and promotions are truthful", () => {
  const source = read("src/utils/usage.functions.ts");
  const failure = source.slice(source.indexOf("if (error)"), source.indexOf("if (!data)"));
  assert.match(failure, /throw new Error/);
  assert.doesNotMatch(failure, /chats: 0/);
  const limit = read("src/components/LimitReachedDialog.tsx");
  assert.doesNotMatch(limit, /1 month|Limited offer|free trial|setInterval/);
  assert.match(limit, /Number\.isFinite/);
  assert.match(limit, /View plans/);
});
test("settings sections are routable and appearance remains principal scoped", () => {
  assert.match(
    read("src/routes/settings.$section.tsx"),
    /createFileRoute\("\/settings\/\$section"\)/,
  );
  const hook = read("src/lib/use-nova-settings.ts");
  assert.match(hook, /principalRef\.current !== principal/);
  assert.match(hook, /saveStoredSettings\(userKey/);
  assert.match(
    read("src/components/AppearanceSettings.tsx"),
    /Saved automatically for this account on this device/,
  );
});
test("expanded navigation does not retain a hidden rail width and fonts are scoped", () => {
  const css = read("src/styles/sidebar-core.css");
  assert.match(
    css,
    /\.kova-sidebar-rail\[data-kova-core-rail\]\[data-state="closed"\] \{\s*width: 0;\s*min-width: 0;\s*padding-inline: 0;\s*visibility: hidden;\s*pointer-events: none/,
  );
  const tokens = read("src/styles/visual-tokens.css");
  assert.match(tokens, /--chat-body-font: var\(--font-ui\)/);
  assert.match(tokens, /--font-sans: var\(--font-ui\)/);
  assert.match(
    read("src/styles/visual-tokens.css"),
    /--font-ui:\s*ui-sans-serif, -apple-system, system-ui, "Segoe UI", "Noto Sans", Helvetica, Arial/,
  );
  assert.match(read("src/lib/sidebar-layout.mjs"), /to: "\/scheduled-tasks"/);
});
