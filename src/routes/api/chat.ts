import { createFileRoute } from "@tanstack/react-router";
import { newRequestId, buildErrorEnvelope, categorizeError } from "@/lib/request-id";
import {
  getMode,
  type ModeId,
  STORAGE_LIMITS_BYTES,
  DAILY_IMAGE_LIMIT_BY_TIER,
  DAILY_CHAT_LIMIT_BY_TIER,
  DAILY_UPLOAD_LIMIT_BY_TIER,
} from "@/lib/modes";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  enforceStorage,
  getCallerTier,
  optionalUser,
  unauthorized,
} from "@/lib/api-auth.server";
import {
  ALL_TOOLS,
  TOOL_ACTIVITY,
  WRITE_TOOL_NAMES,
  runGoogleTool,
  stagePendingAction,
  userHasGoogle,
} from "@/lib/google-tools.server";
import {
  chatCompletions,
  chatModel,
  imageGenerations,
  imageModel,
  missingAiProviderResponse,
} from "@/lib/ai/provider.server";
import { NEWS_TRIGGER, runWebSearch, shouldRunWebSearch } from "@/lib/ai/search.server";
import { runDeepResearch, type ResearchProgressEvent } from "@/lib/ai/deep-research.server";
import { activityToSseDelta, createToolActivityEvent } from "@/lib/ai/activity.server";
import { selectModelForMode, mapProviderError } from "@/lib/ai/registry.server";
import { formatMemoryBlock, selectRelevantMemories, type KovaMemory } from "@/lib/ai/memory.server";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChainableQueryLike = {
  select: (columns: string) => ChainableQueryLike;
  eq: (column: string, value: unknown) => ChainableQueryLike;
  order: (column: string, options?: unknown) => ChainableQueryLike;
  limit: (count: number) => Promise<{ data: unknown[] | null; error?: unknown }>;
  maybeSingle: () => Promise<{ data: unknown; error?: unknown }>;
};

