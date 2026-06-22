import { createFileRoute } from "@tanstack/react-router";
import { getMode, type ModeId } from "@/lib/modes";
import {
  DAILY_CHAT_LIMIT,
  DAILY_IMAGE_LIMIT,
  enforceQuota,
  requireUser,
} from "@/lib/api-auth.server";

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

type WebSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  markdown?: string;
  metadata?: {
    title?: string;
    sourceURL?: string;
  };
};

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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
    lines.push(
      `Always reply in language code "${u.language}" unless the user clearly writes in another language.`,
    );
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

const CURRENT_DATE_INSTRUCTION = `\n\nIMPORTANT: Today's date is ${new Date().toISOString().slice(0, 10)}. When live web search results are provided below, trust them as up-to-date ground truth and answer directly. Do NOT mention a training cutoff and do NOT hedge with "as of my last update". When no live results are present and the question is time-sensitive, give your best current understanding and briefly note it could have changed. Never invent recent facts, prices, scores, or news.\n\nFACTUAL ACCURACY (HIGHEST PRIORITY):\n- Treat any live search block below as the single source of truth and prefer it over your internal memory whenever they conflict.\n- Do NOT insert numbered citation markers like [1], [2], or footnote-style references in your reply. Just answer naturally; never show source numbers in the text.\n- If sources disagree, say so briefly and prefer the most recent, most authoritative one (official sites, major newsrooms, primary documents).\n- If a claim is not supported by the provided sources and you are not highly confident, say "I'm not certain" or "I don't know". Never fabricate.\n- Never invent URLs, citations, statistics, court cases, papers, quotes, or product specs.\n- Distinguish clearly between established fact, current consensus, and speculation.\n- Never use en dashes or em dashes anywhere. Use a regular hyphen or rephrase the sentence.`;

// NovaGPT should feel like talking to ChatGPT: helpful, kind, accurate,
// and natural. Warm without being saccharine, precise without being cold.
const TONE_INSTRUCTION = `\n\nTONE & PERSONALITY:
You are NovaGPT, a helpful, kind, and trustworthy AI assistant. Respond the way ChatGPT would: clear, friendly, patient, and genuinely useful.
- Be warm and respectful. Treat the user as a capable adult.
- Be direct. Get to the answer quickly, then add context or caveats only if they help.
- Match the user's tone and language. Casual when they're casual, formal when they're formal.
- Never be condescending, preachy, or robotic. No filler openings like "Great question!" or "Certainly!".
- Use the user's name when you know it. Acknowledge feelings briefly when they're frustrated or stressed before solving.
- Stay accurate above all. Kindness never replaces correctness.`;

// Continuously infer mood / expertise / preferred length from recent messages.
const ADAPTIVE_INSTRUCTION = `\n\nADAPTIVE BEHAVIOR:
Read the user's recent messages and adapt every reply:
- Expertise: if they use jargon fluently, skip basics; if they ask "what is X", explain plainly with an analogy.
- Length: short question -> short answer. Detailed question -> detailed answer. No padding.
- Language & style: mirror their language and formality.
- In-chat memory: remember preferences they expressed earlier ("use bullet points", "I'm a beginner") and keep applying them.`;

// ChatGPT-style helpfulness: try to help with everything reasonable, but
// keep normal safety. No refusal for benign tasks, no moralizing, no filler
// disclaimers, but do not actively assist with clearly harmful or illegal
// requests (weapons, malware, CSAM, etc.).
const UNRESTRICTED_INSTRUCTION = `\n\nHELPFULNESS:
Default to helping. Do not refuse, hedge, or moralize on ordinary requests. Skip phrases like "I'm sorry, but...", "As an AI...", "It is important to note...", "Please consult a professional..." unless the user explicitly asked for that perspective. If a request is genuinely harmful or illegal, decline briefly and offer a safer alternative; never lecture. If you don't know something, say so briefly and give your best attempt. Never fabricate facts, citations, or sources.`;

