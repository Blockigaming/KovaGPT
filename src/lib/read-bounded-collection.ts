import { z } from "zod";
export type CollectionPage<T> = { items: T[]; cursor: string | null };
export const CollectionPageInput = z.object({ cursor: z.string().uuid().nullable().default(null) });
/** Exactly one keyset request. A nonempty page always offers continuation,
 * including under a lower server row cap; an empty page marks the end. No
 * full-table count or automatic traversal. Validate before exposing a page. */
export async function readCollectionPage<T extends { id: string }>(
  read: (
    signal: AbortSignal,
  ) => PromiseLike<{ data: T[] | null; count?: number | null; error: unknown }>,
  label: string,
  after: string | null,
  maxRows: number,
  signal: AbortSignal = AbortSignal.timeout(15000),
): Promise<CollectionPage<T>> {
  signal.throwIfAborted();
  const result = await read(signal);
  signal.throwIfAborted();
  if (result.error || !Array.isArray(result.data) || result.data.length > maxRows)
    throw new Error(`${label} page could not be loaded. Retry this page.`);
  let previous = after;
  for (const row of result.data) {
    if (typeof row?.id !== "string" || !row.id || (previous !== null && row.id <= previous))
      throw new Error(`${label} returned an invalid page. Refresh to try again.`);
    previous = row.id;
  }
  if (new TextEncoder().encode(JSON.stringify(result.data)).byteLength > 2_000_000)
    throw new Error(
      `${label} page exceeds the supported response bounds. No partial page was returned.`,
    );
  return { items: result.data, cursor: result.data.length ? previous : null };
}
