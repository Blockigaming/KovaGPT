import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const alert = read("src/components/ui/alert-dialog.tsx");
const dialog = read("src/components/ui/dialog.tsx");
const sheet = read("src/components/ui/sheet.tsx");
const select = read("src/components/ui/select.tsx");

for (const [name, source] of [
  ["Dialog", dialog],
  ["AlertDialog", alert],
  ["Sheet", sheet],
]) {
  test(`${name} contains long content and lets its action row wrap`, () => {
    assert.ok(source.includes("min-w-0"));
    assert.ok(source.includes("[overflow-wrap:anywhere]"));
    assert.ok(source.includes("overflow-y-auto"));
    assert.ok(source.includes("overscroll-contain"));
    const footer = source.slice(
      source.indexOf(`const ${name}Footer`),
      source.indexOf(`${name}Footer.displayName`),
    );
    assert.ok(footer.includes("gap-2"));
    assert.ok(footer.includes("sm:flex-wrap"));
    assert.doesNotMatch(footer, /sm:space-x-2/);
  });
}

test("alert content has explicit scrollable height limits on both legacy and dynamic viewports", () => {
  assert.match(alert, /max-h-\[calc\(100vh-2rem\)\]/);
  assert.match(alert, /supports-\[height:100dvh\]:max-h-/);
  assert.match(alert, /env\(safe-area-inset-top\)/);
  assert.match(alert, /env\(safe-area-inset-bottom\)/);
  for (const name of ["Action", "Cancel"]) {
    const body = alert.slice(
      alert.indexOf(`const AlertDialog${name}`),
      alert.indexOf(`AlertDialog${name}.displayName`),
    );
    for (const token of [
      "h-auto",
      "min-h-11",
      "max-w-full",
      "whitespace-normal",
      "ref={ref}",
      "{...props}",
    ]) {
      assert.ok(body.includes(token), `${name}: ${token}`);
    }
  }
});

test("select collision bounds do not replace item-aligned placement or caller handlers", () => {
  assert.match(select, /position = "popper", collisionPadding = 8/);
  assert.match(select, /position === "popper" &&\s*"min-w-\[min\(/);
  assert.match(select, /max-w-\[min\(var\(--radix-select-content-available-width/);
  assert.match(select, /position=\{position\}/);
  assert.match(select, /collisionPadding=\{collisionPadding\}/);
  assert.doesNotMatch(select, /min-w-\[var\(--radix-select-trigger-width\)\]/);
  assert.match(
    select,
    /min-w-0 cursor-default select-none items-center \[overflow-wrap:anywhere\]/,
  );
});

test("shared UI browser evidence exercises real components and CSS without app credentials", () => {
  const config = read("tests/ui-foundations/vite.config.ts");
  const fixture = read("tests/ui-foundations/fixture/main.tsx");
  const spec = read("tests/ui-foundations/controls.spec.ts");
  const workflow = read(".github/workflows/ui-foundation-browser.yml");
  assert.match(config, /envDir: false/);
  assert.match(config, /publicDir: false/);
  assert.match(fixture, /@\/components\/ui\/alert-dialog/);
  assert.match(fixture, /@\/components\/ui\/select/);
  assert.match(read("tests/ui-foundations/fixture/styles.css"), /src\/styles\.css/);
  for (const token of [
    "toBeFocused",
    "elementFromPoint",
    'press("Escape")',
    'press("Tab")',
    'press("End")',
    'press("Enter")',
  ]) {
    assert.ok(spec.includes(token));
  }
  assert.match(workflow, /persist-credentials: false/);
  assert.doesNotMatch(workflow, /secrets\.|id-token: write|pull_request_target|continue-on-error/);
});
