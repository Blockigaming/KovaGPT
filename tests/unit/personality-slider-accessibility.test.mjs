import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", source)(
    (name) => (name in stubs ? stubs[name] : require(name)),
    module,
    module.exports,
  );
  return module.exports;
}
const { Slider } = load("src/components/ui/slider.tsx", {
  "@/lib/utils": { cn: (...classes) => classes.filter(Boolean).join(" ") },
});
const { PersonalitySliders } = load("src/components/PersonalitySliders.tsx", {
  "@/components/ui/slider": { Slider },
  "@/components/ui/button": { Button: "button" },
  "@/components/ui/switch": { Switch: "button" },
  "@tanstack/react-router": { Link: "a" },
  "@/hooks/useTier": { useTier: () => ({ tier: "plus" }), tierRank: () => 1 },
  "@/lib/principal-browser-storage.mjs": {
    browserStoragePrincipal: (key) => key,
    principalScopedStorageKey: (key, owner) => `${owner}:${key}`,
  },
});
const thumbs = (markup) =>
  [...markup.matchAll(/<span\b[^>]*role="slider"[^>]*>/g)].map((match) => match[0]);
const attr = (tag, name) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

test("every personality slider thumb names its trait, describes its hint, and explains its value", () => {
  const markup = renderToStaticMarkup(
    React.createElement(PersonalitySliders, { userKey: "test-owner", principalResolved: true }),
  );
  const sliders = thumbs(markup);
  const labels = [
    "Kindness",
    "Formalness",
    "Humor",
    "Directness",
    "Detail level",
    "Energy",
    "Creativity",
    "Friendliness",
    "Seriousness",
    "Conciseness",
  ];
  const hints = [
    "Warmer, softer replies",
    "Casual to formal",
    "Playful and witty",
    "Blunt vs cushioned",
    "Brief vs thorough",
    "Calm vs enthusiastic",
    "Safe vs inventive",
    "Neutral vs warm",
    "Light vs serious",
    "Verbose vs terse",
  ];
  assert.equal(sliders.length, 10);
  for (const [index, slider] of sliders.entries()) {
    const labelId = attr(slider, "aria-labelledby");
    const hintId = attr(slider, "aria-describedby");
    assert.ok(labelId && hintId);
    assert.ok(
      markup.includes(`id="${labelId}" class="font-medium text-foreground">${labels[index]}</div>`),
    );
    assert.ok(
      markup.includes(`id="${hintId}" class="text-muted-foreground">${hints[index]}</div>`),
    );
    assert.equal(attr(slider, "aria-valuetext"), "5 out of 10");
    assert.equal(attr(slider, "aria-valuemin"), "1");
    assert.equal(attr(slider, "aria-valuemax"), "10");
    assert.equal(attr(slider, "tabindex"), "0");
  }
});

test("shared Slider retains its default single thumb and styling, with optional ARIA only on the thumb", () => {
  const props = { defaultValue: [5], min: 1, max: 10 };
  const plain = renderToStaticMarkup(React.createElement(Slider, props));
  const named = renderToStaticMarkup(
    React.createElement(Slider, {
      ...props,
      thumbProps: {
        "aria-label": "Example trait",
        "aria-describedby": "trait-hint",
        "aria-valuetext": "5 out of 10",
      },
    }),
  );
  assert.equal(thumbs(plain).length, 1);
  assert.equal(thumbs(named).length, 1);
  assert.equal(attr(thumbs(plain)[0], "class"), attr(thumbs(named)[0], "class"));
  assert.equal(attr(thumbs(named)[0], "aria-label"), "Example trait");
  assert.equal(attr(thumbs(named)[0], "aria-describedby"), "trait-hint");
  assert.equal((named.match(/aria-label="Example trait"/g) ?? []).length, 1);
  assert.doesNotMatch(named, /thumbProps/);
});

test("multiple personality panels produce distinct accessible-label IDs", () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(PersonalitySliders, { userKey: "owner-a", principalResolved: true }),
      React.createElement(PersonalitySliders, { userKey: "owner-b", principalResolved: true }),
    ),
  );
  const ids = thumbs(markup).map((thumb) => attr(thumb, "aria-labelledby"));
  assert.equal(ids.length, 20);
  assert.equal(new Set(ids).size, 20);
});
