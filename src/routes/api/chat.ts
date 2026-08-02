import { createFileRoute } from "@tanstack/react-router";
import { newRequestId, buildErrorEnvelope, categorizeError } from "@/lib/request-id";
import {
  getMode,
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
  getAvailableGoogleTools,
  TOOL_ACTIVITY,
  WRITE_TOOL_NAMES,
  runGoogleTool,
  stagePendingAction,
} from "@/lib/google-tools.server";
import {
  chatCompletions,
  imageGenerations,
  imageModel,
  missingAiProviderResponse,
} from "@/lib/ai/provider.server";
import { NEWS_TRIGGER, runWebSearch, shouldRunWebSearch } from "@/lib/ai/search.server";
import { getDeepResearchAccess } from "@/lib/ai/deep-research-access.mjs";
import { runDeepResearch, type ResearchProgressEvent } from "@/lib/ai/deep-research.server";
import {
  authorizeResearchPersistence,
  ResearchPersistenceAuthorizationError,
  type AuthorizedResearchReferences,
  type ResearchAuthorizationClient,
} from "@/lib/research-persistence-authorization.server.mjs";
import { activityToSseDelta, createToolActivityEvent } from "@/lib/ai/activity.server";
import { selectModelForMode, mapProviderError } from "@/lib/ai/registry.server";
import { formatMemoryBlock, selectRelevantMemories, type KovaMemory } from "@/lib/ai/memory.server";
import {
  CHAT_BODY_LIMIT_BYTES,
  ChatIngressError,
  chatAnonymousRateLimiter,
  readChatRequest,
  resolveAnonymousClientKey,
  toChatIngressErrorEnvelope,
  type ChatUserContext,
} from "@/lib/chat-ingress.server.mjs";

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
type SafeLogContext = { requestId: string; startedAt: number };
type SafeLogCategory = "provider" | "optional_context" | "policy" | "server";

function logSafeFailure(
  level: "warn" | "error",
  event: string,
  context: SafeLogContext,
  details: { status: number; category: SafeLogCategory; code: string },
): void {
  const payload = {
    requestId: context.requestId,
    status: details.status,
    category: details.category,
    durationMs: Date.now() - context.startedAt,
    code: details.code,
  };
  if (level === "error") console.error(event, payload);
  else console.warn(event, payload);
}

