import { PUBLIC_BACKEND_URL } from "@/config/public-config";

/**
 * Resolve the backend URL for server routes.
 *
 * Production bundles do not always carry build-time public variables (local
 * environment files are not committed), so fall back to the server runtime
 * variable and finally to the committed publishable URL. Without this the
 * email pipeline returned "Server configuration error" and no auth emails
 * were ever sent.
 */
export function resolveBackendUrl(): string {
  const runtime = typeof process !== "undefined" && process.env ? process.env : {};
  return (
    runtime["SUPABASE_URL"] ||
    (import.meta.env.VITE_SUPABASE_URL as string | undefined) ||
    PUBLIC_BACKEND_URL
  );
}
