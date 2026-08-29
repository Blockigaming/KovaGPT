import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requireAdministrator } from "@/lib/administrator.server";

const ReviewInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approved", "rejected"]),
  published: z.boolean(),
});

const ExistingTestimonial = z.object({
  id: z.string(),
  consent_to_publish: z.boolean(),
});

const ReviewedTestimonial = z.object({
  id: z.string(),
  status: z.string(),
  published: z.boolean(),
  reviewed_at: z.string().nullable(),
  reviewed_by: z.string().nullable(),
});

function serviceConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url, key } : null;
}

function serviceHeaders(key: string, extra?: Record<string, string>) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Cache-Control": "no-store",
    ...extra,
  };
}

export const Route = createFileRoute("/api/admin/testimonials")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authorization = await requireAdministrator(request);
        if ("response" in authorization) return authorization.response;

        const config = serviceConfig();
        if (!config) {
          return Response.json(
            { error: "testimonial_store_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }

        const params = new URLSearchParams({
          select:
            "id,owner_id,quote,display_name,display_role,consent_to_publish,status,published,submitted_at,reviewed_at,reviewed_by",
          order: "submitted_at.desc",
          limit: "200",
        });
        const response = await fetch(`${config.url}/rest/v1/testimonial_submissions?${params}`, {
          headers: serviceHeaders(config.key),
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);

        if (!response?.ok) {
          return Response.json(
            { error: "testimonial_list_failed" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }

        const testimonials = await response.json().catch(() => []);
        return Response.json(
          { testimonials: Array.isArray(testimonials) ? testimonials : [] },
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

        const config = serviceConfig();
        if (!config) {
          return Response.json(
            { error: "testimonial_store_unavailable" },
            { status: 503, headers: { "Cache-Control": "no-store" } },
          );
        }

        const lookupParams = new URLSearchParams({
          select: "id,consent_to_publish",
          id: `eq.${input.id}`,
          limit: "1",
        });
        const existingResponse = await fetch(
          `${config.url}/rest/v1/testimonial_submissions?${lookupParams}`,
          {
            headers: serviceHeaders(config.key),
            signal: AbortSignal.timeout(5000),
          },
        ).catch(() => null);
        const existingRows = existingResponse?.ok
          ? await existingResponse.json().catch(() => [])
          : [];
        const existing = ExistingTestimonial.safeParse(
          Array.isArray(existingRows) ? existingRows[0] : null,
        );

        if (!existing.success) {
          return Response.json(
            { error: "testimonial_not_found" },
            { status: 404, headers: { "Cache-Control": "no-store" } },
          );
        }

        if (input.published && !existing.data.consent_to_publish) {
          return Response.json(
            { error: "publication_requires_consent" },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          );
        }

        const review = {
          status: input.decision,
          published: input.decision === "approved" ? input.published : false,
          reviewed_at: new Date().toISOString(),
          reviewed_by: authorization.caller.userId,
        };
        const updateParams = new URLSearchParams({
          id: `eq.${input.id}`,
          select: "id,status,published,reviewed_at,reviewed_by",
        });
        const updateResponse = await fetch(
          `${config.url}/rest/v1/testimonial_submissions?${updateParams}`,
          {
            method: "PATCH",
            headers: serviceHeaders(config.key, {
              "Content-Type": "application/json",
              Prefer: "return=representation",
            }),
            body: JSON.stringify(review),
            signal: AbortSignal.timeout(5000),
          },
        ).catch(() => null);
        const updatedRows = updateResponse?.ok
          ? await updateResponse.json().catch(() => [])
          : [];
        const updated = ReviewedTestimonial.safeParse(
          Array.isArray(updatedRows) ? updatedRows[0] : null,
        );

        if (!updated.success) {
          return Response.json(
            { error: "testimonial_review_failed" },
            { status: 500, headers: { "Cache-Control": "no-store" } },
          );
        }

        return Response.json(
          { testimonial: updated.data },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
