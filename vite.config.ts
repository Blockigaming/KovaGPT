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
  // TanStack Start imports its H3 v2 release through the npm alias `h3-v2`.
  // Lovable's runtime only installs declared production package names, so an
  // external alias import survives the build but cannot be resolved at boot.
  // Bundle the alias into the SSR output instead of leaving that runtime edge.
  ssr: {
    noExternal: ["h3-v2"],
  },
});
