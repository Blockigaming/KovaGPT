export const KOVA_AUTH_MODES: readonly ["supabase", "dual", "kova"];
export const KOVA_SESSION_COOKIE: "__Host-kova_session";
export const KOVA_AUTH_MODE_ENV: "KOVA_AUTH_MODE";

export type KovaAuthMode = (typeof KOVA_AUTH_MODES)[number];
export type KovaCredential =
  | { kind: "anonymous" }
  | { kind: "invalid"; provider: "kova"; code: string }
  | { kind: "credential"; provider: "kova"; token: string }
  | { kind: "credential"; provider: "supabase"; authorization: string };

export function resolveKovaAuthMode(env?: NodeJS.ProcessEnv): KovaAuthMode;
export function kovaAuthEnabled(mode: KovaAuthMode): boolean;
export function supabaseAuthEnabled(mode: KovaAuthMode): boolean;
export function parseCookieHeader(header: string | null): Map<string, string>;
export function readKovaSessionToken(
  request: Request,
): null | { ok: false; code: string } | { ok: true; token: string };
export function serializeKovaSessionCookie(token: string, options?: { maxAge?: number }): string;
export function clearKovaSessionCookie(): string;
export function selectAuthCredential(request: Request, mode?: KovaAuthMode): KovaCredential;
