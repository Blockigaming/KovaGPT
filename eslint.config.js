import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi", ".nitro", "work-runner/build"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // Keep the established Hooks correctness checks explicit. Version 7's
      // recommended preset also enables React Compiler adoption rules, which
      // are useful for migrations but are not correctness requirements for
      // this non-compiled React application.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // Keep the pinned upstream API/types byte-identical except the audited traversal fix.
    // Runtime behavior and source identity are exercised by history-traversal-cancel tests.
    files: ["src/vendor/tanstack-history/index.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
  {
    // These modules are intentionally public facades rather than route-level
    // component modules: shadcn-style primitives export variants, the auth
    // facade exports hooks and controls together, and email templates export
    // renderers with delivery metadata. Fast Refresh boundaries do not apply
    // to these modules, while keeping the rule active everywhere else catches
    // accidental mixed exports in application components.
    files: [
      "src/components/ui/**/*.{ts,tsx}",
      "src/components/auth/ClerkSafe.tsx",
      "src/components/PersonalitySliders.tsx",
      "src/lib/email-templates/**/*.{ts,tsx}",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
);
