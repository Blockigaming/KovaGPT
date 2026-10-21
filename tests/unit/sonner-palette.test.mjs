import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import postcss from "postcss";
import { loadUiModule } from "../helpers/ui-state-harness.mjs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
let mobile = false;
const { Toaster } = loadUiModule("src/components/ui/sonner.tsx", {
  sonner: { Toaster: "Sonner" },
  "@/hooks/use-mobile": { useIsMobile: () => mobile },
});
const styles = postcss.parse(read("src/styles.css"));
const native = read("node_modules/sonner/dist/styles.css");

// Component/source inspection only: no DOM, browser or screenshots.
test("native toast color and radius variables resolve through the existing application tokens", () => {
  const toast = Toaster({});
  const expected = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--kova-radius-card)",
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(toast.props.style[key], value);
    assert.ok(native.includes(`var(${key})`), `${key} must be consumed by native Sonner`);
  }
  for (const selector of [":root", ".dark"]) {
    const theme = styles.nodes.find((node) => node.type === "rule" && node.selector === selector);
    for (const token of ["--popover", "--popover-foreground", "--border"])
      assert.ok(
        theme.nodes.some((node) => node.prop === token),
        `${selector} defines ${token}`,
      );
  }
  assert.equal(toast.props.theme, undefined, "Does not introduce a second theme preference");
});

test("native close, hover and loading colors follow the application palette", () => {
  const { style, toastOptions } = Toaster({}).props;
  for (const key of ["--gray4", "--gray5", "--normal-border-hover"])
    assert.equal(style[key], "var(--border)");
  for (const key of ["--gray2", "--normal-bg-hover"]) assert.equal(style[key], "var(--accent)");
  assert.equal(style["--gray12"], "var(--popover-foreground)");
  assert.equal(style["--gray11"], "var(--muted-foreground)");
  assert.equal(toastOptions.classNames.description, "!text-muted-foreground");
  assert.match(native, /\[data-description\][\s\S]*?color: #3f3f3f/);
});

test("mobile toasts move above the composer while desktop keeps its corner", () => {
  mobile = true;
  try {
    const { props } = Toaster({});
    assert.equal(props.position, "top-center");
    assert.equal(props.mobileOffset.top, "calc(72px + env(safe-area-inset-top))");
    assert.equal(props.mobileOffset.left, 16);
    assert.equal(props.mobileOffset.right, 16);
  } finally {
    mobile = false;
  }
  assert.equal(Toaster({}).props.position, "bottom-right");
});

test("caller styles merge without discarding palette bindings and normal toast behavior stays intact", () => {
  const { props } = Toaster({
    style: { margin: 12, "--normal-bg": "var(--card)" },
    duration: 2000,
  });
  assert.equal(props.style.margin, 12);
  assert.equal(props.style["--normal-bg"], "var(--card)");
  assert.equal(props.style["--normal-text"], "var(--popover-foreground)");
  assert.equal(props.duration, 2000);
  assert.equal(props.position, "bottom-right");
  assert.equal(props.closeButton, true);
  assert.equal(props.visibleToasts, 4);
});
