import assert from "node:assert/strict";
import test from "node:test";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

function fixture(stored = null, systemDark = false) {
  const memory = new Map(stored ? [["kova-theme-mode", stored]] : []);
  const classes = new Set();
  const theme = loadUiModule(
    "src/lib/theme.ts",
    {},
    {
      window: { matchMedia: () => ({ matches: systemDark }) },
      localStorage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => memory.set(key, value),
      },
      document: {
        documentElement: {
          classList: {
            toggle(name, on) {
              if (on) classes.add(name);
              else classes.delete(name);
            },
          },
        },
      },
    },
  );
  return { theme, memory, classes };
}

test("a fresh visitor gets dark even when their device uses light", () => {
  const f = fixture();
  f.theme.applyThemeMode(f.theme.loadThemeMode());
  assert.equal(f.classes.has("dark"), true);
});

test("an explicit light preference survives reload", () => {
  const f = fixture("light", true);
  f.theme.applyThemeMode(f.theme.loadThemeMode());
  assert.equal(f.classes.has("dark"), false);
  assert.equal(f.memory.get("kova-theme-mode"), "light");
});

test("an explicit system preference continues following the device", () => {
  for (const dark of [false, true]) {
    const f = fixture("system", dark);
    f.theme.applyThemeMode(f.theme.loadThemeMode());
    assert.equal(f.classes.has("dark"), dark);
    assert.equal(f.memory.get("kova-theme-mode"), "system");
  }
});
