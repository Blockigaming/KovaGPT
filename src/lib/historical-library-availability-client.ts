import { supabase } from "@/integrations/supabase/client";
import { originalLibraryHeaders } from "./library-original-client";
import type { HistoricalLibraryAvailability } from "./historical-library-availability";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

/** Existing owner-RLS exact identity read, not the generation-specific detail API. */
export async function readHistoricalLibraryAvailability(
  owner: string,
  id: string,
  signal: AbortSignal,
): Promise<Exclude<HistoricalLibraryAvailability, "loading">> {
  if (!UUID.test(owner) || !UUID.test(id)) return "unknown";
  const current = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  try {
    const headers = await originalLibraryHeaders(owner, current);
    current.throwIfAborted();
    const result = await supabase
      .from("user_library_items")
      .select("id,user_id")
      .eq("user_id", owner)
      .eq("id", id)
      .abortSignal(current)
      .maybeSingle()
      // Pin this read to the checked session, even if the global client changes
      // accounts before its fetch starts. Nothing is persisted or configured.
      .setHeader("Authorization", headers.Authorization);
    current.throwIfAborted();
    if (
      result.error !== null ||
      !Number.isInteger(result.status) ||
      result.status < 200 ||
      result.status >= 300
    )
      return "unknown";
    await originalLibraryHeaders(owner, current);
    current.throwIfAborted();
    if (result.data === null) return "unavailable";
    if (result.data?.id === id && result.data.user_id === owner) return "available";
    return "unknown";
  } catch {
    // Invalid/revoked auth, timeouts, network errors and malformed results say
    // nothing about deletion. Only a successful exact read can confirm absence.
    return "unknown";
  }
}
