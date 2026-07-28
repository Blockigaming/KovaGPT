import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Keep the Lovable-compatible TanStack Start stack explicit and built only
// from public packages. This preserves the same Vite runtime behavior without
// making installs or production startup depend on a private platform package.
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "src/server.ts" } }),
    react(),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
  },
});