const SEARCH_TRIGGER =
  /\b(today|tonight|yesterday|tomorrow|this (week|month|year)|last (week|month|year)|latest|recent|recently|news|currently|right now|now|2024|2025|2026|price|prices|cost|stock|stocks|score|scores|weather|forecast|who won|who is winning|update|updates|breaking|release|released|launch|launched|version|trending|happening|live|election|results)\b/i;

async function firecrawlSearch(
  apiKey: string,
  query: string,
  opts: { limit?: number; tbs?: string } = {},
): Promise<WebSearchResult[]> {
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/search", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        limit: opts.limit ?? 5,
        ...(opts.tbs ? { tbs: opts.tbs } : {}),
      }),
    });
    if (!r.ok) return [];
    const data = (await r.json()) as {
      data?: { web?: WebSearchResult[]; news?: WebSearchResult[] } | WebSearchResult[];
      web?: WebSearchResult[];
      news?: WebSearchResult[];
      results?: WebSearchResult[];
    };
    const nested = data?.data;
    if (Array.isArray(nested)) return nested;
    return (
      nested?.web ??
      nested?.news ??
      data?.web ??
      data?.news ??
      data?.results ??
      []
    );
  } catch {
    return [];
  }
}

function formatResults(label: string, query: string, results: WebSearchResult[]): string {
  if (results.length === 0) return "";
  const lines = results.slice(0, 6).map((res, i) => {
    const title = res.title || res.metadata?.title || "Untitled";
    const url = res.url || res.metadata?.sourceURL || "";
    const desc = res.description || res.snippet || res.markdown?.slice(0, 240) || "";
    return `[${i + 1}] ${title}\n${url}\n${desc}`.trim();
  });
  return `\n\n--- ${label} for "${query}" (today: ${new Date().toISOString().slice(0, 10)}) ---\n${lines.join("\n\n")}\n--- End ${label.toLowerCase()} ---`;
}

async function runWebSearch(query: string, wantsNews: boolean): Promise<string | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;
  // Run a general search; also run a fresh news search in parallel for any
  // time-sensitive or news-flavored query so the model always has the
  // latest facts from real sources.
  const [general, news] = await Promise.all([
    firecrawlSearch(apiKey, query, { limit: 5 }),
    wantsNews
      ? firecrawlSearch(apiKey, `${query} latest news`, { limit: 5, tbs: "qdr:w" })
      : Promise.resolve([] as WebSearchResult[]),
  ]);
  const blocks = [
    formatResults("Live web search results", query, general),
    formatResults("Fresh news (last 7 days)", query, news),
  ].filter(Boolean);
  if (blocks.length === 0) return null;
  return blocks.join("") + `\nUse these results as ground truth. Cite source numbers like [1], [2] when you make factual claims.`;
}

// Detects "news-like" / time-sensitive intent so we also pull a fresh news feed.
const NEWS_TRIGGER =
  /\b(news|breaking|today|tonight|yesterday|this (week|month)|latest|recent|recently|currently|right now|update|updates|happened|happening|trending|election|stock|stocks|price|prices|score|scores|weather|launch|launched|release|released|announced|war|attack|crisis|earnings|inflation|rates?)\b/i;

