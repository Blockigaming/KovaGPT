// Browser-side fetch wrapper that attaches the current Supabase access token
// when browser auth is configured. Anonymous/public API calls must still work
// in preview environments where Supabase client env is intentionally absent.
import { supabase, getSupabaseClientConfigStatus } from "@/integrations/supabase/client";

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (getSupabaseClientConfigStatus().configured) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}

/** Authenticated fetch with a bounded wait that also composes a caller signal. */
export async function fetchWithTimeoutAuthenticated(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener("abort", abort, { once: true });
  try {
    return await authFetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener("abort", abort);
  }
}
