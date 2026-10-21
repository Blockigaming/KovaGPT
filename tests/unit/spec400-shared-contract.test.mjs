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
test("shared specification does not replace the baseline palette", () => {
  const css = read("src/styles/spec400-system.css");
  for (const token of ["background", "foreground", "primary", "accent", "card", "sidebar"])
    assert.doesNotMatch(css, new RegExp(`--${token}\\s*:`));
  assert.match(css, /--kova-radius-card:\s*0\.75rem/);
  assert.match(css, /width:\s*248px/);
  assert.match(css, /width:\s*72px/);
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
  assert.match(read("src/components/AppearanceSettings.tsx"), /Cross-device sync is\s+unavailable/);
});
test("expanded navigation does not retain a hidden rail width and fonts are scoped", () => {
  const css = read("src/styles/spec400-system.css");
  assert.match(
    css,
    /\.kova-sidebar-rail\[data-kova-core-rail\]\[data-state="closed"\] \{\s*display: none !important/,
  );
  assert.match(css, /--chat-body-font: "IBM Plex Sans"/);
  assert.match(
    read("src/components/Sidebar.tsx"),
    /navLink\("\/scheduled-tasks", "Scheduled tasks"/,
  );
});