function buildUserContextBlock(user: ChatUserContext): string {
  const entries = Object.entries(user).filter(([, value]) => value != null && value !== "");
  if (!entries.length) return "";
  return `\n\n--- User context ---\n${entries.map(([key, value]) => `${key}: ${String(value)}`).join("\n")}\n--- End user context ---`;
}
function buildCurrentDateInstruction(timezone?: string, locale?: string): string {
  return `\nCurrent date: ${new Date().toISOString().slice(0, 10)}${timezone ? `; timezone: ${timezone}` : ""}${locale ? `; locale: ${locale}` : ""}.`;
}

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
    logContext: SafeLogContext;
  },
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
      } catch {
        if (options.signal?.aborted) {
          controller.enqueue(enc.encode(sseChunk("_Deep Research was cancelled._")));
        } else {
          logSafeFailure("error", "[chat] deep research failed", options.logContext, {
            status: 502,
            category: "provider",
            code: "deep_research_failed",
          });
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
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

async function handleImageRequest(prompt: string, logContext: SafeLogContext): Promise<Response> {
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
          void upstream.body?.cancel().catch(() => undefined);
          logSafeFailure("error", "[chat] image provider rejected request", logContext, {
            status,
            category: "provider",
            code: "image_provider_http_error",
          });
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
      } catch {
        logSafeFailure("error", "[chat] image provider request failed", logContext, {
          status: 502,
          category: "provider",
          code: "image_provider_network_error",
        });
        controller.enqueue(
          enc.encode(sseChunk("Sorry  -  image generation failed. Please try again.")),
        );
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

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const requestId = newRequestId();
        const startedAt = Date.now();
        const logContext: SafeLogContext = { requestId, startedAt };
        const withRequestId = (res: Response): Response => {
          try {
            const h = new Headers(res.headers);
            if (!h.has("X-Request-Id")) h.set("X-Request-Id", requestId);
            h.set("Cache-Control", "no-store");
            h.delete("Content-Length");
            const ct = h.get("Content-Type") ?? "";
            // Enrich JSON error bodies with requestId + category envelope.
            if (res.status >= 400 && ct.includes("application/json") && res.body) {
              return new Response(
                new ReadableStream({
                  async start(controller) {
                    const text = await res.clone().text();
                    let parsed: Record<string, unknown>;
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
            let ingress;
            try {
              ingress = await readChatRequest(request, CHAT_BODY_LIMIT_BYTES);
            } catch (error) {
              if (error instanceof ChatIngressError) {
                return Response.json(toChatIngressErrorEnvelope(error, requestId), {
                  status: error.status,
                });
              }
              throw error;
            }

            const auth = await optionalUser(request);
            if (auth instanceof Response) return auth;

            if (!auth) {
              const clientKey = resolveAnonymousClientKey(request.headers);
              if (chatAnonymousRateLimiter.isLimited(clientKey)) {
                return new Response(
                  JSON.stringify({
                    error: "Too many requests. Sign in to continue.",
                  }),
                  {
                    status: 429,
                    headers: { "Content-Type": "application/json" },
                  },
                );
              }
            }
            const {
              messages,
              mode,
              user,
              timezone,
              locale,
              chatId,
              personality,
              projectId,
              temporary,
              clientTool,
            } = ingress;
            // Temporary Chat is a clean-room request: even a custom client
            // cannot combine `temporary: true` with profile or personality
            // fields and have those values reach the model prompt.
            const personalContext = temporary ? undefined : user;
            const personalityBlock =
              !temporary && personality
                ? `\n\n--- User personality preferences ---\n${personality}\n--- End personality ---`
                : "";
            const MAX_TEXT_ATTACHMENT_CHARS = 256 * 1024;

            const lastUser = [...messages].reverse().find((m) => m.role === "user");
            const currentAttachments = lastUser?.attachments ?? [];

            // Detect image-generation intent on the latest user message
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
              callerTier = isOwner ? "pro" : await getCallerTier(auth);
            }

            // Deep Research is a paid, high-cost operation. Authorize it before
            // checking or invoking any AI/search provider so forged clientTool
            // values cannot become a denial-of-wallet path.
            const researchAccess = getDeepResearchAccess({
              requested: clientTool === "deep_research",
              authenticated: Boolean(auth),
              tier: callerTier,
              owner: isOwner,
            });
            if (!researchAccess.allowed) {
              return Response.json(
                { error: researchAccess.error },
                { status: researchAccess.status },
              );
            }

            // Deep Research persists through a service-role client. Prove that
            // every caller-supplied relationship is visible through the
            // authenticated user's RLS-scoped client before quota checks or
            // provider execution. Unknown and cross-user ids fail closed.
            let authorizedResearchReferences: AuthorizedResearchReferences | undefined;
            if (clientTool === "deep_research" && auth) {
              try {
                authorizedResearchReferences = await authorizeResearchPersistence({
                  supabaseUser: auth.supabaseUser as unknown as ResearchAuthorizationClient,
                  chatId,
                  projectId,
                });
              } catch (error) {
                if (error instanceof ResearchPersistenceAuthorizationError) {
                  if (error.status === 503) {
                    logSafeFailure(
                      "warn",
                      "[chat] research authorization unavailable",
                      logContext,
                      {
                        status: error.status,
                        category: "server",
                        code: error.code,
                      },
                    );
                  }
                  return Response.json(
                    { error: error.publicMessage },
                    {
                      status: error.status,
                      headers: { "Cache-Control": "no-store" },
                    },
                  );
                }
                logSafeFailure("error", "[chat] research authorization failed", logContext, {
                  status: 503,
                  category: "server",
                  code: "research_authorization_failed",
                });
                return Response.json(
                  { error: "Research storage authorization is temporarily unavailable." },
                  { status: 503, headers: { "Cache-Control": "no-store" } },
                );
              }
            }

            const missingProvider = missingAiProviderResponse();
            if (missingProvider) return missingProvider;

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
                    {
                      status: 403,
                      headers: { "Content-Type": "application/json" },
                    },
                  );
                }
                const maint = await assertFeatureEnabled(auth, "images");
                if (maint) return maint;
                const imgLimit = DAILY_IMAGE_LIMIT_BY_TIER[callerTier];
                const quota = await enforceQuota(auth, "images", imgLimit);
                if (quota) return quota;
              }
              return handleImageRequest(lastText, logContext);
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
            const TIER_RANK: Record<"free" | "plus" | "pro", number> = {
              free: 0,
              plus: 1,
              pro: 2,
            };
            const requested = getMode(mode ?? "auto");
            const allowed = isOwner || TIER_RANK[requested.tier] <= TIER_RANK[callerTier];
            // Guests always receive the basic instant agent, even if a custom
            // client attempts to submit a higher mode directly to the API.
            const m = !auth ? getMode("instant") : allowed ? requested : getMode("auto");
            const MAX_ATTACHMENTS_PER_REQUEST = 2;
            // Quotas apply to files submitted in this turn, not attachments in
            // older conversation history. This also keeps edit/regenerate from
            // being charged for unrelated files in prior turns.
            const totalAttachments = currentAttachments.length;
            // File / photo uploads require an account.
            if (totalAttachments > 0 && !auth) {
              return unauthorized("Sign in to upload files or photos.");
            }
            if (!isOwner && totalAttachments > MAX_ATTACHMENTS_PER_REQUEST) {
              return new Response(
                JSON.stringify({
                  error: `Too many image attachments in this request (max ${MAX_ATTACHMENTS_PER_REQUEST}).`,
                }),
                {
                  status: 429,
                  headers: { "Content-Type": "application/json" },
                },
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
                  {
                    status: 403,
                    headers: { "Content-Type": "application/json" },
                  },
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
              for (const att of currentAttachments) {
                if (att.kind === "text_file") {
                  totalBytes += new TextEncoder().encode(att.content).byteLength;
                  continue;
                }
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
              const tier = await getCallerTier(auth);
              const storage = await enforceStorage(auth, totalBytes, STORAGE_LIMITS_BYTES[tier]);
              if (storage) return storage;
            }
            const hasAttachments = totalAttachments > 0;
            const hasImages = currentAttachments.some((attachment) => attachment.kind === "image");

            if (clientTool === "deep_research" && lastText && !hasAttachments) {
              return handleDeepResearchRequest(lastText, {
                signal: request.signal,
                logContext,
                persistence: auth
                  ? {
                      supabase:
                        auth.supabaseAdmin as unknown as import("@/lib/ai/deep-research.server").ResearchPersistence["supabase"],
                      userId: auth.userId,
                      chatId: authorizedResearchReferences?.chatId,
                      projectId: authorizedResearchReferences?.projectId,
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

            const transformed = await Promise.all(
              trimmedMessages.map(async (msg) => {
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
                      parts.push({
                        type: "image_url",
                        image_url: { url: att.dataUrl },
                      });
                    } else if (att.kind === "text_file") {
                      parts.push({
                        type: "text",
                        text: `[Attached text file: ${att.name} (${att.fileType ?? "text/plain"})]\n--- BEGIN ATTACHED FILE ---\n${att.content}\n--- END ATTACHED FILE ---`,
                      });
                    } else if (att.kind === "library_file") {
                      let libraryContent = "";
                      if (auth && msg === lastUser) {
                        const { data } = await auth.supabaseAdmin
                          .from("user_library_items")
                          .select("content_text")
                          .eq("id", att.libraryItemId)
                          .eq("user_id", auth.userId)
                          .maybeSingle();
                        const row = data as { content_text?: unknown } | null;
                        if (typeof row?.content_text === "string") {
                          libraryContent = row.content_text.slice(0, MAX_TEXT_ATTACHMENT_CHARS);
                        }
                      }
                      parts.push({
                        type: "text",
                        text: libraryContent
                          ? `[Attached Library file: ${att.name} (${att.fileType ?? "unknown type"}). Do not expose private URLs.]\n--- BEGIN LIBRARY CONTENT ---\n${libraryContent}\n--- END LIBRARY CONTENT ---`
                          : `[Attached Library file: ${att.name} (${att.fileType ?? "unknown type"}). The file's extracted content is unavailable, so do not claim to have read it and do not expose private URLs.]`,
                      });
                    }
                  }
                  return { role: "user", content: parts };
                }
                return { role: safeRole, content: msg.content };
              }),
            );

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
                shouldRunWebSearch(lastText, personalContext?.webSearch)
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
            // context across conversations. Consent is opt-in and Temporary
            // Chat never reaches the memory table.
            let memoryBlock = "";
            if (
              auth &&
              (callerTier === "plus" || callerTier === "pro") &&
              personalContext?.rememberAcross === true &&
              !temporary
            ) {
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
                  .limit(callerTier === "pro" ? 500 : callerTier === "plus" ? 12 : 0);
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
                      enabled: personalContext.rememberAcross === true,
                      temporary: Boolean(temporary),
                      maxItems: callerTier === "pro" ? 200 : callerTier === "plus" ? 12 : 0,
                    }),
                  );
                }
              } catch {
                logSafeFailure("warn", "[chat] optional memory context unavailable", logContext, {
                  status: 200,
                  category: "optional_context",
                  code: "memory_context_unavailable",
                });
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
              } catch {
                logSafeFailure("warn", "[chat] optional project context unavailable", logContext, {
                  status: 200,
                  category: "optional_context",
                  code: "project_context_unavailable",
                });
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
                    m.systemPrompt +
                    TONE_INSTRUCTION +
                    ADAPTIVE_INSTRUCTION +
                    UNRESTRICTED_INSTRUCTION +
                    ACCURACY_INSTRUCTION +
                    CHART_INSTRUCTION +
                    CREATOR_INSTRUCTION +
                    buildUserContextBlock(personalContext ?? {}) +
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
            // Only enable reasoning when the user explicitly chose a backed
            // reasoning mode. Every visible selector option maps to this real behavior.
            if (m.reasoning) {
              body.reasoning = { effort: m.reasoning };
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
            const availableTools =
              auth && !hasImages && m.id !== "instant" && lastText.length > 0
                ? await getAvailableGoogleTools(auth.userId).catch(() => [])
                : [];
            const enableTools = availableTools.length > 0;

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
            type ToolResultMsg = {
              role: "tool";
              tool_call_id: string;
              content: string;
            };
            type ChatMsg =
              | { role: string; content: unknown; [k: string]: unknown }
              | AssistantMsg
              | ToolResultMsg;

            const workingMessages: ChatMsg[] = [...(body.messages as unknown as ChatMsg[])];
            const activityEvents: Array<{
              tool: string;
              label: string;
              args?: unknown;
            }> = [];

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
                request.signal?.addEventListener("abort", onReqAbort, {
                  once: true,
                });
                let hopRes: Response;
                try {
                  hopRes = await chatCompletions(
                    {
                      model,
                      messages: workingMessages,
                      tools: availableTools,
                      tool_choice: "auto",
                      stream: false,
                    },
                    { signal: hopCtl.signal },
                  );
                } catch {
                  clearTimeout(hopTimer);
                  request.signal?.removeEventListener("abort", onReqAbort);
                  if (request.signal?.aborted) return new Response(null, { status: 499 });
                  hopFailed = true;
                  logSafeFailure("warn", "[chat] tool hop failed", logContext, {
                    status: 502,
                    category: "provider",
                    code: "tool_hop_failed",
                  });
                  break;
                }
                clearTimeout(hopTimer);
                request.signal?.removeEventListener("abort", onReqAbort);

                if (!hopRes.ok) {
                  hopFailed = true;
                  void hopRes.body?.cancel().catch(() => undefined);
                  logSafeFailure("warn", "[chat] tool hop rejected", logContext, {
                    status: hopRes.status,
                    category: "provider",
                    code: "tool_hop_http_error",
                  });
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
                  logSafeFailure("warn", "[chat] tool budget reached", logContext, {
                    status: 200,
                    category: "policy",
                    code: "tool_budget_reached",
                  });
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
                      return {
                        role: "tool",
                        tool_call_id: tc.id,
                        content: cached,
                      };
                    }
                    if (WRITE_TOOL_NAMES.has(tc.function.name)) {
                      try {
                        const staged = await stagePendingAction(
                          auth!.userId,
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
                      } catch {
                        return {
                          role: "tool",
                          tool_call_id: tc.id,
                          content: JSON.stringify({
                            error: "stage_failed",
                            message: "Unable to prepare the requested action.",
                          }),
                        };
                      }
                    }
                    try {
                      const out = await runGoogleTool(auth!.userId, tc.function.name, parsedArgs);
                      const content = JSON.stringify(out).slice(0, 24000);
                      dedupCache.set(key, content);
                      return { role: "tool", tool_call_id: tc.id, content };
                    } catch {
                      return {
                        role: "tool",
                        tool_call_id: tc.id,
                        content: JSON.stringify({
                          error: "tool_failed",
                          message: "The connected service request failed.",
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
              (
                activityEvents as unknown as {
                  __pending?: typeof pendingConfirms;
                }
              ).__pending = pendingConfirms;
            }

            // === FINAL STREAMING CALL =============================================
            const finalBody = {
              ...body,
              messages: workingMessages,
              stream: true,
            };
            const activityCount = activityEvents.length;
            const pendingCount =
              (activityEvents as unknown as { __pending?: unknown[] }).__pending?.length ?? 0;
            const hasStreamedActivity = activityCount > 0 || pendingCount > 0;
            let upstream: Response;
            try {
              upstream = await chatCompletions(finalBody, {
                signal: request.signal,
              });
            } catch {
              if (request.signal?.aborted) return new Response(null, { status: 499 });
              logSafeFailure("error", "[chat] final provider request failed", logContext, {
                status: 502,
                category: "provider",
                code: "final_provider_network_error",
              });
              return new Response(
                JSON.stringify({
                  error: "AI service is temporarily unavailable. Please try again.",
                }),
                {
                  status: 502,
                  headers: { "Content-Type": "application/json" },
                },
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
              void upstream.body?.cancel().catch(() => undefined);
              logSafeFailure("error", "[chat] final provider rejected request", logContext, {
                status: upstream.status,
                category: "provider",
                code: "final_provider_http_error",
              });
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
                  headers: {
                    "Content-Type": "text/event-stream",
                    "Cache-Control": "no-cache",
                  },
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
                  request.signal?.addEventListener("abort", onAbort, {
                    once: true,
                  });
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
                headers: {
                  "Content-Type": "text/event-stream",
                  "Cache-Control": "no-cache",
                },
              });
            }

            return new Response(upstream.body, {
              headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
              },
            });
          } catch (e) {
            const providerError = mapProviderError(e);
            const status = providerError.status;
            const envelope = buildErrorEnvelope(providerError, requestId, status);
            logSafeFailure("error", "[chat] handler failed", logContext, {
              status,
              category: "server",
              code: "unhandled_chat_error",
            });
            return new Response(JSON.stringify(envelope), {
              status,
              headers: { "Content-Type": "application/json" },
            });
          }
        };
        return withRequestId(await run());
      },
    },
  },
});
