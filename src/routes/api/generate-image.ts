import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/generate-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { prompt } = (await request.json()) as { prompt: string };
          if (!prompt || typeof prompt !== "string") {
            return new Response(JSON.stringify({ error: "Prompt required" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-image",
              messages: [{ role: "user", content: prompt }],
              modalities: ["image", "text"],
            }),
          });

          if (!upstream.ok) {
            if (upstream.status === 429) {
              return new Response(JSON.stringify({ error: "Rate limit. Try again soon." }), {
                status: 429,
                headers: { "Content-Type": "application/json" },
              });
            }
            if (upstream.status === 402) {
              return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
                status: 402,
                headers: { "Content-Type": "application/json" },
              });
            }
            const t = await upstream.text();
            return new Response(JSON.stringify({ error: t || "Image gen failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const data = await upstream.json();
          // Find image url in assistant message
          const msg = data.choices?.[0]?.message;
          let imageUrl: string | null = null;
          if (msg?.images && Array.isArray(msg.images) && msg.images.length > 0) {
            imageUrl = msg.images[0]?.image_url?.url ?? null;
          }
          if (!imageUrl && Array.isArray(msg?.content)) {
            for (const p of msg.content) {
              if (p.type === "image_url" && p.image_url?.url) {
                imageUrl = p.image_url.url;
                break;
              }
            }
          }
          if (!imageUrl) {
            return new Response(
              JSON.stringify({ error: "No image returned by model" }),
              { status: 500, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(JSON.stringify({ imageUrl }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
