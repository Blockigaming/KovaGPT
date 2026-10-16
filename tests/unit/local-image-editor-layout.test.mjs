import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { compile } from "@tailwindcss/node";
import postcss from "postcss";
import { compiledCascade, element } from "../helpers/compiled-chat-cascade.mjs";
import { nodes } from "../helpers/kova-react-fixture.mjs";
const route = readFileSync("src/routes/images.tsx", "utf8");
const editor = readFileSync("src/components/LocalImageEditor.tsx", "utf8");
const wrapperClass = route.match(/<div className="(mx-auto flex min-h-full [^"]+)"/)[1];
const inputClass = editor.match(/className="([^"]+)"\s+type="range"/)[1];
const compiler = await compile(readFileSync("src/styles.css", "utf8"), {
  base: `${process.cwd()}/src`,
  onDependency() {},
});
const css = compiler.build([
  ...new Set([...wrapperClass.split(/\s+/), ...inputClass.split(/\s+/)]),
]);
const escape = (s) =>
  s
    .split(/\s+/)
    .map((p) => p.replace(/([^a-zA-Z0-9_-])/g, "\\$1"))
    .join(" ");
const declaration = (selector) => {
  const values = {};
  postcss.parse(css).walkRules((rule) => {
    if (
      rule.selector
        .split(",")
        .map((s) => s.trim())
        .includes(selector)
    )
      rule.walkDecls((d) => (values[d.prop] = d.value));
  });
  return values;
};
for (const width of [320, 390, 834, 1440])
  test(`Image lightbox keeps intrinsic content height and an internally shrinking range at ${width}px`, () => {
    const c = compiledCascade(css, width, width < 768),
      html = element("html"),
      dialog = element("div", "image-lightbox", html),
      wrapper = element("div", escape(wrapperClass), dialog),
      label = element("label", "flex", wrapper),
      range = element("input", escape(inputClass), label, { type: "range" });
    assert.equal(c.value(wrapper, "flex-shrink"), "0");
    assert.equal(c.value(wrapper, "height"), undefined);
    assert.equal(c.value(wrapper, "min-height"), "100%");
    assert.equal(c.value(wrapper, "justify-content"), "center");
    assert.equal(c.value(range, "flex"), "1");
    assert.match(c.value(range, "min-width"), /^0(?:px)?$/);
    assert.equal(c.value(range, "height"), "44px");
    assert.match(route, /data-image-lightbox[^]*?overflow-y-auto/);
  });
test("Both image slider engines have visible theme-token tracks, thumbs, focus and disabled styling", () => {
  for (const pseudo of ["::-webkit-slider-runnable-track", "::-moz-range-track"]) {
    const d = declaration("input.kova-image-adjustment-range" + pseudo);
    assert.equal(d.height, "4px");
    assert.equal(d.background, "var(--muted-foreground)");
  }
  for (const pseudo of ["::-webkit-slider-thumb", "::-moz-range-thumb"])
    assert.equal(
      declaration("input.kova-image-adjustment-range" + pseudo).background,
      "var(--primary)",
    );
  assert.equal(
    declaration("input.kova-image-adjustment-range:focus-visible").outline,
    "2px solid var(--ring)",
  );
  assert.equal(declaration("input.kova-image-adjustment-range:disabled").cursor, "not-allowed");
});
function fixture(ready) {
  let cursor = 0;
  const state = [];
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in state))
        state[i] =
          i === 0 && ready
            ? {
                blob: new Blob(["synthetic"]),
                url: "blob:synthetic",
                pixels: { width: 512, height: 704 },
              }
            : initial;
      return [state[i], (value) => (state[i] = value)];
    },
    useRef(value) {
      return { current: value };
    },
    useEffect() {},
  };
  const defaults = { brightness: 0, contrast: 0, saturation: 100 };
  const imports = {
    react: react,
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": { useBlocker() {} },
    "@tanstack/react-start": {
      useServerFn: () => () => {
        throw Error("No service calls allowed");
      },
    },
    "@/lib/library-images.functions": { saveImageToLibrary() {} },
    "@/lib/multimodal/image-bytes.mjs": {},
    "@/lib/endpoint-reliability.mjs": {},
    "@/lib/auth-fetch": {},
    "@/lib/local-image-adjustments.mjs": { DEFAULT_IMAGE_ADJUSTMENTS: defaults },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(editor, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      module,
      exports: module.exports,
      require: (id) => {
        assert.ok(imports[id], id);
        return imports[id];
      },
    },
  );
  return {
    state,
    render() {
      cursor = 0;
      return module.exports.LocalImageEditor({
        source: { id: "synthetic", imageUrl: "blob:synthetic", prompt: "Synthetic" },
        actor: "synthetic",
        onDirtyChange() {},
      });
    },
  };
}
for (const ready of [false, true])
  test(`All three real controls retain their bounds, disabled semantics and value handler (${ready ? "decoded" : "loading"})`, () => {
    const f = fixture(ready),
      tree = f.render(),
      ranges = nodes(tree).filter((n) => n.type === "input" && n.props.type === "range");
    assert.equal(ranges.length, 3);
    for (const [index, input] of ranges.entries()) {
      assert.equal(input.props.className, inputClass);
      assert.equal(input.props.disabled, !ready);
      assert.equal(input.props.min, index === 2 ? 0 : -100);
      assert.equal(input.props.max, index === 2 ? 200 : 100);
    }
    if (ready) {
      ranges[0].props.onChange({ target: { value: "25" } });
      const next = nodes(f.render()).filter((n) => n.type === "input");
      assert.equal(next[0].props.value, 25);
      assert.equal(next[1].props.value, 0);
      assert.equal(next[2].props.value, 100);
    }
  });
test(
  "Existing image route and editor handlers are unchanged after stripping presentation classes",
  { skip: !process.env.KOVA_IMAGES_BASE_SOURCE },
  () => {
    const normalize = (s) =>
      ts.transpileModule(s.replace(/className=(?:"[^"\n]*"|\{`[^`]*`\})/g, ""), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX },
      }).outputText;
    assert.equal(
      normalize(route),
      normalize(
        readFileSync(process.env.KOVA_IMAGES_BASE_SOURCE + "/src/routes/images.tsx", "utf8"),
      ),
    );
    assert.equal(
      normalize(editor),
      normalize(
        readFileSync(
          process.env.KOVA_IMAGES_BASE_SOURCE + "/src/components/LocalImageEditor.tsx",
          "utf8",
        ),
      ),
    );
  },
);
