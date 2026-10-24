import type { HttpAuthedCaller } from "../api-auth.server";
import type { executeVoice } from "./elevenlabs.server.mjs";
export function createVoiceHandler(dependencies: {
  requireUser: (request: Request) => Promise<HttpAuthedCaller | Response>;
  assertNotBanned: (auth: HttpAuthedCaller) => Promise<Response | null>;
  assertFeatureEnabled: (auth: HttpAuthedCaller, feature: "voice") => Promise<Response | null>;
  enforceQuota: (
    auth: HttpAuthedCaller,
    kind: "voice",
    limit: number,
    increment: number,
    signal?: AbortSignal,
  ) => Promise<Response | null>;
  getCallerTier: (auth: HttpAuthedCaller) => Promise<"free" | "plus" | "pro">;
  env: (name: string) => string | undefined;
  execute?: typeof executeVoice;
}): (request: Request) => Promise<Response>;
