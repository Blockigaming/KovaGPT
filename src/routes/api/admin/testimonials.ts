import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdministrator } from "@/lib/administrator.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const ReviewInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  published: z.boolean(),
});

export const Route = createFileRoute("/api/admin/testimonials")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = await requireAdministrator(request);
        if ("response" in authorization) return authorization.response;

        const { data, error } = await supabaseAdmin
          .from("testimonial_submissions")
          .select(
            "id,owner_id,quote,display_name,display_role,consent_to_publish,status,published,submitted_at,reviewed_at,reviewed_by",
          )
          .order("submitted_at", { ascending: false })
          .limit(200);

        if (error) {
          return Response.json(
            { error: "testimonial_list_failed" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          { testimonials: Array.isArray(data) ? data : [] },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const authorization = await requireAdministrator(request);
        if ("response" in authorization) return authorization.response;

        let input: z.infer<typeof ReviewInput>;
        try {
          input = ReviewInput.parse(await request.json());
        } catch {
          return Response.json(
            { error: "invalid_request" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (input.published && input.decision !== "approved") {
          return Response.json(
            { error: "publication_requires_approval" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        const { data: existing, error: existingError } = await supabaseAdmin
          .from("testimonial_submissions")
          .select("id,consent_to_publish")
          .eq("id", input.id)
          .maybeSingle();

        if (existingError || !existing) {
          return Response.json(
            { error: "testimonial_not_found" },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (input.published && existing.consent_to_publish !== true) {
          return Response.json(
            { error: "publication_requires_consent" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        const { data, error } = await supabaseAdmin
          .from("testimonial_submissions")
          .update({
            status: input.decision,
            published: input.decision === "approved" ? input.published : false,
            reviewed_at: new Date().toISOString(),
            reviewed_by: authorization.caller.userId,
          })
          .eq("id", input.id)
          .select("id,status,published,reviewed_at,reviewed_by")
          .single();

        if (error) {
          return Response.json(
            { error: "testimonial_review_failed" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          { testimonial: data },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
