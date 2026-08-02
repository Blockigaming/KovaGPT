import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    // TanStack resolves this entry relative to the default src directory.
    // Using "src/server.ts" would incorrectly resolve to "src/src/server.ts".
    tanstackStart({ server: { entry: "server" } }),
    react(),
  ],
  ssr: {
    noExternal: ["h3-v2", "rou3"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/micromark") ||
            id.includes("/mdast-") ||
            id.includes("/hast-") ||
            id.includes("/unist-")
          )
            return "vendor-markdown";
          if (id.includes("/@radix-ui/") || id.includes("/cmdk/") || id.includes("/vaul/"))
            return "vendor-overlays";
          if (id.includes("/@clerk/") || id.includes("/@supabase/")) return "vendor-account";
          if (id.includes("/@tanstack/")) return "vendor-tanstack";
          if (id.includes("/lucide-react/")) return "vendor-icons";
          if (id.includes("/react-dom/") || id.includes("/react/")) return "vendor-react";
        },
      },
    },
  },
});
