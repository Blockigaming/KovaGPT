import { supabase } from "@/integrations/supabase/client";
export type OrganizationRole = "owner" | "admin" | "member";
export type OrganizationSummary = {
  id: string;
  name: string;
  revision: number;
  role: OrganizationRole;
};
export type OrganizationInvitation = {
  id: string;
  organization_id: string;
  name: string;
  revision: number;
  role: OrganizationRole;
  expires_at: string;
  recipient_user_id?: string;
};
export type OrganizationWorkspace = {
  available: boolean;
  canClose: boolean;
  retentionEnforced: false;
  organizations?: OrganizationSummary[];
  invitations?: OrganizationInvitation[];
  organization?: OrganizationSummary & { retentionDaysDraft: number | null; policyVersion: string };
  members?: { user_id: string; role: OrganizationRole; joined_at: string }[];
  pendingInvitations?: OrganizationInvitation[];
  domains?: {
    id: string;
    domain: string;
    state: string;
    challenge_token: string;
    verification_expires_at: string | null;
  }[];
  sso?: { state: string; domainId: string; verified: boolean } | null;
};
export type OrganizationMutation = {
  action: string;
  organizationId: string;
  expectedRevision: number;
  mutationId: string;
  payload: Record<string, unknown>;
};
export class OrganizationRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function organizationRequest<T>(
  userId: string,
  path: string,
  signal: AbortSignal,
  body?: OrganizationMutation | Record<string, unknown>,
): Promise<T> {
  signal.throwIfAborted();
  const { data, error } = await supabase.auth.getSession();
  signal.throwIfAborted();
  if (error || data.session?.user.id !== userId || !data.session.access_token)
    throw new OrganizationRequestError(401, "organization_session_changed");
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    15_000,
  );
  try {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${data.session.access_token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new OrganizationRequestError(503, "organization_response_invalid");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 1_048_576)
          throw new OrganizationRequestError(503, "organization_response_too_large");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const result = JSON.parse(new TextDecoder().decode(bytes));
    if (!response.ok)
      throw new OrganizationRequestError(
        response.status,
        typeof result?.error === "string" ? result.error : "organization_request_failed",
      );
    signal.throwIfAborted();
    return result as T;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export function organizationErrorMessage(error: unknown): string {
  if (error instanceof OrganizationRequestError) {
    if (error.status === 401) return "Sign in again to continue with this account.";
    if (error.status === 403)
      return "You no longer have permission for this action. Refresh the organization.";
    if (error.code === "organization_last_owner")
      return "Add another owner before removing or changing the last owner.";
    if (error.code === "organization_closure_policy_not_active")
      return "Organization closure is awaiting an approved retention policy.";
    if (error.code.includes("sso_not_configured"))
      return "The SSO provider has not been configured for this organization and domain.";
    if (error.code.includes("domain_proof"))
      return "The matching DNS verification record was not found. Check the record and try again.";
    if (error.code.includes("dns_"))
      return "DNS verification is temporarily unavailable. Try again.";
    if (error.status === 409)
      return "The organization changed or reached a limit. Refresh before trying again.";
    if (error.status === 400)
      return "Check the information. Invitations require an existing account with a verified email.";
  }
  return "The request could not be confirmed. Retry the same request or refresh to check its result.";
}
