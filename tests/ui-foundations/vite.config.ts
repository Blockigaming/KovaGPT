import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: fileURLToPath(new URL("./fixture", import.meta.url)),
  // Never load application secrets into this isolated, non-deployable fixture.
  envDir: false,
  publicDir: false,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) } },
  build: {
    outDir: fileURLToPath(new URL("../../test-results/ui-foundations/site", import.meta.url)),
    emptyOutDir: true,
  },
});
