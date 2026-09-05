import { supabase } from "@/integrations/supabase/client";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";
export async function requestMcpOwner(
  ownerId: string,
  query: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  let abort: () => void = () => {};
  try {
    const result = await Promise.race([
      supabase.auth.getSession(),
      new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Request canceled"));
        if (bounded.aborted) abort();
        else bounded.addEventListener("abort", abort, { once: true });
      }),
    ]);
    const session = result.data.session;
    if (bounded.aborted || session?.user.id !== ownerId || !session.access_token)
      throw new Error("Your signed-in account changed. Reload this page.");
    if (query && !/^\?(request_id|after)=[a-f0-9-]{36}$/u.test(query))
      throw new Error("Invalid connection request.");
    const response = await fetch(`/api/developer/mcp${query}`, {
      method: body ? "POST" : "GET",
      signal: bounded,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "X-Kova-Expected-User": ownerId,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const bytes = await readResponseBytesBounded(response, 256 * 1024, {
      signal: bounded,
      timeoutMs: 15000,
    });
    if (bounded.aborted) throw new Error("Request canceled");
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!response.ok)
      throw new Error(
        typeof value?.error === "string"
          ? value.error.replaceAll("_", " ")
          : "Connection request unavailable.",
      );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid connection response.");
    return value;
  } finally {
    bounded.removeEventListener("abort", abort);
  }
}
export function verifiedMcpRedirect(
  target: string,
  expected: string,
  resource: string,
): string | null {
  try {
    const url = new URL(target),
      base = new URL(target),
      registered = new URL(expected);
    const responseKeys = ["code", "error", "state", "iss"];
    if (
      url.searchParams.getAll("iss").length !== 1 ||
      url.searchParams.get("iss") !== new URL(resource).origin ||
      url.searchParams.getAll("state").length !== 1 ||
      url.searchParams.getAll("code").length + url.searchParams.getAll("error").length !== 1 ||
      responseKeys.some((key) => registered.searchParams.has(key))
    )
      return null;
    for (const key of responseKeys) base.searchParams.delete(key);
    // URLSearchParams normalizes query escaping when the AS adds OAuth fields.
    // Compare the same canonical encoding while preserving every registered pair.
    registered.searchParams.sort();
    base.searchParams.sort();
    return base.href === registered.href ? url.href : null;
  } catch {
    return null;
  }
}
