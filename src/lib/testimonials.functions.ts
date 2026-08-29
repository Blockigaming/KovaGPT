import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type TestimonialQuery = {
  insert: (value: Record<string, unknown>) => TestimonialQuery;
  select: (columns: string) => TestimonialQuery;
  eq: (column: string, value: unknown) => TestimonialQuery;
  order: (column: string, options: { ascending: boolean }) => TestimonialQuery;
  single: () => Promise<{ data: unknown; error: unknown }>;
  then: PromiseLike<{ data: unknown; error: unknown }>["then"];
};

const TestimonialInput = z.object({
  quote: z.string().trim().min(20).max(1000),
  displayName: z.string().trim().min(1).max(120),
  displayRole: z.string().trim().min(1).max(160).optional(),
  consentToPublish: z.literal(true),
});

const SubmittedTestimonial = z.object({
  id: z.string(),
  status: z.string(),
  submitted_at: z.string(),
});

const TestimonialHistoryItem = z.object({
  id: z.string(),
  quote: z.string(),
  display_name: z.string(),
  display_role: z.string().nullable(),
  consent_to_publish: z.boolean(),
  status: z.string(),
  published: z.boolean(),
  submitted_at: z.string(),
  reviewed_at: z.string().nullable(),
});

function table(context: { supabase: unknown }): TestimonialQuery {
  return (context.supabase as { from: (name: string) => TestimonialQuery }).from(
    "testimonial_submissions",
  );
}

export const submitTestimonial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => TestimonialInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await table(context)
      .insert({
        owner_id: context.userId,
        quote: data.quote,
        display_name: data.displayName,
        display_role: data.displayRole ?? null,
        consent_to_publish: true,
        status: "pending",
        published: false,
      })
      .select("id,status,submitted_at")
      .single();

    if (error) throw new Error("Testimonial could not be submitted.");
    return SubmittedTestimonial.parse(inserted);
  });

export const listMyTestimonials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await table(context)
      .select(
        "id,quote,display_name,display_role,consent_to_publish,status,published,submitted_at,reviewed_at",
      )
      .eq("owner_id", context.userId)
      .order("submitted_at", { ascending: false });

    if (error) throw new Error("Testimonials could not be loaded.");
    return z.array(TestimonialHistoryItem).parse(data);
  });
