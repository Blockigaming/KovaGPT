import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { nitro } from "nitro/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";

const useNodeBrowserPreview = process.env.KOVA_BROWSER_PREVIEW === "node";
const buildSha = process.env.KOVA_BUILD_SHA || process.env.GITHUB_SHA || "unknown";
const buildTime = process.env.KOVA_BUILD_TIME || new Date().toISOString();
const appVersion = process.env.npm_package_version || "0.0.0";
const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const serverEnv = loadEnv(mode, process.cwd(), "");
  Object.assign(process.env, serverEnv);

  return {
    define: {
      "import.meta.env.VITE_KOVA_BUILD_SHA": JSON.stringify(buildSha),
      "import.meta.env.VITE_KOVA_BUILD_TIME": JSON.stringify(buildTime),
      "import.meta.env.VITE_KOVA_APP_VERSION": JSON.stringify(appVersion),
    },
    plugins: [
      tailwindcss(),
      tsconfigPaths({ projects: ["./tsconfig.json"] }),
      // TanStack resolves this entry relative to the default src directory.
      // Using "src/server.ts" would incorrectly resolve to "src/src/server.ts".
      tanstackStart({ server: { entry: "server" } }),
      // Production deploys the generated Nitro Cloudflare module. Browser CI
      // uses Nitro's in-process Node preview to avoid Wrangler's dev-only proxy.
      nitro({
        // Keep build intermediates local even when isolated worktrees share dependencies.
        buildDir: path.resolve(configDir, ".nitro"),
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
    resolve: {
      alias: [
        {
          find: /^lucide-react$/,
          replacement: path.resolve(configDir, "src/components/ui/product-icons.tsx"),
        },
        {
          find: "entities/lib/decode.js",
          replacement: path.resolve(configDir, "node_modules/entities/lib/decode.js"),
        },
        {
          find: "entities/lib/encode.js",
          replacement: path.resolve(configDir, "node_modules/entities/lib/encode.js"),
        },
        { find: "entities", replacement: path.resolve(configDir, "node_modules/entities") },
      ],
    },
    worker: { format: "es" },
    build: {
      manifest: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            // The pinned SDK adapter replaces lucide-react at its exact entry alias.
            // Keep its glyphs in the existing icon vendor cache chunk as well.
            const normalizedId = id.replaceAll("\\", "/").split("?")[0];
            const referenceIconRoot = path
              .resolve(configDir, "src/components/ui/product-icons")
              .replaceAll("\\", "/");
            if (
              normalizedId === `${referenceIconRoot}.tsx` ||
              (normalizedId.startsWith(`${referenceIconRoot}/`) &&
                /^(?:factory|(?:glyphs|icons)\/[^/]+)\.tsx$/.test(
                  normalizedId.slice(referenceIconRoot.length + 1),
                ))
            )
              return "vendor-icons";
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
            if (id.includes("/@clerk/") || id.includes("/@supabase/")) {
              return "vendor-account";
            }
            if (id.includes("/@tanstack/")) return "vendor-tanstack";
            if (id.includes("/lucide-react/")) return "vendor-icons";
            if (id.includes("/react-dom/") || id.includes("/react/")) {
              return "vendor-react";
            }
          },
        },
      },
    },
  };
});
