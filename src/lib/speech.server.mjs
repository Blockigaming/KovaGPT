import { createHash } from "node:crypto";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import {
  createRequestDeadline,
  waitForPromiseWithSignal,
} from "./ai/provider-transport.server.mjs";
import { readVoiceCatalog, selectCatalogVoice, TTS_MODEL_IDS } from "./voice/catalog.server.mjs";

export const SPEECH_LIMITS = Object.freeze({
  textChars: 4000,
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
  return message.content;
}

// Dependencies are explicit so tests cannot accidentally call a paid provider.
export function createSpeechHandler({
  authenticate,
  loadMessage = loadOwnedSpeechMessage,
  rateLimit,
  revalidate,
  config,
  fetchImpl = fetch,
  admit,
}) {
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
      try {
        const bytes = await readResponseBytesBounded(
          new Response(request.body, { headers: request.headers }),
          1024,
          {
            signal: deadline.signal,
            timeoutMs: SPEECH_LIMITS.timeoutMs,
          },
        );
        input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch (error) {
        if (deadline.signal.aborted) throw error;
        throw fail("speech_invalid_request", error?.status === 413 ? 413 : 400);
      }
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input)
          .filter((key) => key !== "voiceId")
          .sort()
          .join(",") !== "chatId,contentSha256,messageId,ownerId" ||
        typeof input.chatId !== "string" ||
        !ID.test(input.chatId) ||
        typeof input.messageId !== "string" ||
        !ID.test(input.messageId) ||
        !/^[a-f0-9]{64}$/u.test(input.contentSha256 ?? "")
      )
        throw fail("speech_invalid_request", 400);
      if (input.ownerId !== auth.userId) throw fail("speech_account_changed", 409);
      if (
        input.voiceId !== undefined &&
        (typeof input.voiceId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/u.test(input.voiceId))
      )
        throw fail("speech_invalid_voice", 400);
      const settings = await wait(config(auth, input));
      // Preserve the legacy handler configuration while allowing only the
      // existing server-owned catalog models for an explicit selection.
      const modelId = settings.modelId ?? "eleven_multilingual_v2";
      if (
        settings.enabled !== true ||
        !settings.apiKey ||
        !/^[A-Za-z0-9_-]{1,128}$/u.test(settings.voiceId ?? "") ||
        !TTS_MODEL_IDS.includes(modelId)
      )
        throw fail("speech_not_configured", 503);
      const text = await wait(loadMessage(auth, input, deadline.signal));
      // Keep caps here too: a different release's loader cannot bypass them.
      if (typeof text !== "string" || !text.trim()) throw fail("speech_message_unavailable", 404);
      if (text.length > SPEECH_LIMITS.textChars) throw fail("speech_text_too_long", 413);
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
        if (!limit.allowed) {
          finish();
          return json(
            limit.status === "unavailable" ? "speech_limits_unavailable" : "speech_limit_reached",
            limit.status === "unavailable" ? 503 : 429,
            { "Retry-After": String(limit.retryAfter || 60) },
          );
        }
      }
      await wait(revalidate(auth, deadline.signal));
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
      // No automatic retries, caller-selected endpoint/voice/text, or provider-body logging.
      const upstream = await wait(
        fetchImpl(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.voiceId)}/stream?output_format=mp3_44100_128`,
          {
            method: "POST",
            redirect: "error",
            credentials: "omit",
            cache: "no-store",
            signal: deadline.signal,
            headers: {
              "xi-api-key": settings.apiKey,
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
            },
            body: JSON.stringify({ text, model_id: modelId }),
          },
        ),
      );
      if (
        !upstream.ok ||
        !upstream.body ||
        upstream.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "audio/mpeg"
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
          "Content-Type": "audio/mpeg",
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
