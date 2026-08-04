export type AuthenticatedUserLike = {
  id?: unknown;
  deleted_at?: unknown;
  banned_until?: unknown;
  email_confirmed_at?: unknown;
  confirmed_at?: unknown;
  factors?: Array<{ status?: unknown }> | null;
};

export type AuthClaimsLike = { aal?: unknown } | null | undefined;

export function parseBearerToken(header: unknown): string | null;
export function evaluateAuthenticatedUser(
  user: AuthenticatedUserLike | null | undefined,
  claims: AuthClaimsLike,
  now?: number,
):
  | { ok: false; status: number; code: string }
  | {
      ok: true;
      userId: string;
      emailVerified: boolean;
      assuranceLevel: string;
    };
export function isCrossSiteMutation(request: Request): boolean;
export function safeRelativeRedirect(
  candidate: unknown,
  baseOrigin: string,
  blockedPrefix?: string,
): string;
