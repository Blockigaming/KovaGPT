import { createFileRoute } from "@tanstack/react-router";
import { getMode, type ModeId } from "@/lib/modes";

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: { kind: "image"; dataUrl: string }[];
};

type UserContext = {
  name?: string;
  pronouns?: string;
  email?: string;
  phone?: string;
  address?: string;
  extraFacts?: string;
  customInstructions?: string;
  mood?: string;
  responseLength?: "short" | "medium" | "long";
  language?: string;
  rememberAcross?: boolean;
  webSearch?: boolean;
};

function buildUserContextBlock(u?: UserContext): string {
  if (!u) return "";
  const lines: string[] = [];
  if (u.name) lines.push(`The user prefers to be called "${u.name}".`);
  if (u.pronouns) lines.push(`Use these pronouns when referring to the user: ${u.pronouns}.`);
  if (u.email) lines.push(`User email (for context only): ${u.email}.`);
  if (u.phone) lines.push(`User phone (for formatting/context only): ${u.phone}.`);
  if (u.address) lines.push(`User location/address (for context only): ${u.address}.`);
  if (u.extraFacts) lines.push(`Facts the user shared about themselves: ${u.extraFacts}`);
  if (u.mood && u.mood !== "neutral") {
    lines.push(`Respond in a ${u.mood} tone.`);
  }
  if (u.responseLength === "short") {
    lines.push("Keep responses short and to the point. Prefer concise answers.");
  } else if (u.responseLength === "long") {
    lines.push("Provide thorough, detailed responses with examples where helpful.");
  }
  if (u.language && u.language !== "auto") {
    lines.push(`Always reply in language code "${u.language}" unless the user clearly writes in another language.`);
  }
  if (u.customInstructions) {
    lines.push(`User's custom response instructions (follow these): ${u.customInstructions}`);
  }
  if (u.rememberAcross === false) {
    lines.push(`Do NOT reference prior conversations. Treat each chat as fresh.`);
  }
  if (lines.length === 0) return "";
  return `\n\n--- User profile & preferences ---\n${lines.join("\n")}\n--- End user profile ---`;
}

const CURRENT_DATE_INSTRUCTION = `\n\nIMPORTANT: Today's date is ${new Date().toISOString().slice(0, 10)}. When asked about recent events, news, prices, or anything that may have changed, clearly state what your training cutoff is unless live web search results are provided in this conversation. Never invent recent facts.`;

const SEARCH_TRIGGER =
  /\b(today|tonight|yesterday|tomorrow|this week|this month|this year|latest|recent|news|currently|right now|2024|2025|2026|price|stock|score|weather|who won|who is winning|update|breaking)\b/i;

async function runWebSearch(query: string): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit: 5 }),
    });
    if (!r.ok) return null;
    const data: any = await r.json();
    const results: any[] =
      data?.data?.web ?? data?.data ?? data?.web ?? data?.results ?? [];
    if (!Array.isArray(results) || results.length === 0) return null;
    const lines = results.slice(0, 5).map((res, i) => {
      const title = res.title || res.metadata?.title || "Untitled";
      const url = res.url || res.metadata?.sourceURL || "";
      const desc = res.description || res.snippet || res.markdown?.slice(0, 220) || "";
      return `[${i + 1}] ${title}\n${url}\n${desc}`.trim();
    });
    return `\n\n--- Live web search results for "${query}" (today: ${new Date().toISOString().slice(0, 10)}) ---\n${lines.join("\n\n")}\n--- End web search ---\nUse these results to answer. Cite source numbers like [1], [2] when relevant.`;
  } catch {
    return null;
  }
}


const IMAGE_INTENT =
  /\b(generate|make|create|draw|design|render|paint|produce|give\s+me)\b[^.?!]{0,40}\b(image|picture|photo|photograph|illustration|logo|drawing|artwork|painting|render|wallpaper|icon)\b/i;

function sseChunk(text: string) {
  const payload = {
    choices: [{ index: 0, delta: { role: "assistant", content: text } }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseEvent(obj: Record<string, unknown>) {
  const payload = {
    choices: [{ index: 0, delta: { role: "assistant", ...obj } }],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function sseDone() {
  return `data: [DONE]\n\n`;
}

async function handleImageRequest(prompt: string, apiKey: string): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // Tell client immediately: we're generating an image, not text
      controller.enqueue(enc.encode(sseEvent({ kind: "image_pending" })));

      try {
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
          controller.enqueue(enc.encode(sseChunk(`Sorry — ${err}`)));
          controller.enqueue(enc.encode(sseDone()));
          controller.close();
          return;
        }

        const data = await upstream.json();
        const msg = data.choices?.[0]?.message;
        let imageUrl: string | null = null;
        if (msg?.images && Array.isArray(msg.images) && msg.images.length > 0) {
          imageUrl = msg.images[0]?.image_url?.url ?? msg.images[0]?.url ?? null;
        }
        if (!imageUrl && Array.isArray(msg?.content)) {
          for (const p of msg.content) {
            if (p.type === "image_url" && p.image_url?.url) {
              imageUrl = p.image_url.url;
              break;
            }
            if (p.type === "output_image" && p.image_url) {
              imageUrl = typeof p.image_url === "string" ? p.image_url : p.image_url.url;
              break;
            }
          }
        }
        if (!imageUrl && typeof msg?.content === "string") {
          const m = msg.content.match(/!\[[^\]]*\]\(([^)]+)\)/);
          if (m) imageUrl = m[1];
        }

        if (imageUrl) {
          controller.enqueue(enc.encode(sseChunk(`![generated image](${imageUrl})`)));
        } else {
          controller.enqueue(
            enc.encode(sseChunk("Sorry — I couldn't generate that image. Try rephrasing the prompt.")),
          );
        }
      } catch (e) {
        controller.enqueue(
          enc.encode(sseChunk(`Sorry — ${e instanceof Error ? e.message : "image generation failed"}.`)),
        );
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
          const { messages, mode, user } = (await request.json()) as {
            messages: IncomingMessage[];
            mode?: ModeId;
            user?: UserContext;
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
            messages: [
              { role: "system", content: m.systemPrompt + buildUserContextBlock(user) + CURRENT_DATE_INSTRUCTION },
              ...transformed,
            ],
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
