import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

export async function buildPluginPreview(root, out) {
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: [join(root, "review-kit/plugin-preview.tsx")],
    outfile: join(out, "plugin-preview.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    loader: { ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: [join(root, "review-kit/core-preview.tsx")],
    outfile: join(out, "core-preview.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    loader: { ".svg": "dataurl" },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: [join(root, "review-kit/voice-preview.tsx")],
    outfile: join(out, "voice-preview.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: [join(root, "review-kit/sources-preview.tsx")],
    outfile: join(out, "sources-preview.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  await build({
    entryPoints: [join(root, "review-kit/account-deletion-preview.tsx")],
    outfile: join(out, "account-deletion-preview.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    alias: { "@": join(root, "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const compiler = await compile(readFileSync(join(root, "src/styles.css"), "utf8"), {
    base: join(root, "src"),
    onDependency() {},
  });
  const scanner = new Scanner({
    sources: [
      { base: root, pattern: "src/**/*.{ts,tsx}", negated: false },
      { base: root, pattern: "review-kit/**/*.{ts,tsx}", negated: false },
    ],
  });
  writeFileSync(join(out, "plugin-preview.css"), compiler.build(scanner.scan()));
  writeFileSync(
    join(out, "plugin-preview.html"),
    '<!doctype html><html class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kova plugin connection review</title><link rel="stylesheet" href="/review/plugin-preview.css"></head><body><div id="root"></div><script type="module" src="/review/plugin-preview.js"></script></body></html>',
  );
  writeFileSync(
    join(out, "core-preview.html"),
    readFileSync(join(out, "plugin-preview.html"), "utf8")
      .replace("plugin-preview.js", "core-preview.js")
      .replace("</head>", '<link rel="stylesheet" href="/review/core-preview.css"></head>')
      .replace("Kova plugin connection review", "Kova core interface review"),
  );
  writeFileSync(
    join(out, "voice-preview.html"),
    readFileSync(join(out, "plugin-preview.html"), "utf8")
      .replace("plugin-preview.js", "voice-preview.js")
      .replace("</head>", '<link rel="stylesheet" href="/review/voice-preview.css"></head>')
      .replace("Kova plugin connection review", "Kova voice state review"),
  );
  writeFileSync(
    join(out, "sources-preview.html"),
    readFileSync(join(out, "voice-preview.html"), "utf8")
      .replaceAll("voice-preview", "sources-preview")
      .replace("Kova voice state review", "Kova browser activity review"),
  );
  writeFileSync(
    join(out, "account-deletion-preview.html"),
    readFileSync(join(out, "voice-preview.html"), "utf8")
      .replaceAll("voice-preview", "account-deletion-preview")
      .replace("Kova voice state review", "Kova account deletion and recovery review"),
  );
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  await buildPluginPreview(process.cwd(), resolve(process.argv[2]));
