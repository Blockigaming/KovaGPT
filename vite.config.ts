import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart({ server: { entry: "src/server.ts" } }),
    react(),
  ],
  server: { host: "0.0.0.0", port: 5173 },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/src/components/SettingsDialog")) return "settings";
          if (id.includes("/src/components/ChatInput")) return "chat-input";
          if (id.includes("/src/components/ChatMessage")) return "chat-message";
          if (id.includes("/src/lib/connectors-catalog")) return "connectors";
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("d3-")) return "charts";
          if (id.includes("react-markdown") || id.includes("remark-") || id.includes("micromark"))
            return "markdown";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@radix-ui") || id.includes("lucide-react")) return "ui";
          if (id.includes("react") || id.includes("@tanstack")) return "react";
        },
      },
    },
  },
});
