import { createHash } from "node:crypto";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "./ai/provider-transport.server.mjs";
import {
  readVoiceCatalog,
  selectCatalogVoice,
  STREAM_TTS_MODEL_IDS,
  TTS_MODEL_IDS,
} from "./voice/catalog.server.mjs";
import {
  verifyVoiceModelReceipt,
  verifyVoiceSegmentReceipt,
} from "./voice/openai-model-eligibility.server.mjs";

export const SPEECH_LIMITS = Object.freeze({
  textChars: 4000,
  segmentChars: 1000,
  segmentsPerTurn: 48,
  turnTtlMs: 10 * 60 * 1000,
  turnLedgerEntries: 500,
  audioBytes: 8 * 1024 * 1024,
  timeoutMs: 60000,
});
const ID = /^[A-Za-z0-9._:-]{1,200}$/u;
const fail = (code, status) => Object.assign(new Error(code), { speechCode: code, status });
const json = (code, status, headers = {}) =>
  Response.json(
    { error: code },
    { status, headers: { "Cache-Control": "private, no-store", ...headers } },
  );

export function speechConfiguration(env, tier, requestedVoiceId) {
  const enabled =
    env("KOVA_SPEECH_ENABLED") === "true" && env("KOVA_GENERATION_DISABLED") !== "true";
  const apiKey = env("ELEVENLABS_API_KEY");
  const catalog = readVoiceCatalog(env, tier);
  if (
    !enabled ||
    !apiKey ||
    !catalog.valid ||
    (requestedVoiceId === undefined && catalog.defaultVoiceId === null)
  )
    return { enabled: false };
  const selected = selectCatalogVoice(catalog, requestedVoiceId);
  if ("error" in selected) throw fail(`speech_${selected.error}`, selected.status);
  return {
    enabled,
    apiKey,
    voiceId: selected.providerVoiceId,
    modelId: selected.modelId,
  };
}

export async function loadOwnedSpeechMessage(auth, input, signal) {
  const result = await auth.supabaseUser
    .from("chat_history_records")
    .select("owner_id,id,payload,deleted_at")
    .eq("owner_id", auth.userId)
    .eq("id", input.chatId)
    .is("deleted_at", null)
    .abortSignal(signal)
    .maybeSingle();
  const row = result.data;
  if (result.error) throw fail("speech_history_unavailable", 503);
  if (
    !row ||
    row.owner_id !== auth.userId ||
    row.id !== input.chatId ||
    row.deleted_at ||
    row.payload?.id !== input.chatId ||
    row.payload?.temporary === true ||
    !Array.isArray(row.payload?.messages)
  )
    throw fail("speech_message_unavailable", 404);
  const matches = row.payload.messages.filter((m) => m?.id === input.messageId);
  const message = matches[0];
  if (
    matches.length !== 1 ||
    message.role !== "assistant" ||
    message.generationStatus != null ||
    message.pendingImage ||
    typeof message.content !== "string" ||
    !message.content.trim()
  )
    throw fail("speech_message_unavailable", 404);
  if (message.content.length > SPEECH_LIMITS.textChars) throw fail("speech_text_too_long", 413);
  if (createHash("sha256").update(message.content).digest("hex") !== input.contentSha256)
    throw fail("speech_message_not_synced", 409);
  return { text: message.content, voiceModelReceipt: message.voiceModelReceipt };
}

