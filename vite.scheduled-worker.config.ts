import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  build: {
    ssr: path.resolve(root, "src/workers/scheduled-v2.ts"),
    outDir: path.resolve(root, "dist/worker"),
    emptyOutDir: true,
    target: "node24",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "scheduled-v2.mjs",
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    // The production runtime image intentionally contains only dist and
    // package.json. Bundle application dependencies into the one-shot worker.
    noExternal: true,
  },
});
