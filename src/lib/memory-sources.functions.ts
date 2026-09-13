import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { inspectMemorySources } from "@/lib/memory-sources.server.mjs";

const Ref = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("chat_memory"), id: z.string().uuid() }),
  z.object({ kind: z.literal("conversation_summary"), id: z.string().uuid() }),
  z.object({
    kind: z.literal("project_memory"),
    id: z.string().uuid(),
    projectId: z.string().uuid(),
  }),
]);
export const readMemorySources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ ownerId: z.string().uuid(), sources: z.array(Ref).min(1).max(20) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    setResponseHeader("Vary", "Authorization");
    return inspectMemorySources(context.supabase, context.userId, data);
  });
