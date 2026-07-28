import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Lovable Cloud runs the public TanStack Start Vite stack directly. Keep the
// Start plugin ahead of React and avoid the legacy private Lovable adapter;
// this is also the supported Nitro/h3-v2 production configuration.
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
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/components/ChatInput")) return "chat-input";
          if (id.includes("/src/components/ChatMessage")) return "chat-message";
          if (id.includes("/src/lib/connectors-catalog")) return "connectors";
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("micromark")) {
            return "markdown";
          }
          if (id.includes("@supabase")) return "supabase";
        },
      },
    },
  },

  // TanStack Start imports its H3 v2 release through the npm alias `h3-v2`,
  // which in turn imports `rou3`. Lovable's runtime only installs declared
  // production package names, so external imports can survive the build but
  // cannot be resolved at boot. Bundle the complete routing edge into the SSR
  // output instead of relying on packages being present in the runtime image.
  ssr: {
    noExternal: ["h3-v2", "rou3"],
  },
});
