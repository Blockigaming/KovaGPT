import { createFileRoute } from "@tanstack/react-router";


export const Route = createFileRoute("/api/title")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {

          const MAX_BODY = 1 * 1024 * 1024;
          const contentLength = Number(request.headers.get("content-length") ?? "0");
          if (contentLength > MAX_BODY) {
            return new Response(JSON.stringify({ error: "Request too large." }), {
              status: 413,
              headers: { "Content-Type": "application/json" },
            });
          }
          const raw = await request.text();
          if (raw.length > MAX_BODY) {
            return new Response(JSON.stringify({ error: "Request too large." }), {
              status: 413,
              headers: { "Content-Type": "application/json" },
            });
          }
          const { messages } = JSON.parse(raw) as {
            messages: { role: string; content: string }[];
          };
          const apiKey = process.env.LOVABLE_API_KEY;
          if (!apiKey) {
            return new Response(JSON.stringify({ title: "New chat" }), {
              headers: { "Content-Type": "application/json" },
            });
          }

          const excerpt = messages
            .slice(0, 4)
            .map((m) => `${m.role}: ${m.content}`)
            .join("\n")
            .slice(0, 2000);

          const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash-lite",
              messages: [
                {
                  role: "system",
                  content:
                    "Summarize the user's conversation into a SHORT title (max 5 words, no quotes, no punctuation at the end). Return ONLY the title text.",
                },
                { role: "user", content: excerpt },
              ],
            }),
          });

          if (!upstream.ok) {
            return new Response(JSON.stringify({ title: "New chat" }), {
              headers: { "Content-Type": "application/json" },
            });
          }
          const data = await upstream.json();
          let title = (data.choices?.[0]?.message?.content ?? "New chat").trim();
          title = title.replace(/^["']|["']$/g, "").slice(0, 50);
          return new Response(JSON.stringify({ title }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch {
          return new Response(JSON.stringify({ title: "New chat" }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
