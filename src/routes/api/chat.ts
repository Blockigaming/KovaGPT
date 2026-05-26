import { createFileRoute } from "@tanstack/react-router";
import { getMode, type ModeId } from "@/lib/modes";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: { kind: "image"; dataUrl: string }[];
};

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { messages, mode } = (await request.json()) as {
            messages: IncomingMessage[];
            mode?: ModeId;
          };
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          const m = getMode(mode ?? "auto");
          const hasImages = messages.some((msg) => (msg.attachments?.length ?? 0) > 0);

          // Transform messages to OpenAI-compatible content with image_url parts when needed
          const transformed = messages.map((msg) => {
            if (msg.role === "user" && msg.attachments && msg.attachments.length > 0) {
              const parts: any[] = [];
              if (msg.content) parts.push({ type: "text", text: msg.content });
              for (const att of msg.attachments) {
                parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
              }
              return { role: "user", content: parts };
            }
            return { role: msg.role, content: msg.content };
          });

          // Use pro model only for reasoning; flash-lite for speed by default
          const model =
            m.id === "reason"
              ? "google/gemini-2.5-pro"
              : hasImages
                ? "google/gemini-2.5-flash"
                : "google/gemini-2.5-flash-lite";

          const body: Record<string, unknown> = {
            model,
            stream: true,
            messages: [{ role: "system", content: m.systemPrompt }, ...transformed],
          };
          if (m.reasoning) {
            body.reasoning = { effort: m.reasoning };
          }

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
          });

          if (!upstream.ok) {
            if (upstream.status === 429) {
              return new Response(
                JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }),
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            if (upstream.status === 402) {
              return new Response(
                JSON.stringify({ error: "AI credits exhausted." }),
                { status: 402, headers: { "Content-Type": "application/json" } },
              );
            }
            const txt = await upstream.text();
            return new Response(JSON.stringify({ error: txt || "AI gateway error" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(upstream.body, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
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