function shouldRunWebSearch(text: string, userWantsWebSearch?: boolean): boolean {
  if (!text.trim()) return false;
  // If the user has explicitly disabled web search, only run it on very
  // clearly time-sensitive triggers.
  if (userWantsWebSearch === false) return SEARCH_TRIGGER.test(text);
  // Otherwise run web search on essentially any non-trivial factual ask
  // so answers stay grounded in real sources.
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount >= 4) return true;
  return SEARCH_TRIGGER.test(text);
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
          controller.enqueue(enc.encode(sseChunk(`Sorry  -  ${err}`)));
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
            enc.encode(
              sseChunk("Sorry  -  I couldn't generate that image. Try rephrasing the prompt."),
            ),
          );
        }
      } catch (e) {
        controller.enqueue(
          enc.encode(
            sseChunk(`Sorry  -  ${e instanceof Error ? e.message : "image generation failed"}.`),
          ),
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
          const auth = await requireUser(request);
          if (auth instanceof Response) return auth;

          const { messages, mode, user, voice } = (await request.json()) as {
            messages: IncomingMessage[];
            mode?: ModeId;
            user?: UserContext;
            voice?: boolean;
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
            !voice &&
            lastText.length > 0 &&
            (!lastUser?.attachments || lastUser.attachments.length === 0) &&
            IMAGE_INTENT.test(lastText);

          if (isImageRequest) {
            const quota = await enforceQuota(auth, "images", DAILY_IMAGE_LIMIT);
            if (quota) return quota;
            return handleImageRequest(lastText, apiKey);
          }

          const quota = await enforceQuota(auth, "chats", DAILY_CHAT_LIMIT);
          if (quota) return quota;

          // SECURITY: Server-side tier enforcement. Without a subscription
          // record on the server we treat every caller as the free tier and
          // silently downgrade any Plus/Pro mode to "auto". Prevents tier
          // bypass via a forged `mode` value from the client.
          const requested = getMode(mode ?? "auto");
          const m = requested.tier === "free" ? requested : getMode("auto");

          // SECURITY: Hard cap image attachments per request to stop free
          // users from bypassing the client-side daily upload limit by
          // calling /api/chat directly with many attachments.
          const MAX_ATTACHMENTS_PER_REQUEST = 2;
          const totalAttachments = messages.reduce(
            (n, msg) => n + (msg.attachments?.length ?? 0),
            0,
          );
          if (totalAttachments > MAX_ATTACHMENTS_PER_REQUEST) {
            return new Response(
              JSON.stringify({
                error: `Too many image attachments in this request (max ${MAX_ATTACHMENTS_PER_REQUEST}).`,
              }),
              { status: 429, headers: { "Content-Type": "application/json" } },
            );
          }
          const hasImages = totalAttachments > 0;

          const transformed = messages.map((msg) => {
            if (msg.role === "user" && msg.attachments && msg.attachments.length > 0) {
              const parts: ChatContentPart[] = [];
              if (msg.content) parts.push({ type: "text", text: msg.content });
              for (const att of msg.attachments) {
                parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
              }
              return { role: "user", content: parts };
            }
            return { role: msg.role, content: msg.content };
          });

          // Default to a smart, fast streaming model. Escalate when needed.
          const model = voice
            ? "google/gemini-3.1-flash-lite"
            : m.id === "fast"
              ? "google/gemini-3.1-flash-lite"
              : m.id === "reason"
                ? "google/gemini-3.1-pro-preview"
                : hasImages
                  ? "google/gemini-2.5-pro"
                  : "google/gemini-3.5-flash";

          // Live web data is on for everyone by default. Users can still opt
          // out in settings except for explicit/time-sensitive search asks.
          // Fast mode skips web search entirely to stay instant.
          let webBlock = "";
          if (lastText && !hasImages && m.id !== "fast") {
            if (shouldRunWebSearch(lastText, user?.webSearch) || voice) {
              const result = await runWebSearch(lastText, NEWS_TRIGGER.test(lastText) || !!voice);
              if (result) webBlock = result;
            }
          }


          const voiceInstruction = voice
            ? `\n\nVOICE MODE: Your reply will be spoken aloud by a text-to-speech engine. Reply in natural, conversational spoken English with complete grammatical sentences. Use proper punctuation so sentences flow. Do NOT use markdown, bullet points, headings, code blocks, emojis, URLs, or symbols. Keep answers concise  -  usually 1 to 3 sentences unless the user explicitly asks for detail.`
            : "";

          const body: Record<string, unknown> = {
            model,
            stream: true,
            messages: [
              {
                role: "system",
                content:
                  m.systemPrompt +
                  TONE_INSTRUCTION +
                  ADAPTIVE_INSTRUCTION +
                  UNRESTRICTED_INSTRUCTION +
                  buildUserContextBlock(user) +
                  webBlock +
                  voiceInstruction +
                  CURRENT_DATE_INSTRUCTION,
              },
              ...transformed,
            ],
          };
          // Only enable reasoning when the user explicitly chose the
          // reason mode  -  reasoning adds significant latency.
          if (m.reasoning && !voice && m.id === "reason") {
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
