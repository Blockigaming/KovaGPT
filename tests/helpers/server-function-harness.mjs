import { z } from "zod";
import { loadUiModule } from "./ui-state-harness.mjs";
export function loadServerFunctions(path) {
  const createServerFn = () => {
    let validate = (value) => value;
    const builder = {
      middleware: () => builder,
      validator: (fn) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn) =>
        async ({ data, context }) =>
          fn({ data: validate(data), context }),
    };
    return builder;
  };
  const pages = loadUiModule(
    "src/lib/read-bounded-collection.ts",
    { zod: { z } },
    { AbortSignal, TextEncoder, Error },
  );
  return loadUiModule(
    path,
    {
      zod: { z },
      "@tanstack/react-start": { createServerFn },
      "@/lib/supabase-loose": { loose: (value) => value },
      "@/lib/read-bounded-collection": pages,
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: () => {} },
    },
    { AbortSignal, Error, crypto: globalThis.crypto },
  );
}
