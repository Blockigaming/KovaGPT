// Mints an ephemeral OpenAI Realtime API session token for the signed-in
// user. The browser uses that short-lived token to negotiate a WebRTC
// connection directly with OpenAI for true conversational voice (with
// barge-in / interruptions / natural turn-taking).
//
// Gating: Plus and Pro only. The token expires in ~60 seconds and can
// only be used once for a single WebRTC handshake, so leaking it has
// limited blast radius.
import { createFileRoute } from "@tanstack/react-router";
import {
  assertFeatureEnabled,
  assertNotBanned,
  enforceQuota,
  getCallerTier,
  requireUser,
} from "@/lib/api-auth.server";

const REALTIME_DAILY_LIMIT = 30; // ~30 voice sessions/day per user (cost guardrail)

export const Route = createFileRoute("/api/realtime-session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await requireUser(request);
        if (auth instanceof Response) return auth;

        const banned = await assertNotBanned(auth);
        if (banned) return banned;
        const maint = await assertFeatureEnabled(auth, "voice");
        if (maint) return maint;

        // Voice mode is free for all signed-in users (per-user daily quota
        // below keeps costs bounded).
        void getCallerTier;

        const quota = await enforceQuota(auth, "voice", REALTIME_DAILY_LIMIT);
        if (quota) return quota;

        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return new Response(
            JSON.stringify({ error: "Realtime voice is not configured on the server." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          voice?: string;
          instructions?: string;
        };
        const ALLOWED_VOICES = new Set([
          "alloy", "ash", "ballad", "coral", "echo",
          "sage", "shimmer", "verse", "marin", "cedar",
        ]);
        const voice = body.voice && ALLOWED_VOICES.has(body.voice) ? body.voice : "marin";
        const instructions =
          (typeof body.instructions === "string" ? body.instructions.slice(0, 4000) : "") ||
          "You are KovaGPT, a warm, helpful, conversational AI built by Zachary Block. Speak naturally in short, complete sentences. Keep replies under three sentences unless asked for more. Never use markdown, lists, or symbols. Acknowledge user feelings briefly before solving. Never repeat profanity. Stay PG.";

        // gpt-realtime is the current GA realtime model and supports the
        // newer voices (marin, cedar). The old gpt-4o-realtime-preview
        // model rejects those voices, which was the source of the
        // "Could not start realtime voice session" error.
        const model = "gpt-realtime";
        const resp = await fetch("https://api.openai.com/v1/realtime/sessions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "OpenAI-Beta": "realtime=v1",
          },
          body: JSON.stringify({
            model,
            voice,
            instructions,
            modalities: ["audio", "text"],
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          }),
        });

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          console.error("[realtime-session] upstream error", resp.status, text);
          // Surface the actual upstream reason so client can show something useful
          let detail = "Could not start realtime voice session.";
          try {
            const parsed = JSON.parse(text);
            detail = parsed?.error?.message || detail;
          } catch { /* keep default */ }
          return new Response(
            JSON.stringify({ error: detail, upstream_status: resp.status }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        const json = await resp.json();
        // Include the model so the client's SDP handshake uses the same one.
        return new Response(JSON.stringify({ ...json, model }), {
          headers: { "Content-Type": "application/json" },
        });

      },
    },
  },
});
