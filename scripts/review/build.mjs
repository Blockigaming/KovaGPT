/** Bundle actual React UI into a provider-isolated, single-file review. */
import { build } from "esbuild";
import ts from "typescript";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, dirname, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const fixtures = resolve(root, "scripts/review/fixtures");
const output = resolve(process.argv[2] || "../core-ui-review");
const cssDir = resolve(process.env.KOVA_REVIEW_CSS_DIR || "dist/client/assets");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const aliases = new Map([
  ["@tanstack/react-start", "start.ts"],
  ["@/components/auth/ClerkSafe", "auth.tsx"],
  ["@/integrations/supabase/client", "client.ts"],
]);
const result = await build({
  entryPoints: [resolve(fixtures, "main.tsx")],
  bundle: true,
  write: false,
  metafile: true,
  outfile: "review.js",
  format: "iife",
  minify: true,
  platform: "browser",
  jsx: "automatic",
  target: "es2022",
  alias: { "@": resolve(root, "src") },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env": JSON.stringify({
      VITE_SUPABASE_URL: "https://review.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "offline-review-public-fixture",
    }),
  },
  loader: {
    ".png": "dataurl",
    ".jpg": "dataurl",
    ".jpeg": "dataurl",
    ".svg": "dataurl",
    ".webp": "dataurl",
    ".woff2": "dataurl",
    ".ttf": "dataurl",
    ".css": "empty",
  },
  logLevel: "warning",
  plugins: [
    {
      name: "offline-review-boundary",
      setup(builder) {
        builder.onResolve({ filter: /./ }, (args) => {
          const target = aliases.get(args.path);
          if (target) return { path: resolve(fixtures, target) };
        });
        builder.onResolve({ filter: /\.functions(?:\.[cm]?tsx?)?$/ }, (args) => {
          const path = args.path.startsWith("@/")
            ? resolve(root, "src", args.path.slice(2))
            : resolve(args.resolveDir, args.path);
          return {
            path: /\.tsx?$/.test(path) ? path : path + ".ts",
            namespace: "fixture-functions",
          };
        });
        builder.onLoad({ filter: /.*/, namespace: "fixture-functions" }, async (args) => {
          const source = await readFile(args.path, "utf8");
          const ast = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true);
          const names = new Set();
          for (const statement of ast.statements) {
            const exported = statement.modifiers?.some(
              (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
            );
            if (exported && ts.isVariableStatement(statement))
              for (const declaration of statement.declarationList.declarations)
                if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
            if (exported && ts.isFunctionDeclaration(statement) && statement.name)
              names.add(statement.name.text);
          }
          const constants =
            "{free:{projects:3,members:1},plus:{projects:25,members:5},pro:{projects:100,members:20}}";
          return {
            contents:
              `import {fixtureFunction} from ${JSON.stringify(resolve(fixtures, "state.ts"))};\n` +
              [...names]
                .map((name) =>
                  /^[A-Z_0-9]+$/.test(name)
                    ? `export const ${name}=${constants};`
                    : `export const ${name}=(...args)=>fixtureFunction(${JSON.stringify(name)},...args);`,
                )
                .join("\n"),
            loader: "ts",
            resolveDir: root,
          };
        });
        builder.onLoad({ filter: /fixtures\/auth\.tsx$/ }, async (args) => {
          const authority = await readFile(args.path, "utf8");
          const source = await readFile(resolve(root, "src/components/auth/ClerkSafe.tsx"), "utf8");
          const marker = source.indexOf("// ---- Button / gate components");
          if (marker < 0)
            throw new Error("Actual auth presentation boundary changed; inspect before building.");
          const imports =
            '\nimport {cloneElement,isValidElement,useState,type MouseEvent,type ReactElement} from "react";\nimport {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuLabel,DropdownMenuSeparator,DropdownMenuTrigger} from "@/components/ui/dropdown-menu";\nimport {LogoutConfirmDialog} from "@/components/LogoutConfirmDialog";\nimport {LogOut,User as UserIcon} from "lucide-react";\nconst useAuthCtx=useReviewAuthContext;\nconst adaptUser=(user)=>user;\n';
          return {
            contents: authority + imports + source.slice(marker),
            loader: "tsx",
            resolveDir: dirname(args.path),
          };
        });
        builder.onLoad({ filter: /NovaLogo\.tsx$/ }, async (args) => ({
          contents: (await readFile(args.path, "utf8")).replaceAll(
            '"/kova-logo.png"',
            JSON.stringify(
              "data:image/png;base64," +
                (await readFile(resolve(root, "public/kova-logo.png"))).toString("base64"),
            ),
          ),
          loader: "tsx",
          resolveDir: dirname(args.path),
        }));
        builder.onLoad({ filter: /PluginLogo\.tsx$/ }, async (args) => {
          const map = {};
          for (const file of await readdir(resolve(root, "public/plugin-logos"))) {
            if (!/\.(webp|png|svg)$/.test(file)) continue;
            const mime =
              extname(file) === ".svg" ? "image/svg+xml" : "image/" + extname(file).slice(1);
            map[basename(file, extname(file))] =
              `data:${mime};base64,${(await readFile(resolve(root, "public/plugin-logos", file))).toString("base64")}`;
          }
          return {
            contents: (await readFile(args.path, "utf8")).replace(
              "`/plugin-logos/${id}.webp`",
              `(${JSON.stringify(map)})[id]`,
            ),
            loader: "tsx",
            resolveDir: dirname(args.path),
          };
        });
      },
    },
  ],
});
const cssFiles = (await readdir(cssDir)).filter((file) => file.endsWith(".css")).sort();
if (!cssFiles.length) throw new Error("A completed client CSS build is required.");
const cssManifest = [];
let css = "";
for (const file of cssFiles) {
  const contents = await readFile(resolve(cssDir, file), "utf8");
  cssManifest.push({ file, sha256: sha(contents) });
  css += contents + "\n";
}
for (const match of [...css.matchAll(/url\(["']?(\/fonts\/[^)"']+)["']?\)/g)]) {
  const file = await readFile(resolve(root, "public", match[1].slice(1)));
  css = css.replaceAll(match[0], `url(data:font/woff2;base64,${file.toString("base64")})`);
}
css = css.replace(/@import\s+url\([^)]*\)[^;]*;/g, "");
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text;
const componentHTML = `<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'unsafe-inline';style-src 'unsafe-inline';img-src data: blob:;font-src data:;connect-src 'none';"><style>${css.replaceAll("</style", "<\\/style")}</style></head><body><div id="root"></div><script>${js.replaceAll("</script", "<\\/script")}</script></body></html>`;
const pages = [
  ["/", "Assistant"],
  ["/library", "Library"],
  ["/images", "Images"],
  ["/projects", "Projects"],
  ["/projects/11111111-1111-4111-8111-111111111111", "Project detail"],
  ["/scheduled-tasks", "Scheduled tasks"],
  ["/apps", "Plugins"],
  ["/settings", "Settings"],
  ["/pricing", "Plans"],
  ["/billing", "Billing"],
  ["/sign-in", "Log in"],
  ["/sign-up", "Sign up"],
  ["/auth", "Password recovery"],
  ["/help", "Help"],
  ["/terms", "Terms"],
  ["/privacy", "Privacy"],
  ["/refund", "Refund policy"],
  ["/contact-support", "Contact support"],
];
const wrapper = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KovaGPT · Source review</title><style>*{box-sizing:border-box}body{margin:0;height:100dvh;display:flex;flex-direction:column;background:#101010;color:#f4f4f4;font:13px system-ui}header{padding:10px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}h1{font-size:14px;margin:0}#review-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}label{display:flex;align-items:center;gap:5px}button,select{background:#202020;color:inherit;border:1px solid #555;border-radius:8px;padding:6px 9px;font:inherit}p{margin:0;padding:0 16px 8px;color:#bbb;font-size:12px}main{flex:1;min-height:0;display:flex;justify-content:center;padding:0 8px 8px}iframe{width:100%;max-width:100%;height:100%;border:1px solid #444;background:#111;border-radius:8px}.phone iframe{width:390px}.tablet iframe{width:768px}#controls-toggle{display:none}@media(max-width:700px){header{padding:8px 12px;justify-content:space-between}#controls-toggle{display:block}#review-controls{display:none;width:100%}body[data-controls=open] #review-controls{display:flex}p{font-size:11px;padding:0 12px 6px}main{padding:0}}</style></head><body data-controls="closed"><header><h1>KovaGPT · Source review</h1><button id="controls-toggle" aria-expanded="false" aria-controls="review-controls">Review controls</button><div id="review-controls"><label>Page<select id="page">${pages.map(([path, label]) => `<option value="${path}">${label}</option>`).join("")}</select></label><label>Account<select id="account"><option>guest</option><option>free</option><option>plus</option><option>pro</option></select></label><label>Data<select id="data"><option value="populated">populated fixtures</option><option value="empty">empty</option></select></label><label>Theme<select id="theme"><option>dark</option><option>light</option></select></label><button data-device="desktop">Desktop</button><button data-device="phone">Phone</button><button data-device="tablet">Tablet</button><button id="back">Back</button></div></header><p>Actual source components · Offline fixtures. Accounts, AI, billing and providers are disconnected.</p><main><iframe title="KovaGPT source components"></iframe></main><script>const frame=document.querySelector('iframe');frame.srcdoc=${JSON.stringify(componentHTML).replaceAll("</script", "<\\/script")};const send=data=>frame.contentWindow.postMessage({type:'kova-review-control',...data},'*');document.querySelector('#page').onchange=e=>send({path:e.target.value});document.querySelector('#account').onchange=e=>send({account:e.target.value});document.querySelector('#data').onchange=e=>send({populated:e.target.value==='populated'});document.querySelector('#theme').onchange=e=>send({theme:e.target.value});document.querySelector('#back').onclick=()=>send({back:true});document.querySelectorAll('[data-device]').forEach(button=>button.onclick=()=>document.querySelector('main').className=button.dataset.device);document.querySelector('#controls-toggle').onclick=e=>{const open=document.body.dataset.controls!=='open';document.body.dataset.controls=open?'open':'closed';e.target.setAttribute('aria-expanded',String(open))};window.addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.type==='kova-review-route')document.querySelector('#page').value=event.data.path});</script></body></html>`;
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "KovaGPT-Core-Review.html"), wrapper);
await writeFile(resolve(output, "components.html"), componentHTML);
const componentPaths = [
  ...new Set([
    ...Object.keys(result.metafile.inputs).filter((path) => path.startsWith("src/")),
    "src/components/auth/ClerkSafe.tsx",
  ]),
].sort();
const components = await Promise.all(
  componentPaths.map(async (path) => ({
    path,
    sha256: sha(await readFile(resolve(root, path.split("?")[0]))),
  })),
);
const fixturePaths = (await readdir(fixtures)).sort();
const manifest = {
  generatedAt: new Date().toISOString(),
  baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  htmlSha256: sha(wrapper),
  bundleSha256: sha(js),
  cssDir,
  cssFiles: cssManifest,
  components,
  fixtures: await Promise.all(
    fixturePaths.map(async (path) => ({
      path,
      sha256: sha(await readFile(resolve(fixtures, path))),
    })),
  ),
  pages,
  boundary:
    "Real UI source; synthetic account/data/server reads only. All provider traffic blocked. No remote writes.",
  limitations: [
    "Live authentication, billing, AI generation, providers and task execution are not connected.",
    "Document extraction worker is not bundled; image/text attachment controls can be reviewed.",
    "File preview does not certify real device camera, virtual keyboard, Safari or production service behavior.",
  ],
};
await writeFile(resolve(output, "source-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(
  JSON.stringify({
    html: resolve(output, "KovaGPT-Core-Review.html"),
    bytes: Buffer.byteLength(wrapper),
    components: components.length,
    cssFiles: cssFiles.length,
  }),
);
