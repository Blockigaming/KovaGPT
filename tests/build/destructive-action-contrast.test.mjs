import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import postcss from "postcss";
import { cva } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { states, escape, pair, contrast } from "../helpers/compiled-action-contrast.mjs";
const css = readFileSync(
    "dist/client/assets/" +
      readdirSync("dist/client/assets").find((n) => /^styles-.*\.css$/.test(n)),
    "utf8",
  ),
  ast = postcss.parse(css);
// Remove only this batch's action rules/tokens to reconstruct the prior cascade.
ast.walkRules((r) => {
  if (
    r.nodes.some(
      (d) =>
        d.type === "decl" &&
        !d.prop.startsWith("--") &&
        d.value.includes("var(--destructive-action-"),
    )
  )
    r.remove();
  else {
    r.walkDecls((d) => {
      if (d.prop.startsWith("--destructive-action-")) d.remove();
    });
    if (!r.nodes.length) r.remove();
  }
});
const before = states(ast.toString()),
  after = states(css),
  cn = (...v) => twMerge(clsx(v));
const react = { forwardRef: (f) => (p) => f(p, null) };
const { Button, buttonVariants } = loadUiModule("src/components/ui/button.tsx", {
  react,
  "@radix-ui/react-slot": { Slot: "Slot" },
  "class-variance-authority": { cva },
  "@/lib/utils": { cn },
});
const primitives = Object.fromEntries(
  [
    "Root",
    "Trigger",
    "Portal",
    "Overlay",
    "Content",
    "Title",
    "Description",
    "Action",
    "Cancel",
  ].map((x) => [x, Object.assign((p) => p, { displayName: x })]),
);
const { AlertDialogAction } = loadUiModule("src/components/ui/alert-dialog.tsx", {
  react,
  "@radix-ui/react-alert-dialog": primitives,
  "@/lib/utils": { cn },
  "@/components/ui/button": { buttonVariants },
});
const controls = [
  { name: "shared-destructive", classes: Button({ variant: "destructive" }).props.className },
  {
    name: "confirmation-destructive",
    classes: AlertDialogAction({ className: "bg-destructive text-destructive-foreground" }).props
      .className,
  },
  {
    name: "project-delete-confirmation",
    classes: AlertDialogAction({
      className: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
    }).props.className,
  },
  { name: "custom-danger-text", classes: "text-destructive hover:bg-destructive/10" },
  {
    name: "outline-danger-text",
    classes: Button({
      variant: "outline",
      className: "text-destructive hover:bg-destructive/10 hover:text-destructive",
    }).props.className,
  },
  {
    name: "menu-danger-text",
    classes: "text-destructive focus:text-destructive",
    tag: "div",
    role: "menuitem",
  },
  { name: "linked-destructive", classes: buttonVariants({ variant: "destructive" }), tag: "a" },
];
function fixture(dark, control, state = [], disabled = {}, surface = "bg-background", scope = "") {
  const root = element("html", dark ? "dark" : ""),
    parent = element("div", surface + " text-foreground " + scope, root, {
      role: control.role === "menuitem" ? "menu" : "alertdialog",
    });
  const attrs = {
    ...Object.fromEntries(state.map((s) => ["data-test-" + s, ""])),
    ...disabled,
    ...(control.role ? { role: control.role } : {}),
  };
  return element(control.tag ?? "button", escape(control.classes), parent, attrs);
}
test("Baseline reproduces enabled destructive dark and light-hover deficiencies using actual shared and confirmation classes", () => {
  for (const [dark, state] of [
    [true, []],
    [false, ["hover"]],
  ]) {
    const c = compiledCascade(before, 1440, false),
      el = fixture(dark, controls[0], state);
    assert.ok(contrast(c, el) < 4.5);
    assert.ok(contrast(c, el) > 3.5);
  }
  const c = compiledCascade(before, 1440, false),
    el = fixture(true, controls[1], ["hover"]);
  assert.ok(
    contrast(c, el) < 4.5,
    "confirmation uses default hover utility under its destructive override",
  );
});
const rows = [];
for (const width of [390, 1440])
  for (const dark of [false, true])
    test(`Enabled destructive pairs ${width} dark=${dark}`, () => {
      const c = compiledCascade(after, width, width < 768),
        old = compiledCascade(before, width, width < 768);
      for (const control of controls)
        for (const surface of ["bg-background", "bg-card", "bg-popover"])
          for (const scope of ["", "kova-assistant"])
            for (const state of [[], ["hover"], ["focus-visible"], ["hover", "focus-visible"]]) {
              const el = fixture(dark, control, state, {}, surface, scope),
                ratio = contrast(c, el);
              assert.ok(ratio >= 4.5, `${control.name} ${surface} ${scope} ${state}: ${ratio}`);
              if (state.includes("focus-visible")) {
                assert.match(c.value(el, "outline"), /^2px solid /);
                assert.equal(c.value(el, "box-shadow"), "none");
              }
              if (surface === "bg-background" && !scope)
                rows.push({
                  width,
                  theme: dark ? "dark" : "light",
                  control: control.name,
                  state,
                  pair: pair(c, el),
                  contrast: Number(ratio.toFixed(3)),
                  previousContrast: Number(contrast(old, el).toFixed(3)),
                });
            }
      for (const control of controls)
        for (const disabled of [
          { disabled: "", "data-test-disabled": "" },
          { "aria-disabled": "true" },
          { "data-disabled": "" },
        ])
          for (const state of [[], ["hover"], ["focus-visible"], ["hover", "focus-visible"]]) {
            const el = fixture(dark, control, state, disabled);
            assert.deepEqual(
              pair(c, el),
              pair(old, el),
              `${control.name} disabled styling preserved`,
            );
            for (const prop of ["pointer-events", "cursor", "outline", "box-shadow"])
              assert.equal(c.value(el, prop), old.value(el, prop));
          }
    });
for (const dark of [false, true])
  test(`Image hover action and unaffected status colors dark=${dark}`, () => {
    const c = compiledCascade(after, 1440, false),
      old = compiledCascade(before, 1440, false);
    const control = {
      name: "image-remove",
      classes: "bg-white/10 text-white hover:bg-destructive",
    };
    const hovered = fixture(dark, control, ["hover", "focus-visible"], {}, "bg-black");
    assert.ok(contrast(c, hovered) >= 4.5);
    const normal = fixture(dark, control, [], {}, "bg-black");
    assert.deepEqual(pair(c, normal), pair(old, normal));
    for (const tag of ["div", "p", "span", "svg"])
      for (const classes of [
        "bg-destructive text-destructive-foreground",
        "text-destructive",
        "bg-destructive",
      ])
        for (const state of [[], ["hover"]]) {
          const el = fixture(dark, { name: "status", tag, classes }, state);
          for (const prop of [
            "color",
            "background-color",
            "--destructive",
            "--destructive-foreground",
          ])
            assert.equal(c.value(el, prop), old.value(el, prop));
        }
  });
test.after(() => {
  if (process.env.KOVA_DESTRUCTIVE_AUDIT) console.log("DESTRUCTIVE_AUDIT=" + JSON.stringify(rows));
});