// Dependencies are explicit so tests cannot accidentally call a paid provider.
export function createSpeechHandler({
  authenticate,
  loadMessage = loadOwnedSpeechMessage,
  rateLimit,
  revalidate,
  config,
  modelPolicy,
  fetchImpl = fetch,
  admit,
  quota,
  streamModelId = "eleven_flash_v2_5",
  now = Date.now,
}) {
  // One spoken reply is many provider calls. Plan quota and the per-minute
  // paid-provider buckets are charged once per authenticated reply; the ledger
  // also stops a signed segment from being replayed or a reply from exceeding
  // its segment and character budget.
  const turnLedger = new Map();
  return async (request) => {
    const cancellation = new AbortController();
    const deadline = createRequestDeadline(cancellation.signal, SPEECH_LIMITS.timeoutMs, "speech");
    let reader;
    let outputController;
    let closed = false;
    let admissionTimer;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(admissionTimer);
      deadline.cleanup();
      request.signal.removeEventListener("abort", abort);
      deadline.signal.removeEventListener("abort", cancelReader);
    };
    const cancelReader = () => {
      void reader?.cancel().catch(() => undefined);
      // Cancelling upstream alone leaves an already queued first MP3 chunk
      // readable downstream. Error the output too so Stop discards that audio.
      if (outputController) {
        outputController.error(new Error("speech_stream_interrupted"));
        finish();
      }
    };
    const abort = () => cancellation.abort(new DOMException("Speech stopped", "AbortError"));
    if (request.signal.aborted) abort();
    else request.signal.addEventListener("abort", abort, { once: true });
    deadline.signal.addEventListener("abort", cancelReader, { once: true });
    const wait = (p) => waitForPromiseWithSignal(p, deadline.signal, "speech");
    try {
      if (request.method !== "POST") throw fail("speech_method_not_allowed", 405);
      if (
        request.headers.get("origin") !== new URL(request.url).origin ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw fail("speech_cross_origin", 403);
      const auth = await wait(authenticate(request));
      if (auth instanceof Response) {
        finish();
        return auth;
      }
      if (!auth?.userId) throw fail("speech_unauthorized", 401);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw fail("speech_invalid_request", 400);
      let input;
      let requestSize = 0;
      try {
        const bytes = await readResponseBytesBounded(
          new Response(request.body, { headers: request.headers }),
          SPEECH_LIMITS.textChars * 6 + 4096,
          {
            signal: deadline.signal,
            timeoutMs: SPEECH_LIMITS.timeoutMs,
          },
        );
        requestSize = bytes.byteLength;
        input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        if (deadline.signal.aborted) throw error;
        throw fail("speech_invalid_request", error?.status === 413 ? 413 : 400);
      }
      const liveSegment = input?.mode === "live-segment";
      // Only the signed live-segment path negotiates raw PCM. Existing saved
      // replies, read-aloud and older clients retain their MP3 contract.
      const pcm = liveSegment && request.headers.get("accept") === "audio/pcm";
      const outputFormat = pcm ? "pcm_24000" : "mp3_44100_128";
      const outputType = pcm ? "audio/pcm" : "audio/mpeg";
      const direct = input?.mode === "read-aloud" || input?.mode === "live-reply" || liveSegment;
      const liveReply = input?.mode === "live-reply";
      if (!direct && requestSize > 1024) throw fail("speech_invalid_request", 413);
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input)
          .filter((key) => key !== "voiceId")
          .sort()
          .join(",") !==
          (liveSegment
            ? "chatId,contentSha256,messageId,mode,ownerId,segmentIndex,segmentReceipt,text"
            : liveReply
              ? "chatId,contentSha256,messageId,mode,ownerId,text,voiceModelReceipt"
              : direct
                ? "chatId,contentSha256,messageId,mode,ownerId,text"
                : "chatId,contentSha256,messageId,ownerId") ||
        typeof input.chatId !== "string" ||
        !ID.test(input.chatId) ||
        typeof input.messageId !== "string" ||
        !ID.test(input.messageId) ||
        !/^[a-f0-9]{64}$/u.test(input.contentSha256 ?? "")
      )
        throw fail("speech_invalid_request", 400);
      if (input.ownerId !== auth.userId) throw fail("speech_account_changed", 409);
      if (
        liveSegment &&
        (!Number.isSafeInteger(input.segmentIndex) ||
          input.segmentIndex < 0 ||
          input.segmentIndex >= SPEECH_LIMITS.segmentsPerTurn ||
          typeof input.text !== "string" ||
          input.text.length > SPEECH_LIMITS.segmentChars ||
          typeof input.segmentReceipt !== "string")
      )
        throw fail("speech_invalid_request", 400);
      if (
        input.voiceId !== undefined &&
        (typeof input.voiceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(input.voiceId))
      )
        throw fail("speech_invalid_voice", 400);
      const settings = await wait(config(auth, input));
      // Preserve the legacy handler configuration while allowing only the
      // existing server-owned catalog models for an explicit selection.
      const modelId = liveSegment
        ? streamModelId
        : direct
          ? "eleven_flash_v2_5"
          : (settings.modelId ?? "eleven_multilingual_v2");
      if (
        settings.enabled !== true ||
        !settings.apiKey ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(settings.voiceId ?? "") ||
        !(liveSegment ? STREAM_TTS_MODEL_IDS : TTS_MODEL_IDS).includes(modelId)
      )
        throw fail("speech_not_configured", 503);
      const saved = direct
        ? { text: input.text, voiceModelReceipt: liveReply ? input.voiceModelReceipt : undefined }
        : await wait(loadMessage(auth, input, deadline.signal));
      const text = saved?.text;
      // Keep caps here too: a different release's loader cannot bypass them.
      if (typeof text !== "string" || !text.trim()) throw fail("speech_message_unavailable", 404);
      if (text.length > SPEECH_LIMITS.textChars) throw fail("speech_text_too_long", 413);
      if (direct && createHash("sha256").update(text).digest("hex") !== input.contentSha256)
        throw fail("speech_invalid_request", 400);
      if (liveSegment) {
        const verifiedPolicy = modelPolicy?.();
        if (!verifiedPolicy?.valid) throw fail("speech_model_not_configured", 503);
        if (
          !verifyVoiceSegmentReceipt(verifiedPolicy, input.segmentReceipt, {
            ownerId: auth.userId,
            chatId: input.chatId,
            messageId: input.messageId,
            index: input.segmentIndex,
            text,
          })
        )
          throw fail("speech_model_not_eligible", 403);
      }
      if (liveReply && (typeof saved.voiceModelReceipt !== "string" || !saved.voiceModelReceipt))
        throw fail("speech_model_not_eligible", 403);
      const policy = modelPolicy?.();
      // Older saved replies predate model receipts. Ownership, exact saved text,
      // session revalidation, and paid-provider rate limits apply to every reply.
      if (saved.voiceModelReceipt && !policy?.valid) throw fail("speech_model_not_configured", 503);
      if (
        saved.voiceModelReceipt &&
        !verifyVoiceModelReceipt(policy, saved.voiceModelReceipt, {
          ownerId: auth.userId,
          chatId: input.chatId,
          messageId: input.messageId,
          content: text,
        })
      )
        throw fail("speech_model_not_eligible", 403);
      const chargeAdmission = async () => {
        for (const bucket of [
          {
            identity: `user:${auth.userId}`,
            action: "speech_user_minute",
            limit: 3,
            windowSeconds: 60,
          },
          {
            identity: `user:${auth.userId}`,
            action: "speech_user_hour",
            limit: 20,
            windowSeconds: 3600,
          },
          {
            identity: "speech:global",
            action: "speech_global_hour",
            limit: 100,
            windowSeconds: 3600,
          },
        ]) {
          const limit = await wait(rateLimit(bucket));
          if (!limit.allowed)
            return json(
              limit.status === "unavailable" ? "speech_limits_unavailable" : "speech_limit_reached",
              limit.status === "unavailable" ? 503 : 429,
              { "Retry-After": String(limit.retryAfter || 60) },
            );
        }
        await wait(revalidate(auth, deadline.signal));
        // Every catalog voice and model spends the caller's plan-based daily voice
        // allowance before any provider work. No voice is exempt.
        if (quota) return (await wait(quota(auth, deadline.signal))) ?? null;
        return null;
      };
      let previousText;
      if (liveSegment) {
        const key = `${auth.userId}\u0000${input.chatId}\u0000${input.messageId}`;
        let turn = turnLedger.get(key);
        if (turn && turn.expires <= now()) {
          turnLedger.delete(key);
          turn = undefined;
        }
        if (!turn) {
          while (turnLedger.size >= SPEECH_LIMITS.turnLedgerEntries)
            turnLedger.delete(turnLedger.keys().next().value);
          turn = {
            expires: now() + SPEECH_LIMITS.turnTtlMs,
            seen: new Set(),
            chars: 0,
            texts: new Map(),
            voiceId: settings.voiceId,
            modelId,
            admission: null,
          };
          const created = turn;
          // Preserve a denial for this reply too: concurrent segments cannot
          // repeatedly reserve quota after a rate-limit or plan rejection.
          created.admission = chargeAdmission();
          void created.admission.catch(() => undefined);
          turnLedger.set(key, created);
        }
        if (turn.voiceId !== settings.voiceId || turn.modelId !== modelId)
          throw fail("speech_invalid_voice", 409);
        if (turn.seen.has(input.segmentIndex)) throw fail("speech_segment_replayed", 409);
        if (turn.chars + text.length > SPEECH_LIMITS.textChars)
          throw fail("speech_text_too_long", 413);
        turn.seen.add(input.segmentIndex);
        turn.chars += text.length;
        turn.texts.set(input.segmentIndex, text);
        previousText = turn.texts.get(input.segmentIndex - 1);
        const denied = await wait(turn.admission);
        if (denied) {
          finish();
          return denied.clone();
        }
        await wait(revalidate(auth, deadline.signal));
      } else {
        const denied = await chargeAdmission();
        if (denied) {
          finish();
          return denied;
        }
      }
      if (admit) {
        const admission = await wait(
          admit({
            request,
            ownerId: auth.userId,
            chatId: input.chatId,
            messageId: input.messageId,
            voiceId: settings.voiceId,
            modelId,
            text,
            signal: deadline.signal,
          }),
        );
        if (admission) {
          const remaining = admission.expiresAt - Date.now();
          if (remaining <= 0) throw fail("speech_not_available", 503);
          admissionTimer = setTimeout(abort, remaining);
        }
      }
      // Use the configured provider endpoint and server-owned voice catalog.
      const upstream = await wait(
        fetchImpl(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}/stream?output_format=${outputFormat}`,
          {
            method: "POST",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal: deadline.signal,
            headers: {
              "xi-api-key": settings.apiKey,
              "Content-Type": "application/json",
              Accept: outputType,
            },
            body: JSON.stringify({
              text,
              model_id: modelId,
              ...(previousText ? { previous_text: previousText } : {}),
            }),
          },
        ),
      );
      const mediaType = upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
      if (
        !upstream.ok ||
        !upstream.body ||
        (pcm
          ? mediaType !== "audio/pcm" && mediaType !== "application/octet-stream"
          : mediaType !== "audio/mpeg")
      ) {
        void upstream.body?.cancel().catch(() => undefined);
        throw fail(
          upstream.status === 429 ? "speech_provider_limit" : "speech_provider_unavailable",
          upstream.status === 429 ? 429 : 502,
        );
      }
      reader = upstream.body.getReader();
      let first = await wait(reader.read());
      if (first.done || !first.value?.byteLength) throw fail("speech_empty_audio", 502);
      // Check the principal again after slow provider headers/first byte, before exposing audio.
      await wait(revalidate(auth, deadline.signal));
      let bytes = 0;
      const body = new ReadableStream({
        start(controller) {
          outputController = controller;
          if (deadline.signal.aborted) cancelReader();
        },
        async pull(controller) {
          if (closed) return;
          try {
            deadline.signal.throwIfAborted();
            const chunk = first ?? (await wait(reader.read()));
            deadline.signal.throwIfAborted();
            first = null;
            if (chunk.done) {
              finish();
              controller.close();
              return;
            }
            bytes += chunk.value.byteLength;
            if (bytes > SPEECH_LIMITS.audioBytes) throw fail("speech_audio_too_large", 502);
            controller.enqueue(chunk.value);
          } catch {
            abort();
            cancelReader();
            finish();
            controller.error(new Error("speech_stream_interrupted"));
          }
        },
        cancel() {
          abort();
          cancelReader();
          finish();
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": pcm ? "audio/pcm; rate=24000" : "audio/mpeg",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Accel-Buffering": "no",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      });
    } catch (error) {
      abort();
      cancelReader();
      finish();
      return json(
        error?.speechCode ??
          (request.signal.aborted
            ? "speech_canceled"
            : deadline.didTimeout()
              ? "speech_timeout"
              : "speech_unavailable"),
        error?.speechCode
          ? error.status
          : request.signal.aborted
            ? 499
            : deadline.didTimeout()
              ? 504
              : 503,
      );
    }
  };
}
