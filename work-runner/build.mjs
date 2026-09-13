import { build } from "esbuild";
// PDF browser URL imports are inert here: the runner injects the local font bytes.
await build({
  entryPoints: ["work-runner/office.ts"],
  outfile: "work-runner/build/office.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "injected-fonts",
      setup(builder) {
        builder.onResolve({ filter: /\.ttf\?url$/ }, () => ({
          path: "font",
          namespace: "injected-font",
        }));
        builder.onLoad({ filter: /.*/, namespace: "injected-font" }, () => ({
          contents: 'export default "injected-local-font";',
          loader: "js",
        }));
      },
    },
  ],
});
