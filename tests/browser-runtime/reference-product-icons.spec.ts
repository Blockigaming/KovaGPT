import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const result = await build({
  stdin: {
    contents: `import React,{createRef,useLayoutEffect} from 'react';import{createRoot}from'react-dom/client';import*as icons from './src/components/ui/product-icons';
const reference=createRef();window.iconProbe={clicks:0,keys:0,refTag:null};
function Harness(){useLayoutEffect(()=>{window.iconProbe.refTag=reference.current.tagName;},[]);return <main>
<icons.Copy ref={reference} size={32} className="api-glyph" role="img" aria-label="Copy API probe" tabIndex={0} style={{color:'rgb(12, 34, 56)'}} onClick={()=>window.iconProbe.clicks++} onKeyDown={()=>window.iconProbe.keys++}/>
<section id="icon-grid">{Object.entries(icons).map(([name,Icon])=><span key={name}><Icon size={20}/></span>)}</section>
<section className="paint-row"><div id="actual-paint"><icons.Loader2 className="paint-glyph animate-spin" size={24}/></div><div id="reference-paint"><div className="LoadingIndicator" style={{width:24,height:24}}/></div></section>
<div id="motion-probe"><icons.LoaderCircle className="animate-spin" size={16}/></div>
<div id="legacy-paint"><icons.Copy size={24} fill="none" stroke="currentColor" strokeWidth={8}/><icons.Circle size={24}/><icons.Star size={24}/><icons.Star size={24} className="fill-current"/></div>
</main>};createRoot(document.getElementById('root')).render(<Harness/>);`,
    resolveDir: process.cwd(),
    loader: "tsx",
  },
  outfile: "reference-icons-fixture.js",
  loader: { ".css": "empty" },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
});
const script = result.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
const styles = readFileSync("src/components/ui/product-icons.css", "utf8");
// Exact independent upstream source, pinned by the release manifest, not copied
// back from the production adapter CSS being tested.
const referenceStyles = readFileSync(
  "tests/fixtures/openai-loading-indicator-reference.css",
  "utf8",
);

type ProbeWindow = Window & { iconProbe: { clicks: number; keys: number; refTag: string } };
async function mount(page: import("@playwright/test").Page) {
  await page.route("https://icons-reference.test/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><html><body><div id='root'></div></body></html>",
    }),
  );
  await page.goto("https://icons-reference.test/");
  await page.addStyleTag({
    content: `${styles}\n${referenceStyles}\nbody{margin:0;background:white;color:#123456}#icon-grid{display:grid;grid-template-columns:repeat(24,24px);gap:8px;padding:20px}#icon-grid>span{width:24px;height:24px}.api-glyph{display:block}.paint-row{display:flex;gap:24px;padding:20px}#actual-paint,#reference-paint{width:24px;height:24px;background:white}.paint-glyph{display:block;width:24px;height:24px}#actual-paint *,#actual-paint *::before,#actual-paint *::after,#reference-paint *,#reference-paint *::before,#reference-paint *::after{animation:none!important;transition:none!important}#legacy-paint{display:flex;gap:16px;padding:20px}`,
  });
  await page.addScriptTag({ content: script });
  await expect(page.locator("#icon-grid svg")).toHaveCount(184);
}

