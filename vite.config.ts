import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Public, provider-direct TanStack Start configuration. The previous private
// the former private TanStack config package bundled these same public plugins
// plus private-platform development hooks; keeping the stack explicit restores
// local install/build without private registry access or private runtime code.
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
