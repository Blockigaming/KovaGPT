// Build a self-contained review fixture from the actual public React components.
// This preview has no authentication, AI generation, checkout or provider access.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve("test-results/ui-foundations/site");
const html = await readFile(resolve(root, "index.html"), "utf8");
const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
const cssPaths = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map((m) => m[1]);
const css = (
  await Promise.all(cssPaths.map((p) => readFile(resolve(root, p.replace(/^\//, "")), "utf8")))
).join("\n");
const result = await build({
  entryPoints: [resolve(root, script.replace(/^\//, ""))],
  bundle: true,
  write: false,
  format: "iife",
  minify: true,
  platform: "browser",
});
const out = resolve(process.argv[2] ?? "test-results/interface-preview");
await mkdir(out, { recursive: true });
const document = `<!doctype html><html lang="en" data-kova-review="1"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none';"><title>KovaGPT component review</title><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
await writeFile(resolve(out, "components.html"), document);
await writeFile(
  resolve(out, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KovaGPT · Design preview</title><style>body{margin:0;background:#edf0f4;font:14px system-ui;color:#182230}header{padding:12px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}h1{font-size:15px;margin:0}p{margin:0}button,select{font:inherit;padding:8px 12px;border:1px solid #bbc2cb;border-radius:8px;background:white}button{cursor:pointer}main{padding:0 16px 24px;overflow:auto}iframe{display:block;border:0;background:white;box-shadow:0 4px 28px #17202b18;margin:auto;width:100%;height:calc(100dvh - 130px);min-height:540px}small{display:block;padding:0 24px 16px;color:#53606f}</style><header><h1>KovaGPT · Design preview</h1><label>Page <select id="page"><option value="public-overview">Overview</option><option value="public-comparison">Pricing comparison</option></select></label><button id="desktop">Desktop · 1440</button><button id="mobile">Mobile · 390</button></header><small>Actual React component fixture. Examples, menu and FAQs work. Overview and pricing links stay in the preview. Other destinations explain what is available. No chat, login, billing or provider services are connected.</small><main><iframe id="preview" title="KovaGPT component preview" src="components.html?review=1&amp;surface=public-overview"></iframe></main><script>const frame=document.getElementById('preview');document.getElementById('page').onchange=e=>frame.src='components.html?review=1&surface='+e.target.value;document.getElementById('desktop').onclick=()=>frame.style.width='1440px';document.getElementById('mobile').onclick=()=>frame.style.width='390px';window.addEventListener('message',e=>{if(e.source===frame.contentWindow&&e.data?.type==='kova-review-surface'&&['public-overview','public-comparison'].includes(e.data.surface))document.getElementById('page').value=e.data.surface;});</script></html>`,
);
console.log(`Component review written to ${out}`);
