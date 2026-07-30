import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    // TanStack resolves custom entries relative to srcDirectory ("src" by
    // default). Using "src/server.ts" resolves to src/src/server.ts and
    // silently falls back to the framework entry, bypassing our production
    // error handling, security headers, and runtime bindings.
    tanstackStart({ server: { entry: "server" } }),
    react(),
  ],
  ssr: {
    noExternal: ["h3-v2", "rou3"],
  },
});
