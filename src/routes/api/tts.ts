import { createFileRoute } from "@tanstack/react-router";
import { requireUser } from "@/lib/api-auth.server";

// Streams MP3 from Lovable AI text-to-speech (openai/gpt-4o-mini-tts).
// Server-side proxy — keeps LOVABLE_API_KEY off the client.
export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "TTS not configured" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        let body: { text?: string; voice?: string; speed?: number };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const text = (body.text ?? "").trim();
        if (!text) {
          return new Response(JSON.stringify({ error: "Missing text" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (text.length > 4000) {
          return new Response(JSON.stringify({ error: "Text too long" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }

        const allowed = new Set([
          "alloy", "ash", "ballad", "coral", "echo",
          "sage", "shimmer", "verse", "marin", "cedar",
        ]);
        const voice = allowed.has(body.voice ?? "") ? body.voice! : "alloy";
        const speed = Math.min(4, Math.max(0.25, body.speed ?? 1));

        const upstream = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: text,
            voice,
            speed,
            response_format: "mp3",
          }),
          signal: request.signal,
        });

        if (!upstream.ok) {
          const msg = await upstream.text().catch(() => "");
          return new Response(
            JSON.stringify({ error: msg || `TTS failed (${upstream.status})` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
