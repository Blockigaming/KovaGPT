import { defineConfig } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const useNodeBrowserPreview = process.env.KOVA_BROWSER_PREVIEW === "node";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tsconfigPaths({ projects: ["./tsconfig.json"] }),
    // TanStack resolves this entry relative to the default src directory.
    // Using "src/server.ts" would incorrectly resolve to "src/src/server.ts".
    tanstackStart({ server: { entry: "server" } }),
    // Production deploys the generated Nitro Cloudflare module. Browser CI
    // uses Nitro's in-process Node preview to avoid Wrangler's dev-only proxy.
    nitro({
      preset: useNodeBrowserPreview ? "node-server" : "cloudflare-module",
      output: {
        dir: "dist",
        serverDir: "dist/server",
        publicDir: "dist/client",
      },
      ...(useNodeBrowserPreview ? {} : { cloudflare: { nodeCompat: true, deployConfig: true } }),
    }),
    react(),
  ],
  ssr: {
    noExternal: ["h3-v2", "rou3"],
  },
});
