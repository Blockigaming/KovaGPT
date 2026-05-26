import { createFileRoute } from "@tanstack/react-router";
import { getMode, type ModeId } from "@/lib/modes";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: { kind: "image"; dataUrl: string }[];
};

const IMAGE_INTENT =
  /\b(generate|make|create|draw|design|render|paint|produce|give\s+me)\b[^.?!]{0,40}\b(image|picture|photo|photograph|illustration|logo|drawing|artwork|painting|render|wallpaper|icon)\b/i;

function sseChunk(text: string) {
  const payload = {
    choices: [{ index: 0, delta: { role: "assistant", content: text } }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone() {
  return `data: [DONE]\n\n`;
}

async function handleImageRequest(prompt: string, apiKey: string): Promise<Response> {
  const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3.1-flash-image-preview",
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  if (!upstream.ok) {
    const status = upstream.status;
    const err =
      status === 429
        ? "Rate limit exceeded. Please wait a moment."
        : status === 402
          ? "AI credits exhausted."
          : (await upstream.text()) || "Image generation failed";
    return new Response(JSON.stringify({ error: err }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const data = await upstream.json();
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

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      if (imageUrl) {
        controller.enqueue(enc.encode(sseChunk(`Here's your image:\n\n![generated image](${imageUrl})`)));
      } else {
        controller.enqueue(enc.encode(sseChunk("Sorry — I couldn't generate that image. Try rephrasing the prompt.")));
      }
      controller.enqueue(enc.encode(sseDone()));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

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

          // Detect image-generation intent on the latest user message
          const lastUser = [...messages].reverse().find((m) => m.role === "user");
          const lastText = lastUser?.content?.trim() ?? "";
          const isImageRequest =
            lastText.length > 0 &&
            (!lastUser?.attachments || lastUser.attachments.length === 0) &&
            IMAGE_INTENT.test(lastText);

          if (isImageRequest) {
            return handleImageRequest(lastText, apiKey);
          }

          const m = getMode(mode ?? "auto");
          const hasImages = messages.some((msg) => (msg.attachments?.length ?? 0) > 0);

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

          const model =
            m.id === "reason"
              ? "google/gemini-2.5-pro"
              : hasImages
                ? "google/gemini-2.5-flash"
                : "google/gemini-3.1-flash-lite-preview";

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
              return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
                status: 402,
                headers: { "Content-Type": "application/json" },
              });
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
