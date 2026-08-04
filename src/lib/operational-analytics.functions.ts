import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const forbidden = /prompt|message|document|memory|evidence|file|secret|token|url|content|error/i;
const names = z.enum(["route.viewed", "command.executed", "agent.imported", "agent.exported"]);
const allowedKeys: Record<z.infer<typeof names>, readonly string[]> = {
  "route.viewed": ["route"],
  "command.executed": ["command"],
  "agent.imported": ["sourceVersion"],
  "agent.exported": ["sourceVersion"],
};
const Event = z
  .object({
    eventName: names,
    occurredAt: z.string().datetime(),
    metadata: z
      .record(z.string().max(40), z.union([z.string().max(120), z.number().finite(), z.boolean()]))
      .refine(
        (value) =>
          Object.keys(value).length <= 12 &&
          Object.keys(value).every((key) => !forbidden.test(key)),
      ),
  })
  .superRefine((event, context) => {
    const allowed = allowedKeys[event.eventName];
    for (const key of Object.keys(event.metadata))
      if (!allowed.includes(key))
        context.addIssue({
          code: "custom",
          path: ["metadata", key],
          message: "Metadata key is not allowed for this event.",
        });
  });

export const submitOperationalEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ events: z.array(Event).min(1).max(20) }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await (
      context.supabase as unknown as {
        from: (name: string) => { insert: (rows: unknown[]) => Promise<{ error: unknown }> };
      }
    )
      .from("operational_events")
      .insert(
        data.events.map((event) => ({
          owner_id: context.userId,
          event_name: event.eventName,
          occurred_at: event.occurredAt,
          metadata: event.metadata,
        })),
      );
    if (error) throw new Error("Operational analytics are unavailable.");
    return { accepted: data.events.length };
  });
