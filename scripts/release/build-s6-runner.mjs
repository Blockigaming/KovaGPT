import { build, transform } from "esbuild";
import { readFile } from "node:fs/promises";
import { requiredDeployedChecks } from "./kova-auth-cutover-gate.mjs";
const source = await readFile("src/lib/kova-auth-realtime.ts", "utf8");
const compiled = await transform(source, { loader: "ts", format: "cjs", target: "node22" });
await build({
  entryPoints: ["scripts/release/s6-runner-entry.mjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: process.argv[2] ?? "/tmp/kova-s6-runner.cjs",
  define: { S6_REALTIME_SOURCE: JSON.stringify(compiled.code) },
  plugins: [
    {
      name: "gate-constants-only",
      setup(builder) {
        builder.onLoad({ filter: /kova-auth-cutover-gate\.mjs$/ }, () => ({
          contents: `export const requiredDeployedChecks=${JSON.stringify(requiredDeployedChecks)}`,
          loader: "js",
        }));
      },
    },
  ],
  logLevel: "warning",
});
