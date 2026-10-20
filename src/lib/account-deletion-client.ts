import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

export type AccountDeletionStatus = {
  state: "active" | "scheduled" | "finalizing" | "deleted";
  scheduledAt: string | null;
  recoverUntil: string | null;
};

/** Browser state is descriptive only; the server decides the recovery deadline. */
export function parseAccountDeletionStatus(value: unknown): AccountDeletionStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<AccountDeletionStatus>;
  if (row.state === "active" || row.state === "deleted") {
    return row.scheduledAt === null && row.recoverUntil === null
      ? { state: row.state, scheduledAt: null, recoverUntil: null }
      : null;
  }
  if (row.state !== "scheduled" && row.state !== "finalizing") return null;
  if (
    typeof row.scheduledAt !== "string" ||
    row.scheduledAt.length > 64 ||
    typeof row.recoverUntil !== "string" ||
    row.recoverUntil.length > 64
  )
    return null;
  const scheduledAt = Date.parse(row.scheduledAt);
  const recoverUntil = Date.parse(row.recoverUntil);
  if (
    !Number.isFinite(scheduledAt) ||
    !Number.isFinite(recoverUntil) ||
    recoverUntil - scheduledAt !== 30 * 24 * 60 * 60 * 1000
  )
    return null;
  return { state: row.state, scheduledAt: row.scheduledAt, recoverUntil: row.recoverUntil };
}

/** Deletion/status always carry the exact captured principal, including after auth switches. */
export async function requestAccountDeletion(
  ownerId: string,
  method: "GET" | "DELETE" | "PATCH",
  signal?: AbortSignal,
): Promise<Response> {
  const bounded = AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]);
  let onAbort: (() => void) | undefined;
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("account_deletion_request_canceled"));
        if (bounded.aborted) onAbort();
        else bounded.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
    const session = result.data.session;
    if (bounded.aborted || session?.user.id !== ownerId || !session.access_token)
      throw new Error("account_deletion_identity_changed");
    const response = await fetch("/api/account", {
      method,
      signal: bounded,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "X-Kova-Expected-User": ownerId,
        ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "DELETE" ? { body: JSON.stringify({ confirmation: "DELETE" }) } : {}),
      ...(method === "PATCH" ? { body: JSON.stringify({ action: "recover" }) } : {}),
    });
    const bytes = await readResponseBytesBounded(response, 4096, {
      signal: bounded,
      timeoutMs: 15000,
    });
    if (bounded.aborted) throw new Error("account_deletion_request_canceled");
    return new Response(
      response.status === 204 ? null : new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      {
        status: response.status,
        headers: response.headers,
      },
    );
  } finally {
    if (onAbort) bounded.removeEventListener("abort", onAbort);
  }
}
