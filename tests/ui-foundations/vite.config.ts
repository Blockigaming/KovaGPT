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
  resolve: {
    alias: [
      ...[
        "@/hooks/useTier",
        "@/hooks/use-library-attachment-auto-save",
        "@/lib/scheduled-tasks.functions",
        "@tanstack/react-start",
      ].map((find) => ({
        find,
        replacement: fileURLToPath(new URL("./fixture/workspace-services.ts", import.meta.url)),
      })),
      {
        find: "@/components/auth/ClerkSafe",
        replacement: fileURLToPath(new URL("./fixture/auth.ts", import.meta.url)),
      },
      { find: "@", replacement: fileURLToPath(new URL("../../src", import.meta.url)) },
    ],
  },
  build: {
    outDir: fileURLToPath(new URL("../../test-results/ui-foundations/site", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        workspace: fileURLToPath(new URL("./fixture/workspace.html", import.meta.url)),
        main: fileURLToPath(new URL("./fixture/index.html", import.meta.url)),
        palette: fileURLToPath(new URL("./fixture/palette.html", import.meta.url)),
      },
    },
  },
});
