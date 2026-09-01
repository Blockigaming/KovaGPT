import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ["./tsconfig.json"] })],
  build: {
    ssr: path.resolve(root, "src/workers/work-v2.ts"),
    outDir: path.resolve(root, "dist/worker"),
    // The scheduled-worker build clears this shared directory first. A Work
    // build adds its immutable entry without deleting the sibling bundle.
    emptyOutDir: false,
    target: "node24",
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "work-v2.mjs",
        inlineDynamicImports: true,
      },
    },
  },
  ssr: {
    // The runtime image contains dist and package.json, not node_modules.
    noExternal: true,
  },
});
