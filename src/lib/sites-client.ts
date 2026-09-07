import { supabase } from "@/integrations/supabase/client";
export type SiteSummary = {
  id: string;
  title: string;
  slug: string;
  revision: number;
  visibility: "private" | "public";
  published_version_id: string | null;
  publication_id: string | null;
};
export type SiteVersion = {
  id: string;
  manifest_sha256: string;
  size_bytes: number;
  file_count: number;
  created_at: string;
};
export type SiteWorkspace = {
  hostingReady: boolean;
  sites?: SiteSummary[];
  site?: SiteSummary;
  versions?: SiteVersion[];
  viewers?: { viewer_id: string; viewer_label: string }[];
  files?: { path: string; base64: string }[];
  url?: string;
};
export type SiteMutation = {
  action: string;
  siteId: string;
  mutationId?: string;
  revision?: number;
  payload: Record<string, unknown>;
};
export class SiteRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export async function siteRequest(
  userId: string,
  path: string,
  signal: AbortSignal,
  body?: SiteMutation,
): Promise<SiteWorkspace> {
  signal.throwIfAborted();
  const { data, error } = await supabase.auth.getSession();
  signal.throwIfAborted();
  if (error || data.session?.user.id !== userId || !data.session.access_token)
    throw new SiteRequestError(401, "site_session_changed");
  const controller = new AbortController(),
    abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), 45000);
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
    if (!reader) throw new SiteRequestError(503, "site_response_invalid");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > 12 * 1024 * 1024) throw new SiteRequestError(503, "site_response_too_large");
        chunks.push(next.value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes));
    signal.throwIfAborted();
    if (!response.ok)
      throw new SiteRequestError(
        response.status,
        typeof value?.error === "string" ? value.error : "site_request_failed",
      );
    return value;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
export function siteError(error: unknown): string {
  if (error instanceof SiteRequestError) {
    if (error.status === 401) return "Sign in again to continue with this account.";
    if (error.status === 403 || error.status === 404)
      return "This Site is unavailable for your account. Refresh to check your access.";
    if (error.status === 409) return "The Site changed. Refresh before applying another change.";
    if (error.status === 413)
      return "The Site or account reached its storage limit. Retire an unused version and try again.";
    if (error.code === "site_hosting_not_configured")
      return "Private files can be saved. Site hosting is not available yet.";
    if (error.code.includes("file") || error.code.includes("index"))
      return "Check the files. Include index.html, use supported file types and simple paths, and keep the version below 8 MB.";
  }
  return "The request could not be confirmed. Retry the same request or refresh to check the result.";
}
