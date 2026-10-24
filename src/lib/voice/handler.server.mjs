import {
  VoiceError,
  voiceConfiguration,
  publicVoiceConfiguration,
  parseVoiceRequest,
  executeVoice,
  voiceErrorResponse,
} from "./elevenlabs.server.mjs";

import { selectCatalogVoice } from "./catalog.server.mjs";

function discardResponse(response) {
  try {
    void response?.body?.cancel().catch(() => {});
  } catch {
    // A response that was already released still must not reach a stale caller.
  }
}

// Dependencies are injected so authorization and quota ordering can be proven
// offline, without loading database clients or contacting the provider.
export function createVoiceHandler({
  requireUser,
  assertNotBanned,
  assertFeatureEnabled,
  enforceQuota,
  getCallerTier,
  env,
  execute = executeVoice,
}) {
  return async function handle(request) {
    let response;
    try {
      request.signal.throwIfAborted();
      if (request.method !== "GET" && request.method !== "POST")
        return Response.json({ error: "method_not_allowed" }, { status: 405 });
      if (request.method === "POST") {
        const origin = request.headers.get("origin");
        const fetchSite = request.headers.get("sec-fetch-site");
        if (
          (origin && origin !== new URL(request.url).origin) ||
          fetchSite === "cross-site" ||
          (!origin && fetchSite !== "same-origin")
        ) {
          return Response.json(
            { error: "cross_origin_request" },
            { status: 403, headers: { "Cache-Control": "no-store" } },
          );
        }
      }
      const auth = await requireUser(request);
      if (auth instanceof Response) return auth;
      if (request.headers.get("x-kova-voice-owner") !== auth.userId)
        return Response.json(
          { error: "account_changed" },
          { status: 409, headers: { "Cache-Control": "no-store" } },
        );
      if (!auth.emailVerified)
        return Response.json({ error: "email_verification_required" }, { status: 403 });
      const banned = await assertNotBanned(auth);
      if (banned) return banned;
      const feature = await assertFeatureEnabled(auth, "voice");
      if (feature) return feature;
      const tier = await getCallerTier(auth);
      const config = voiceConfiguration(env, tier);
      if (request.method === "GET")
        return Response.json(publicVoiceConfiguration(config), {
          headers: { "Cache-Control": "no-store" },
        });
      if (!config.configured) throw new VoiceError("voice_not_configured", 503);
      const input = await parseVoiceRequest(request);
      if (
        input.action !== "stt" &&
        (input.voiceId !== undefined || config.catalog.defaultVoiceId !== null)
      ) {
        const selected = selectCatalogVoice(config.catalog, input.voiceId);
        if ("error" in selected) throw new VoiceError(selected.error, selected.status);
        config.voiceId = selected.providerVoiceId;
        config.modelId = selected.modelId;
      }
      if (!config[input.action]) throw new VoiceError("voice_not_configured", 503);
      request.signal.throwIfAborted();
      // Parsing an upload can outlive the session that admitted its headers.
      // Revalidate before reserving quota or starting a billable operation.
      if (auth.revalidateSession && !(await auth.revalidateSession()))
        return Response.json(
          { error: "session_expired" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      request.signal.throwIfAborted();
      const quota = await enforceQuota(auth, "voice", config.dailyLimit, 1, request.signal);
      if (quota) return quota;
      request.signal.throwIfAborted();
      response = await execute(input, config, { signal: request.signal });
      request.signal.throwIfAborted();
      if (auth.revalidateSession && !(await auth.revalidateSession())) {
        discardResponse(response);
        return Response.json(
          { error: "session_expired" },
          { status: 401, headers: { "Cache-Control": "no-store" } },
        );
      }
      request.signal.throwIfAborted();
      return response;
    } catch (error) {
      discardResponse(response);
      return voiceErrorResponse(
        request.signal.aborted ? new VoiceError("voice_cancelled", 499) : error,
      );
    }
  };
}