type SupabaseAdminLike = {
  from: (table: string) => ChainableQueryLike;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const OWNER_EMAIL = "support@kovagpt.com";
const TONE_INSTRUCTION = "";
const ADAPTIVE_INSTRUCTION = "";
const UNRESTRICTED_INSTRUCTION = "";
const ACCURACY_INSTRUCTION = "";
const CHART_INSTRUCTION = "";
const CREATOR_INSTRUCTION = "";
function sanitizeLong(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function buildUserContextBlock(user: UserContext): string {
  const entries = Object.entries(user).filter(([, value]) => value != null && value !== "");
  if (!entries.length) return "";
  return `\n\n--- User context ---\n${entries.map(([key, value]) => `${key}: ${String(value)}`).join("\n")}\n--- End user context ---`;
}
function buildCurrentDateInstruction(timezone?: string, locale?: string): string {
  return `\nCurrent date: ${new Date().toISOString().slice(0, 10)}${timezone ? `; timezone: ${timezone}` : ""}${locale ? `; locale: ${locale}` : ""}.`;
}

type IncomingMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: Array<
    | { kind: "image"; dataUrl: string }
    | {
        kind: "library_file";
        libraryItemId: string;
        name: string;
        fileType?: string | null;
        size?: number | null;
        sourceProject?: string | null;
      }
  >;
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

const IMAGE_INTENT =
  /\b(generate|make|create|draw|design|render|paint|produce|give\s+me)\b[^.?!]{0,40}\b(image|picture|photo|photograph|illustration|logo|drawing|artwork|painting|render|wallpaper|icon)\b/i;

// Negation guard: user explicitly saying they DON'T want an image/action.
// Prevents "don't generate an image", "no image please", "stop making pictures"
// from triggering the image workflow.
const NEGATION_GUARD =
  /\b(do\s*n[o']?t|don't|dont|never|no|stop|please\s+don't|please\s+do\s+not|without|skip|avoid|instead\s+of)\b[^.?!]{0,60}\b(generate|make|create|draw|design|render|paint|produce|image|picture|photo|illustration|logo|drawing)\b/i;

function detectImageIntent(text: string): boolean {
  if (!IMAGE_INTENT.test(text)) return false;
  if (NEGATION_GUARD.test(text)) return false;
  return true;
}

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

async function handleDeepResearchRequest(
  prompt: string,
  options: {
    signal?: AbortSignal;
    persistence?: NonNullable<Parameters<typeof runDeepResearch>[1]>["persistence"];
  } = {},
): Promise<Response> {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emitProgress = (event: ResearchProgressEvent) => {
        if (event.activity) {
          controller.enqueue(enc.encode(sseEvent(activityToSseDelta(event.activity))));
        }
        controller.enqueue(
          enc.encode(
            sseEvent({
              kind: "research_progress",
              stage: event.stage.id,
              label: event.stage.label,
              status: event.stage.status,
              detail: event.stage.detail,
              progress: event.progress,
            }),
          ),
        );
      };
      try {
        const result = await runDeepResearch(prompt, {
          signal: options.signal,
          persistence: options.persistence,
          onProgress: emitProgress,
        });
        if (result.partialFailures.length) {
          controller.enqueue(
            enc.encode(
              sseEvent({
                kind: "research_warning",
                label: "Some sources failed",
                detail: result.partialFailures.slice(0, 3).join("; "),
              }),
            ),
          );
        }
        controller.enqueue(enc.encode(sseChunk(result.report)));
      } catch (error) {
        if (options.signal?.aborted) {
          controller.enqueue(enc.encode(sseChunk("_Deep Research was cancelled._")));
        } else {
          console.error("[deep-research] failed", error);
          controller.enqueue(
            enc.encode(
              sseChunk(
                "_Deep Research could not complete because search or the AI provider failed. Please retry._",
              ),
            ),
          );
        }
      }
      controller.enqueue(enc.encode(sseDone()));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

async function handleImageRequest(prompt: string): Promise<Response> {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      // Tell client immediately: we're generating an image, not text
      controller.enqueue(enc.encode(sseEvent({ kind: "image_pending" })));

      try {
        const upstream = await imageGenerations({
          model: imageModel(),
          prompt,
          size: "1024x1024",
          quality: "low",
          n: 1,
        });

        if (!upstream.ok) {
          const status = upstream.status;
          const rawErr = await upstream.text().catch(() => "");
          console.error("[handleImageRequest] upstream error", status, rawErr);
          const err =
            status === 429
              ? "Rate limit exceeded. Please wait a moment."
              : status === 402
                ? "Image provider quota exhausted."
                : "Image generation failed. Please try a different prompt or try again later.";
          controller.enqueue(enc.encode(sseChunk(`Sorry - ${err}`)));
          controller.enqueue(enc.encode(sseDone()));
          controller.close();
          return;
        }
        // INTENTIONAL-DEFERRED(storage-cleanup): If uploaded files move to storage,
        // bucket (currently attachments live inline in message records), the file
        // delete flow must also remove the stored object via supabaseAdmin.storage
        // .from(<bucket>).remove([path]) with a server-side ownership check.

        const data = await upstream.json();
        const item = (data as { data?: Array<{ b64_json?: string; url?: string }> }).data?.[0];
        const imageUrl = item?.b64_json
          ? `data:image/png;base64,${item.b64_json}`
          : (item?.url ?? null);

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
        console.error("[handleImageRequest] fetch error", e);
        controller.enqueue(
          enc.encode(sseChunk("Sorry  -  image generation failed. Please try again.")),
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

// In-memory per-IP rate limiter for anonymous /api/chat callers to prevent
// scripted denial-of-wallet abuse against the paid LLM/search gateways.
// Signed-in callers are gated by daily quota (enforceQuota) further below.
const ANON_RATE_MAX = 60;
const ANON_RATE_WINDOW_MS = 60 * 60 * 1000; // 60 requests / hour / IP
const anonRateBuckets = new Map<string, { count: number; resetAt: number }>();
function anonRateLimited(ip: string): boolean {
  const now = Date.now();
  const b = anonRateBuckets.get(ip);
  if (!b || b.resetAt < now) {
    anonRateBuckets.set(ip, { count: 1, resetAt: now + ANON_RATE_WINDOW_MS });
    return false;
  }
  if (b.count >= ANON_RATE_MAX) return true;
  b.count += 1;
  return false;
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = newRequestId();
        const startedAt = Date.now();
        const withRequestId = (res: Response): Response => {
          try {
            const h = new Headers(res.headers);
            if (!h.has("X-Request-Id")) h.set("X-Request-Id", requestId);
            const ct = h.get("Content-Type") ?? "";
            // Enrich JSON error bodies with requestId + category envelope.
            if (res.status >= 400 && ct.includes("application/json") && res.body) {
              return new Response(
                new ReadableStream({
                  async start(controller) {
                    const text = await res.clone().text();
                    let parsed: Record<string, unknown> = {};
                    try {
                      parsed = JSON.parse(text);
                    } catch {
                      parsed = { error: text || "Request failed" };
                    }
                    if (!parsed.requestId) parsed.requestId = requestId;
                    if (!parsed.category)
                      parsed.category = categorizeError(parsed.error, res.status);
                    if (!parsed.timestamp) parsed.timestamp = new Date().toISOString();
                    controller.enqueue(new TextEncoder().encode(JSON.stringify(parsed)));
                    controller.close();
                  },
                }),
                { status: res.status, headers: h },
              );
            }
            return new Response(res.body, {
              status: res.status,
              statusText: res.statusText,
              headers: h,
            });
          } catch {
            return res;
          }
        };
        const run = async (): Promise<Response> => {
          try {
            const auth = await optionalUser(request);
            if (auth instanceof Response) return auth;

            if (!auth) {
              const ip =
                request.headers.get("cf-connecting-ip") ??
                request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
                "unknown";
              if (anonRateLimited(ip)) {
                return new Response(
                  JSON.stringify({ error: "Too many requests. Sign in to continue." }),
                  { status: 429, headers: { "Content-Type": "application/json" } },
                );
              }
            }

            // Reject oversized request bodies before parsing JSON to avoid
            // memory/cost amplification attacks against the AI gateway.
            const MAX_BODY_BYTES = 8 * 1024 * 1024; // 8 MB total request body
            const contentLength = Number(request.headers.get("content-length") ?? "0");
            if (contentLength && contentLength > MAX_BODY_BYTES) {
              return new Response(JSON.stringify({ error: "Request too large." }), {
                status: 413,
                headers: { "Content-Type": "application/json" },
              });
            }
            const rawBody = await request.text();
            if (rawBody.length > MAX_BODY_BYTES) {
              return new Response(JSON.stringify({ error: "Request too large." }), {
                status: 413,
                headers: { "Content-Type": "application/json" },
              });
            }
            const {
              messages,
              mode,
              user,
              timezone,
              locale,
              chatId,
              personality,
              kovaVersion,
              projectId,
              temporary,
              clientTool,
            } = JSON.parse(rawBody) as {
              messages: IncomingMessage[];
              mode?: ModeId;
              user?: UserContext;
              timezone?: string;
              locale?: string;
              chatId?: string;
              personality?: string;
              kovaVersion?: string;
              projectId?: string;
              temporary?: boolean;
              clientTool?:
                | "web_search"
                | "deep_research"
                | "image"
                | "study"
                | "data_analysis"
                | "file_analysis"
                | null;
            };
            const KOVA_VERSION = typeof kovaVersion === "string" ? kovaVersion : "3.5";
            const IS_LEGACY_KOVA = KOVA_VERSION !== "3.5";
            const personalityBlock = (() => {
              const p = sanitizeLong(personality, 500);
              return p
                ? `\n\n--- User personality preferences ---\n${p}\n--- End personality ---`
                : "";
            })();

            // Hard caps on message volume and per-message size. Anonymous
            // callers and signed-in callers both run through this; signed-in
            // callers also have a daily quota enforced below.
            const MAX_MESSAGES = 100;
            const MAX_MESSAGE_CHARS = 32 * 1024; // 32 KB per text message
            const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB per image data URL
            if (!Array.isArray(messages) || messages.length === 0) {
              return new Response(
                JSON.stringify({ error: "messages must be a non-empty array." }),
                { status: 400, headers: { "Content-Type": "application/json" } },
              );
            }
            if (messages.length > MAX_MESSAGES) {
              return new Response(
                JSON.stringify({ error: `Too many messages (max ${MAX_MESSAGES}).` }),
                { status: 413, headers: { "Content-Type": "application/json" } },
              );
            }
            for (const m of messages) {
              if (typeof m?.content === "string" && m.content.length > MAX_MESSAGE_CHARS) {
                return new Response(
                  JSON.stringify({ error: "A message exceeds the maximum allowed length." }),
                  { status: 413, headers: { "Content-Type": "application/json" } },
                );
              }
              if (m?.attachments) {
                for (const a of m.attachments) {
                  if (a.kind !== "image") continue;
                  if (typeof a?.dataUrl === "string" && a.dataUrl.length > MAX_ATTACHMENT_BYTES) {
                    return new Response(
                      JSON.stringify({ error: "An attachment exceeds the 5 MB limit." }),
                      { status: 413, headers: { "Content-Type": "application/json" } },
                    );
                  }
                }
              }
            }

            const missingProvider = missingAiProviderResponse();
            if (missingProvider) return missingProvider;

            // Detect image-generation intent on the latest user message
            const lastUser = [...messages].reverse().find((m) => m.role === "user");
            const lastText = lastUser?.content?.trim() ?? "";
            const isImageRequest =
              lastText.length > 0 &&
              (!lastUser?.attachments || lastUser.attachments.length === 0) &&
              (clientTool === "image" || detectImageIntent(lastText));

            // Detect the owner account - gets highest tier with no quotas.
            let isOwner = false;
            if (auth) {
              try {
                const { data } = await auth.supabaseAdmin.auth.admin.getUserById(auth.userId);
                const email = data?.user?.email?.toLowerCase();
                if (email === OWNER_EMAIL) isOwner = true;
              } catch {
                // ignore; treat as non-owner
              }
            }

            // Banned-user + maintenance + tier checks for signed-in callers.
            let callerTier: "free" | "plus" | "pro" = "free";
            if (auth) {
              const banned = await assertNotBanned(auth);
              if (banned) return banned;
              if (!isOwner) callerTier = await getCallerTier(auth);
            }

            // Image generation requires an account. For signed-out users,
            // silently fall through to normal chat so the model can respond
            // in text (esp. important when the user *explicitly declined* an
            // image but a keyword still slipped past the negation guard).
            if (isImageRequest && auth) {
              if (!isOwner) {
                if (!auth.emailVerified) {
                  return new Response(
                    JSON.stringify({
                      error:
                        "Please verify your email address before generating images. Check your inbox for the confirmation link.",
                    }),
                    { status: 403, headers: { "Content-Type": "application/json" } },
                  );
                }
                const maint = await assertFeatureEnabled(auth, "images");
                if (maint) return maint;
                const imgLimit = DAILY_IMAGE_LIMIT_BY_TIER[callerTier];
                const quota = await enforceQuota(auth, "images", imgLimit);
                if (quota) return quota;
              }
              return handleImageRequest(lastText);
            }

            // Anonymous chat is allowed; signed-in users get per-user daily quotas + maintenance check.
            if (auth && !isOwner) {
              const maint = await assertFeatureEnabled(auth, "chat");
              if (maint) return maint;
              const quota = await enforceQuota(auth, "chats", DAILY_CHAT_LIMIT_BY_TIER[callerTier]);
              if (quota) return quota;
            }

            // SECURITY: Server-side tier enforcement. Client-supplied `mode` is
            // only honored if the user's resolved tier permits it; anything
            // above their tier is silently downgraded to "auto". Owner bypasses.
            const TIER_RANK: Record<"free" | "plus" | "pro", number> = { free: 0, plus: 1, pro: 2 };
            const requested = getMode(mode ?? "auto");
            const allowed = isOwner || TIER_RANK[requested.tier] <= TIER_RANK[callerTier];
            const m = allowed ? requested : getMode("auto");
            const MAX_ATTACHMENTS_PER_REQUEST = 2;
            const totalAttachments = messages.reduce(
              (n, msg) => n + (msg.attachments?.length ?? 0),
              0,
            );
            // File / photo uploads require an account.
            if (totalAttachments > 0 && !auth) {
              return unauthorized("Sign in to upload files or photos.");
            }
            if (!isOwner && totalAttachments > MAX_ATTACHMENTS_PER_REQUEST) {
              return new Response(
                JSON.stringify({
                  error: `Too many image attachments in this request (max ${MAX_ATTACHMENTS_PER_REQUEST}).`,
                }),
                { status: 429, headers: { "Content-Type": "application/json" } },
              );
            }
            // Server-side daily upload quota + maintenance flag. The
            // localStorage counter is only a UX hint; this is real enforcement.
            if (auth && !isOwner && totalAttachments > 0) {
              if (!auth.emailVerified) {
                return new Response(
                  JSON.stringify({
                    error:
                      "Please verify your email address before uploading files or photos. Check your inbox for the confirmation link.",
                  }),
                  { status: 403, headers: { "Content-Type": "application/json" } },
                );
              }
              const maint = await assertFeatureEnabled(auth, "uploads");
              if (maint) return maint;
              const quota = await enforceQuota(
                auth,
                "uploads",
                DAILY_UPLOAD_LIMIT_BY_TIER[callerTier],
                totalAttachments,
              );
              if (quota) return quota;
              // Enforce cumulative storage cap per tier (5 / 25 / 50 GB).
              let totalBytes = 0;
              for (const msg of messages) {
                for (const att of msg.attachments ?? []) {
                  if (att.kind !== "image") continue;
                  const url = att.dataUrl ?? "";
                  const commaIdx = url.indexOf(",");
                  if (commaIdx > -1) {
                    // base64 length * 3/4 approx. raw byte size
                    totalBytes += Math.floor(((url.length - commaIdx - 1) * 3) / 4);
                  } else {
                    totalBytes += url.length;
                  }
                }
              }
              const tier = await getCallerTier(auth);
              const storage = await enforceStorage(auth, totalBytes, STORAGE_LIMITS_BYTES[tier]);
              if (storage) return storage;
            }
            const hasImages = totalAttachments > 0;

            if (clientTool === "deep_research" && lastText && !hasImages) {
              return handleDeepResearchRequest(lastText, {
                signal: request.signal,
                persistence: auth
                  ? {
                      supabase:
                        auth.supabaseAdmin as unknown as import("@/lib/ai/deep-research.server").ResearchPersistence["supabase"],
                      userId: auth.userId,
                      chatId,
                      projectId:
                        typeof projectId === "string" && /^[0-9a-f-]{36}$/i.test(projectId)
                          ? projectId
                          : undefined,
                      temporary: Boolean(temporary),
                    }
                  : undefined,
              });
            }

            // COST: only send the last ~12 turns to the model. Adaptive memory +
            // cross-chat summaries (below) carry forward standing rules and
            // long-term context, so we don't need to resend the full transcript
            // on every call. The latest user message is always preserved.
            // INTENTIONAL-DEFERRED(summarization): a future durable summary worker can
            // background summary pass and store it in chat_memories instead of
            // sending raw turns.
            const HISTORY_TURNS = 12;
            const trimmedMessages =
              messages.length > HISTORY_TURNS ? messages.slice(-HISTORY_TURNS) : messages;

            const transformed = trimmedMessages.map((msg) => {
              // SECURITY: client-supplied "system" messages would otherwise sit
              // next to the server's authoritative system prompt and could
              // override it. Demote any non-assistant/non-user role to "user".
              const safeRole: "user" | "assistant" =
                msg.role === "assistant" ? "assistant" : "user";
              if (safeRole === "user" && msg.attachments && msg.attachments.length > 0) {
                const parts: ChatContentPart[] = [];
                if (msg.content) parts.push({ type: "text", text: msg.content });
                for (const att of msg.attachments) {
                  if (att.kind === "image") {
                    parts.push({ type: "image_url", image_url: { url: att.dataUrl } });
                  } else if (att.kind === "library_file") {
                    parts.push({
                      type: "text",
                      text: `[Attached Library file: ${att.name} (${att.fileType ?? "unknown type"}). Library item ID ${att.libraryItemId}. Treat this as user-provided context metadata only; do not expose private URLs.]`,
                    });
                  }
                }
                return { role: "user", content: parts };
              }
              return { role: safeRole, content: msg.content };
            });

            // Model routing:
            // - instant: fastest available (Gemini flash-lite) for snappy replies.
            // - medium:  balanced quality/speed (Gemini 3.1 Pro preview).
            // - high:    smartest available (GPT-5.5 Pro extended reasoning).
            const selectedModel = selectModelForMode(m.id, {
              hasImages,
              needsTools: m.id !== "instant",
              needsSearch: false,
            });
            const model = selectedModel.model.modelId;

            // INTENTIONAL-DEFERRED(routing): per-request classification can be added
            // and an explicit "Improve answer" client action that re-runs with a
            // stronger model only on demand.

            // Live web data is on for everyone by default. Users can still opt
            // out in settings except for explicit/time-sensitive search asks.
            // Fast mode skips web search entirely to stay instant.
            let webBlock = "";
            if (
              lastText &&
              !hasImages &&
              (m.id !== "instant" || clientTool === "web_search" || clientTool === "deep_research")
            ) {
              if (
                clientTool === "web_search" ||
                clientTool === "deep_research" ||
                shouldRunWebSearch(lastText, user?.webSearch)
              ) {
                const activity = createToolActivityEvent(
                  "search_web",
                  "Searching the web",
                  "running",
                );
                const result = await runWebSearch(
                  lastText,
                  clientTool === "deep_research" || NEWS_TRIGGER.test(lastText),
                );
                if (result) {
                  webBlock = result;
                  void activity;
                }
              }
            }

            // Cross-chat memory: for Plus+ signed-in users, inject short
            // summaries of their recent past chats so KovaGPT can recall
            // context across conversations. Respects user.rememberAcross.
            let memoryBlock = "";
            if (auth && user?.rememberAcross !== false && !temporary) {
              try {
                const { data: memRows } = await (
                  auth.supabaseAdmin as unknown as {
                    from: (t: string) => ChainableQueryLike;
                  }
                )
                  .from("chat_memories")
                  .select("title, summary, updated_at")
                  .eq("user_id", auth.userId)
                  .order("updated_at", { ascending: false })
                  .limit(8);
                if (Array.isArray(memRows) && memRows.length > 0) {
                  const memories = (memRows as { title?: string | null; summary: string }[]).map(
                    (r, i): KovaMemory => ({
                      id: `chat-memory-${i + 1}`,
                      userId: auth.userId,
                      content: `${r.title ? `${r.title}: ` : ""}${r.summary}`,
                      category: "personal_context",
                    }),
                  );
                  memoryBlock = formatMemoryBlock(
                    selectRelevantMemories(memories, lastText, {
                      enabled: user?.rememberAcross === true,
                      temporary: Boolean(temporary),
                      maxItems: 8,
                    }),
                  );
                }
              } catch (e) {
                console.warn("[chat] memory fetch failed", e);
              }
            }

            // Project workspace context: only for signed-in members of `projectId`.
            // Injects project instructions, project memory, and top-k retrieved
            // knowledge-base chunks matched against the user's last message.
            let projectBlock = "";
            if (auth && typeof projectId === "string" && /^[0-9a-f-]{36}$/i.test(projectId)) {
              try {
                const admin = auth.supabaseAdmin as unknown as SupabaseAdminLike;
                // Verify caller is a member of the project.
                const { data: isMember } = await admin.rpc("is_project_member", {
                  _user_id: auth.userId,
                  _project_id: projectId,
                });
                if (isMember === true) {
                  const projRes = await admin
                    .from("projects")
                    .select("id, name, system_prompt")
                    .eq("id", projectId)
                    .maybeSingle();
                  const proj = projRes?.data as {
                    id: string;
                    name: string;
                    system_prompt: string | null;
                  } | null;
                  if (proj) {
                    const parts: string[] = [];
                    parts.push(
                      `You are working inside the KovaGPT project "${proj.name}". Everything below applies only to this project workspace.`,
                    );
                    if (proj.system_prompt && proj.system_prompt.trim()) {
                      parts.push(
                        `Project instructions (highest priority for this workspace):\n${proj.system_prompt.trim()}`,
                      );
                    }
                    const memRes = await admin
                      .from("project_memory")
                      .select("content")
                      .eq("project_id", projectId)
                      .order("created_at", { ascending: false })
                      .limit(20);
                    const memRows = (memRes?.data as Array<{ content: string }> | null) ?? [];
                    if (memRows.length > 0) {
                      parts.push(
                        "Project memory (facts the user has saved about this project - honor them):\n" +
                          memRows.map((r, i) => `${i + 1}. ${r.content}`).join("\n"),
                      );
                    }
                    // RAG over uploaded documents. Build a plain-text query.
                    const lastUser = [...messages].reverse().find((mm) => mm.role === "user");
                    let q = "";
                    if (lastUser) {
                      const c: unknown = (lastUser as { content: unknown }).content;
                      if (typeof c === "string") q = c;
                      else if (Array.isArray(c)) {
                        q = c
                          .map((p) => {
                            const part = p as { text?: unknown } | null;
                            return typeof part?.text === "string" ? part.text : "";
                          })
                          .join(" ");
                      }
                    }
                    if (q.trim()) {
                      const { retrieveProjectContext } = await import("@/lib/project-rag.server");
                      const chunks = await retrieveProjectContext({
                        supabase: admin,
                        project_id: projectId,
                        query: q,
                        k: 6,
                      });
                      const rel = chunks.filter((c) => c.similarity > 0.15).slice(0, 6);
                      if (rel.length > 0) {
                        parts.push(
                          "Relevant excerpts from this project's uploaded files (use as ground truth when the user's question maps to them; never invent content not present):\n" +
                            rel.map((c, i) => `[Excerpt ${i + 1}]\n${c.content}`).join("\n\n"),
                        );
                      }
                    }
                    projectBlock =
                      "\n\n--- PROJECT CONTEXT ---\n" +
                      parts.join("\n\n") +
                      "\n--- END PROJECT CONTEXT ---";
                  }
                }
              } catch (e) {
                console.warn("[chat] project context failed", (e as Error)?.message);
              }
            }

            const toolInstruction =
              clientTool === "deep_research"
                ? "\n\nDEEP RESEARCH MODE: Create a structured research report. Use live web results above as sources when present, state uncertainty clearly, compare sources, and include a concise sources section with domains and URLs. If live results are unavailable, say exactly that and proceed without fabricated citations."
                : clientTool === "web_search"
                  ? "\n\nWEB SEARCH MODE: Use live web results above when present, cite source titles/domains naturally, and never fabricate links or citations."
                  : clientTool === "study"
                    ? "\n\nSTUDY MODE: Teach step by step, check understanding, and end with a short quiz."
                    : clientTool === "data_analysis" || clientTool === "file_analysis"
                      ? "\n\nANALYSIS MODE: Inspect provided text, images, or tabular data carefully. Summarize findings, caveats, and next steps. Use charts only when useful and supported by data."
                      : "";

            const body: Record<string, unknown> = {
              model,
              stream: true,
              messages: [
                {
                  role: "system",
                  content:
                    `\n\nKOVA_VERSION: The user is currently talking to Kova ${KOVA_VERSION}. If they ask what version/model you are, answer with "Kova ${KOVA_VERSION}".` +
                    m.systemPrompt +
                    TONE_INSTRUCTION +
                    ADAPTIVE_INSTRUCTION +
                    UNRESTRICTED_INSTRUCTION +
                    ACCURACY_INSTRUCTION +
                    CHART_INSTRUCTION +
                    CREATOR_INSTRUCTION +
                    buildUserContextBlock(user ?? {}) +
                    personalityBlock +
                    memoryBlock +
                    projectBlock +
                    webBlock +
                    toolInstruction +
                    (callerTier === "plus" || callerTier === "pro"
                      ? `\n\nELITE AGENT MODE (Plus/Pro): You are operating as an elite agent for this user. When the request involves the live web, act decisively - use the web search block as ground truth, cite specific sources by name (not numbers), extract concrete details (prices, dates, versions, quotes), and complete multi-step research or comparisons in one reply. If information is stale or missing, say so directly and offer the next best step. Never punt with "I can't browse the web" - live results are provided when relevant and you should use them.`
                      : "") +
                    `\n\nPUNCTUATION RULE (STRICT): NEVER output the characters "\u2013" (en dash) or "\u2014" (em dash) under any circumstances. If tempted, use a comma, a period, parentheses, or a regular hyphen "-" instead. This rule overrides style, formatting, and quotation preservation.` +
                    buildCurrentDateInstruction(timezone, locale),
                },
                ...transformed,
              ],
            };
            // Only enable reasoning when the user explicitly chose the
            // reason mode  -  reasoning adds significant latency.
            // Legacy Kova versions (<3.5) never use extended reasoning:
            // they are intentionally "slightly less smart" than 3.5.
            if (m.reasoning && m.id === "high" && !IS_LEGACY_KOVA) {
              body.reasoning = { effort: m.reasoning };
            }
            if (IS_LEGACY_KOVA) {
              // Slightly nerf legacy versions and add an authentic-feeling
              // 3-7s "thinking" delay before we start streaming.
              const sys = body.messages as { role: string; content: string }[];
              const rank: Record<string, number> = {
                "3.4": 1,
                "3.3": 2,
                "3.2": 3,
                "3.1": 4,
                "3.0": 5,
              };
              const gap = rank[KOVA_VERSION] ?? 1;
              sys[0].content += `\n\nYou are running as Kova ${KOVA_VERSION}, a previous-generation model. You are slightly less capable than Kova 3.5 (about ${gap * 6}% less accurate on complex reasoning). Keep answers correct and helpful, but avoid extended chain-of-thought, deep multi-step reasoning, or long structured breakdowns unless explicitly asked. Prefer shorter, more direct responses than Kova 3.5 would give.`;
              const delayMs = 3000 + Math.floor(Math.random() * 4000); // 3-7s
              await new Promise((r) => setTimeout(r, delayMs));
            }

            // === TOOL-CALLING PRE-LOOP ============================================
            // Only for signed-in users who've connected Google, on a real text
            // turn (no attachments, not instant mode). We run up to
            // MAX_TOOL_HOPS non-streaming calls with tools enabled. Each hop
            // that produces tool_calls gets executed server-side and streams a
            // typed `activity` event back to the client so the user sees
            // "Searching Gmail…" while it happens. Once the model returns a
            // stop/content response (no more tool_calls), we do ONE final
            // streaming call and pipe it through to the browser.
            //
            // If any step fails, or the user has no Google connection, we fall
            // through to the original streaming behavior with zero change.
            const enableTools =
              !!auth &&
              !hasImages &&
              m.id !== "instant" &&
              lastText.length > 0 &&
              (await userHasGoogle(auth.userId).catch(() => false));

            type ToolCall = {
              id: string;
              type: "function";
              function: { name: string; arguments: string };
            };
            type AssistantMsg = {
              role: "assistant";
              content: string | null;
              tool_calls?: ToolCall[];
            };
            type ToolResultMsg = { role: "tool"; tool_call_id: string; content: string };
            type ChatMsg =
              | { role: string; content: unknown; [k: string]: unknown }
              | AssistantMsg
              | ToolResultMsg;

            const workingMessages: ChatMsg[] = [...(body.messages as unknown as ChatMsg[])];
            const activityEvents: Array<{ tool: string; label: string; args?: unknown }> = [];

            if (enableTools) {
              const MAX_TOOL_HOPS = 8;
              const MAX_TOOL_CALLS_TOTAL = 16;
              const PER_HOP_TIMEOUT_MS = 25_000;
              let totalToolCalls = 0;
              let toolsWereUsed = false;
              let hopFailed = false;
              const pendingConfirms: Array<{
                id: string;
                tool: string;
                summary: string;
                args_preview: Record<string, unknown>;
              }> = [];
              // Dedup identical tool calls (same name + normalized args) within
              // one request to prevent runaway loops where the model retries
              // the same call. Returns cached result to the model instead.
              const dedupCache = new Map<string, string>();
              const dedupKey = (name: string, args: Record<string, unknown>) => {
                try {
                  return `${name}::${JSON.stringify(args, Object.keys(args).sort())}`;
                } catch {
                  return `${name}::${Math.random()}`;
                }
              };

              for (let hop = 0; hop < MAX_TOOL_HOPS; hop++) {
                // Per-hop abort: user disconnect OR 25s timeout, whichever first.
                const hopCtl = new AbortController();
                const hopTimer = setTimeout(() => hopCtl.abort(), PER_HOP_TIMEOUT_MS);
                const onReqAbort = () => hopCtl.abort();
                request.signal?.addEventListener("abort", onReqAbort, { once: true });
                let hopRes: Response;
                try {
                  hopRes = await chatCompletions(
                    {
                      model,
                      messages: workingMessages,
                      tools: ALL_TOOLS,
                      tool_choice: "auto",
                      stream: false,
                    },
                    { signal: hopCtl.signal },
                  );
                } catch (e) {
                  clearTimeout(hopTimer);
                  request.signal?.removeEventListener("abort", onReqAbort);
                  if (request.signal?.aborted) return new Response(null, { status: 499 });
                  hopFailed = true;
                  console.warn("[chat] tool hop aborted/failed", (e as Error).message);
                  break;
                }
                clearTimeout(hopTimer);
                request.signal?.removeEventListener("abort", onReqAbort);

                if (!hopRes.ok) {
                  hopFailed = true;
                  console.warn("[chat] tool hop http", hopRes.status);
                  break;
                }
                const hopJson = (await hopRes.json()) as {
                  choices?: Array<{
                    finish_reason?: string;
                    message?: AssistantMsg;
                  }>;
                };
                const msg = hopJson.choices?.[0]?.message;
                const finish = hopJson.choices?.[0]?.finish_reason;
                if (!msg) {
                  hopFailed = true;
                  break;
                }
                if (!msg.tool_calls || msg.tool_calls.length === 0) {
                  if (toolsWereUsed && typeof msg.content === "string" && msg.content) {
                    const enc = new TextEncoder();
                    const stream = new ReadableStream({
                      start(controller) {
                        for (const a of activityEvents) {
                          controller.enqueue(
                            enc.encode(
                              sseEvent({
                                kind: "activity",
                                tool: a.tool,
                                label: a.label,
                                status: "done",
                              }),
                            ),
                          );
                        }
                        for (const p of pendingConfirms) {
                          controller.enqueue(
                            enc.encode(
                              sseEvent({
                                kind: "tool_confirm",
                                action_id: p.id,
                                tool: p.tool,
                                summary: p.summary,
                                args_preview: p.args_preview,
                              }),
                            ),
                          );
                        }
                        const text = msg.content as string;
                        const CHUNK = 60;
                        for (let i = 0; i < text.length; i += CHUNK) {
                          controller.enqueue(enc.encode(sseChunk(text.slice(i, i + CHUNK))));
                        }
                        controller.enqueue(enc.encode(sseDone()));
                        controller.close();
                      },
                    });
                    return new Response(stream, {
                      headers: {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                      },
                    });
                  }
                  break;
                }
                // Enforce total tool-call cap before executing this batch.
                if (totalToolCalls + msg.tool_calls.length > MAX_TOOL_CALLS_TOTAL) {
                  console.warn("[chat] max tool calls exceeded, breaking loop");
                  workingMessages.push({
                    role: "assistant",
                    content: msg.content ?? null,
                    tool_calls: msg.tool_calls,
                  });
                  for (const tc of msg.tool_calls) {
                    workingMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: JSON.stringify({
                        error: "tool_budget_exceeded",
                        message:
                          "Maximum tool calls per request reached. Answer with what you have.",
                      }),
                    });
                  }
                  break;
                }
                totalToolCalls += msg.tool_calls.length;
                toolsWereUsed = true;
                workingMessages.push({
                  role: "assistant",
                  content: msg.content ?? null,
                  tool_calls: msg.tool_calls,
                });
                const results = await Promise.all(
                  msg.tool_calls.map(async (tc): Promise<ToolResultMsg> => {
                    let parsedArgs: Record<string, unknown> = {};
                    try {
                      parsedArgs = tc.function.arguments
                        ? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
                        : {};
                    } catch {
                      /* keep empty */
                    }
                    const activityLabel = TOOL_ACTIVITY[tc.function.name]?.done ?? tc.function.name;
                    activityEvents.push({
                      tool: tc.function.name,
                      label: activityLabel,
                      args: parsedArgs,
                    });
                    // Dedup identical (name+args) within this request.
                    const key = dedupKey(tc.function.name, parsedArgs);
                    const cached = dedupCache.get(key);
                    if (cached) {
                      return { role: "tool", tool_call_id: tc.id, content: cached };
                    }
                    if (WRITE_TOOL_NAMES.has(tc.function.name)) {
                      try {
                        const staged = await stagePendingAction(
                          auth.userId,
                          tc.function.name,
                          parsedArgs,
                        );
                        pendingConfirms.push({
                          id: staged.id,
                          tool: staged.tool,
                          summary: staged.summary,
                          args_preview: staged.args_preview,
                        });
                        const content = JSON.stringify({
                          status: "awaiting_user_confirmation",
                          summary: staged.summary,
                          instruction:
                            "The action has been queued and will only run after the user clicks Confirm on the card that will appear below your reply. Write one short natural sentence asking the user to review and confirm. Do NOT claim it has been sent, drafted, created, or deleted yet.",
                        });
                        dedupCache.set(key, content);
                        return { role: "tool", tool_call_id: tc.id, content };
                      } catch (e) {
                        return {
                          role: "tool",
                          tool_call_id: tc.id,
                          content: JSON.stringify({
                            error: "stage_failed",
                            message: (e as Error).message,
                          }),
                        };
                      }
                    }
                    try {
                      const out = await runGoogleTool(auth.userId, tc.function.name, parsedArgs);
                      const content = JSON.stringify(out).slice(0, 24000);
                      dedupCache.set(key, content);
                      return { role: "tool", tool_call_id: tc.id, content };
                    } catch (e) {
                      return {
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify({
                          error: "tool_failed",
                          message: (e as Error).message,
                        }),
                      };
                    }
                  }),
                );
                for (const r of results) workingMessages.push(r);
                if (finish === "stop") break;
                if (request.signal?.aborted) return new Response(null, { status: 499 });
              }
              if (hopFailed) {
                workingMessages.length = 0;
                workingMessages.push(...(body.messages as unknown as ChatMsg[]));
              }
              // Stash pending confirms on the outer scope so the final
              // streaming branch can prepend them too.
              (activityEvents as unknown as { __pending?: typeof pendingConfirms }).__pending =
                pendingConfirms;
            }

            // === FINAL STREAMING CALL =============================================
            const finalBody = { ...body, messages: workingMessages, stream: true };
            const activityCount = activityEvents.length;
            const pendingCount =
              (activityEvents as unknown as { __pending?: unknown[] }).__pending?.length ?? 0;
            const hasStreamedActivity = activityCount > 0 || pendingCount > 0;
            let upstream: Response;
            try {
              upstream = await chatCompletions(finalBody, { signal: request.signal });
            } catch (e) {
              if (request.signal?.aborted) return new Response(null, { status: 499 });
              console.error("[chat] final call network error", e);
              return new Response(
                JSON.stringify({
                  error: "AI service is temporarily unavailable. Please try again.",
                }),
                { status: 502, headers: { "Content-Type": "application/json" } },
              );
            }

            if (!upstream.ok) {
              const errMsg =
                upstream.status === 429
                  ? "Rate limit exceeded. Please wait a moment."
                  : upstream.status === 402
                    ? "Image provider quota exhausted."
                    : "AI service is temporarily unavailable. Please try again.";
              const status = upstream.status === 429 ? 429 : upstream.status === 402 ? 402 : 502;
              const txt = upstream.ok ? "" : await upstream.text().catch(() => "");
              if (!upstream.ok) console.error("[chat] upstream error", upstream.status, txt);
              // If we already committed to SSE (activities/confirms staged),
              // deliver the error inside the stream so the client renders it
              // instead of hanging.
              if (hasStreamedActivity) {
                const enc = new TextEncoder();
                const stream = new ReadableStream({
                  start(controller) {
                    for (const a of activityEvents) {
                      controller.enqueue(
                        enc.encode(
                          sseEvent({
                            kind: "activity",
                            tool: a.tool,
                            label: a.label,
                            status: "done",
                          }),
                        ),
                      );
                    }
                    const pending =
                      (
                        activityEvents as unknown as {
                          __pending?: Array<{
                            id: string;
                            tool: string;
                            summary: string;
                            args_preview: Record<string, unknown>;
                          }>;
                        }
                      ).__pending ?? [];
                    for (const p of pending) {
                      controller.enqueue(
                        enc.encode(
                          sseEvent({
                            kind: "tool_confirm",
                            action_id: p.id,
                            tool: p.tool,
                            summary: p.summary,
                            args_preview: p.args_preview,
                          }),
                        ),
                      );
                    }
                    controller.enqueue(enc.encode(sseChunk(`\n\n_${errMsg}_`)));
                    controller.enqueue(enc.encode(sseDone()));
                    controller.close();
                  },
                });
                return new Response(stream, {
                  headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
                });
              }
              return new Response(JSON.stringify({ error: errMsg }), {
                status,
                headers: { "Content-Type": "application/json" },
              });
            }

            // If any tools ran, prepend their activity events to the stream
            // so the client renders them inline as the assistant speaks.
            const pendingForStream =
              (
                activityEvents as unknown as {
                  __pending?: Array<{
                    id: string;
                    tool: string;
                    summary: string;
                    args_preview: Record<string, unknown>;
                  }>;
                }
              ).__pending ?? [];
            if ((activityEvents.length > 0 || pendingForStream.length > 0) && upstream.body) {
              const enc = new TextEncoder();
              const upstreamReader = upstream.body.getReader();
              const stream = new ReadableStream({
                async start(controller) {
                  const onAbort = () => {
                    try {
                      upstreamReader.cancel();
                    } catch {
                      /* noop */
                    }
                    try {
                      controller.close();
                    } catch {
                      /* noop */
                    }
                  };
                  request.signal?.addEventListener("abort", onAbort, { once: true });
                  for (const a of activityEvents) {
                    controller.enqueue(
                      enc.encode(
                        sseEvent({
                          kind: "activity",
                          tool: a.tool,
                          label: a.label,
                          status: "done",
                        }),
                      ),
                    );
                  }
                  for (const p of pendingForStream) {
                    controller.enqueue(
                      enc.encode(
                        sseEvent({
                          kind: "tool_confirm",
                          action_id: p.id,
                          tool: p.tool,
                          summary: p.summary,
                          args_preview: p.args_preview,
                        }),
                      ),
                    );
                  }
                  try {
                    while (true) {
                      const { done, value } = await upstreamReader.read();
                      if (done) break;
                      controller.enqueue(value);
                    }
                  } catch {
                    // client disconnect or upstream tore down - end gracefully
                  }
                  request.signal?.removeEventListener("abort", onAbort);
                  try {
                    controller.close();
                  } catch {
                    /* already closed */
                  }
                },
              });

              return new Response(stream, {
                headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
              });
            }

            return new Response(upstream.body, {
              headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
            });
          } catch (e) {
            const envelope = buildErrorEnvelope(e, requestId, 500);
            console.error("[chat] handler error", {
              requestId,
              category: envelope.category,
              durationMs: Date.now() - startedAt,
              error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : e,
            });
            return new Response(JSON.stringify(envelope), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        };
        return withRequestId(await run());
      },
    },
  },
});
