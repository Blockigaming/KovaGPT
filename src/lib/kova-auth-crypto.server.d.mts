export type KovaPrincipal = {
  accountId: string;
  sessionId: string;
  email: string;
  emailVerified: boolean;
  assuranceLevel: "aal1" | "aal2";
  expiresAt?: string;
  displayName?: string | null;
};

export function normalizeKovaEmail(value: string): string;
export function generateKovaToken(bytes?: number): string;
export function digestKovaToken(token: string): string;
export function digestMatches(value: string, expectedHex: string): boolean;
export function hashKovaPassword(password: string): Promise<string>;
export function verifyKovaPassword(password: string, encoded: string): Promise<boolean>;
export function verifyKovaTotp(code: string, base32Secret: string, now?: number): boolean;
export function generateKovaTotpEnrollment(email: string): { secret: string; uri: string };
export function encryptKovaSecret(plaintext: string, env?: NodeJS.ProcessEnv): string;
export function decryptKovaSecret(envelope: string, env?: NodeJS.ProcessEnv): string;
export function kovaCompatibilityJwtHasMarker(token: string): boolean;
export function verifyKovaCompatibilityJwt(
  token: string,
  env?: NodeJS.ProcessEnv,
  now?: number,
): {
  accountId: string;
  sessionId: string;
  email: string;
  emailVerified: true;
  assuranceLevel: "aal1" | "aal2";
  issuedAt: number;
  expiresAt: number;
};
export function signKovaCompatibilityJwt(
  principal: KovaPrincipal,
  env?: NodeJS.ProcessEnv,
  now?: number,
): string;
export function verifyGoogleIdToken(
  idToken: string,
  options: {
    clientId: string;
    expectedNonceDigest: string;
    fetchImpl?: typeof fetch;
    now?: number;
  },
): Promise<{
  subject: string;
  email: string;
  emailVerified: true;
  displayName: string;
}>;
export const KOVA_AUTH_SESSION_SECONDS: number;
export const KOVA_AUTH_CHALLENGE_SECONDS: number;
export const KOVA_AUTH_HANDOFF_SECONDS: number;
