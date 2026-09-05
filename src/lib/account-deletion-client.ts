import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

/** Deletion/status always carry the exact captured principal, including after auth switches. */
export async function requestAccountDeletion(
  ownerId: string,
  method: "GET" | "DELETE",
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
        ...(method === "DELETE" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "DELETE" ? { body: JSON.stringify({ confirmation: "DELETE" }) } : {}),
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