// Small PNG decoder keeps this rendering check self-contained in ordinary Node
// CI; it does not depend on a host-only image library or a private Playwright API.
function pixels(png: Buffer) {
  let width = 0,
    height = 0,
    channels = 0;
  const chunks: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at),
      type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels).toBeGreaterThan(0);
      expect(data[12]).toBe(0);
    }
    if (type === "IDAT") chunks.push(data);
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(chunks)),
    stride = width * channels;
  const decoded = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const value = a + b - c,
      da = Math.abs(value - a),
      db = Math.abs(value - b),
      dc = Math.abs(value - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? decoded[y * stride + x - channels] : 0;
      const up = y > 0 ? decoded[(y - 1) * stride + x] : 0;
      const corner = y > 0 && x >= channels ? decoded[(y - 1) * stride + x - channels] : 0;
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, corner);
      decoded[y * stride + x] = (raw[y * (stride + 1) + 1 + x] + prediction) & 255;
    }
  }
  const rgb = [];
  let ink = 0;
  for (let at = 0; at < decoded.length; at += channels) {
    const color = [decoded[at], decoded[at + 1], decoded[at + 2]];
    rgb.push(...color);
    if (Math.min(...color) < 240 && (channels === 3 || decoded[at + 3] > 0)) ink++;
  }
  return { width, height, rgb, ink };
}

test("all glyph exports mount, and the SVG API keeps real refs, labels, dimensions and events", async ({
  page,
}) => {
  await mount(page);
  const probe = page.getByRole("img", { name: "Copy API probe", exact: true });
  await expect(probe).toHaveAttribute("width", "32");
  await expect(probe).toHaveAttribute("height", "32");
  await expect(probe).toHaveClass("api-glyph");
  await expect
    .poll(() => page.evaluate(() => (window as ProbeWindow).iconProbe.refTag))
    .toBe("svg");
  await probe.click();
  await probe.press("Enter");
  expect(await page.evaluate(() => (window as ProbeWindow).iconProbe.clicks)).toBe(1);
  expect(await page.evaluate(() => (window as ProbeWindow).iconProbe.keys)).toBe(1);
  const sourcePaint = page.locator(
    '#legacy-paint svg[data-product-icon="Copy"] g[data-sdk-geometry]',
  );
  await expect(sourcePaint).toHaveCSS("fill", "rgb(18, 52, 86)");
  await expect(sourcePaint).toHaveCSS("stroke", "none");
  await expect(page.locator('#legacy-paint svg[data-product-icon="Circle"] g')).toHaveAttribute(
    "data-sdk-geometry",
    "EmptyCircle",
  );
  await expect(
    page.locator('#legacy-paint svg[data-product-icon="Star"] g').nth(0),
  ).toHaveAttribute("data-sdk-geometry", "Star");
  await expect(
    page.locator('#legacy-paint svg[data-product-icon="Star"] g').nth(1),
  ).toHaveAttribute("data-sdk-geometry", "StarFilled");
});

test("the SVG foreignObject loader visibly paints like the independent pinned SDK CSS ring", async ({
  page,
}, info) => {
  await mount(page);
  const actual = pixels(
    await page
      .locator("#actual-paint")
      .screenshot({ path: info.outputPath("actual-sdk-loader.png"), scale: "css" }),
  );
  const reference = pixels(
    await page
      .locator("#reference-paint")
      .screenshot({ path: info.outputPath("upstream-sdk-loader.png"), scale: "css" }),
  );
  expect(actual.width).toBe(24);
  expect(actual.height).toBe(24);
  expect(reference.width).toBe(24);
  expect(reference.height).toBe(24);
  expect(reference.ink).toBeGreaterThan(10);
  expect(actual.ink).toBeGreaterThan(10);
  expect(Math.abs(actual.ink - reference.ink)).toBeLessThanOrEqual(
    Math.max(3, reference.ink * 0.12),
  );
  const difference =
    actual.rgb.reduce((sum, value, index) => sum + Math.abs(value - reference.rgb[index]), 0) /
    actual.rgb.length;
  expect(difference).toBeLessThan(6);
});

test("loading animation runs once and pauses for reduced motion", async ({ page }) => {
  await mount(page);
  const outer = page.locator("#motion-probe svg"),
    inner = page.locator("#motion-probe .kova-reference-loading-indicator");
  await expect(outer).not.toHaveClass(/(?:^|\s)animate-spin(?:$|\s)/);
  await expect(inner).toHaveCSS("animation-duration", "0.8s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(inner).toHaveCSS("animation-name", "none");
});
