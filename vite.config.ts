import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Lovable's TanStack config wrapper owns the plugin stack (Start, React,
// Tailwind, tsconfig paths) and produces a correctly bundled server output.
// Only the custom server entry is overridden here.
export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
});
