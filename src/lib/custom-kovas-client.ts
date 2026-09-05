import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import { fetchForPrincipal } from "./chat-summary-snapshot.mjs";
import type { KovaConfig } from "./custom-kovas-policy.mjs";
export type KovaCard = {
  id: string;
  owned: boolean;
  revision: number;
  visibility: "private" | "link" | "public";
  blocked: boolean;
  version_id: string;
  config: Omit<KovaConfig, "instructions" | "knowledge">;
};
export type KovaView = {
  id: string;
  owned: boolean;
  revision: number;
  visibility: KovaCard["visibility"];
  blocked: boolean;
  versionId: string;
  publicationVersion: string | null;
  config: KovaConfig;
  knowledge: { title: string; content?: string; characters?: number }[];
};
export type KovaVersion = { id: string; version: number; created_at: string; size_bytes: number };
export async function requestKovas<T>(
  ownerId: string | null,
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await fetchForPrincipal(ownerId, path, {
    signal: combined,
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const bytes = await readResponseBytesBounded(response, 600000, {
    signal: combined,
    timeoutMs: 15000,
  });
  if (combined.aborted) throw new DOMException("Canceled", "AbortError");
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!response.ok)
    throw Object.assign(
      new Error(
        response.status === 409
          ? "This Kova changed. Refresh before retrying."
          : response.status === 413
            ? "This Kova exceeds a version, knowledge, or account storage limit. Remove older versions or reduce its knowledge."
            : response.status === 403
              ? "This Kova or action is unavailable for this account."
              : response.status === 401
                ? "Sign in to continue."
                : "Kovas are unavailable. Your draft remains here.",
      ),
      { status: response.status },
    );
  return data as T;
}
export function newKovaLinkToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
