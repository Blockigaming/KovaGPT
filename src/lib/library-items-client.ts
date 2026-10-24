import { originalLibraryHeaders } from "./library-original-client";
import { readResponseBytesBounded } from "./endpoint-reliability.mjs";
import type { LibraryItem } from "./library.functions";
import { libraryItemDetailSearch, libraryModifiedAt } from "./library-detail";
export type LibraryPageQuery = {
  query: string;
  sort: string;
  filter: string;
  folder: string;
  favorites: string;
  cursor?: Record<string, unknown> | null;
};
export type LibraryVersion = {
  kind: "original" | "text";
  revision: number;
  generation?: string;
  file_name: string | null;
  file_type: string | null;
  size_bytes: number;
  created_at: string;
  current: boolean;
};
export function libraryItemFromRow(raw: Record<string, unknown>, loaded = false): LibraryItem {
  const { metadata, ...row } = raw;
  const meta =
    metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  return {
    ...row,
    updated_at: libraryModifiedAt(row.updated_at),
    content_text: loaded ? (typeof row.content_text === "string" ? row.content_text : null) : null,
    content_loaded: loaded,
    original_generation:
      meta.file_bucket === "library-files" && typeof meta.storage_generation === "string"
        ? meta.storage_generation
        : undefined,
    work_output: meta.work_output === true,
  } as LibraryItem;
}

export class LibraryItemsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LibraryItemsRequestError";
  }
}
export async function libraryItemsRequest(
  owner: string,
  path: string,
  signal: AbortSignal,
  body?: Record<string, unknown>,
) {
  // Only a query suffix is accepted; a path cannot redirect owner credentials
  // into another API or an external destination.
  if (path !== "" && (!path.startsWith("?") || path.includes("#")))
    throw new Error("Invalid Library request destination.");
  const current = AbortSignal.any([signal, AbortSignal.timeout(25000)]);
  current.throwIfAborted();
  const headers = await originalLibraryHeaders(owner, current);
  current.throwIfAborted();
  const response = await fetch(`/api/library/items${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    credentials: "same-origin",
    mode: "same-origin",
    redirect: "error",
    cache: "no-store",
    signal: current,
  });
  const bytes = await readResponseBytesBounded(response, 2_000_000, {
    signal: current,
    timeoutMs: 15000,
  });
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!response.ok)
    throw new LibraryItemsRequestError(
      typeof value.error === "string" ? value.error : "Library could not be loaded.",
      response.status,
    );
  current.throwIfAborted();
  return value;
}
export async function listLibraryPage(
  owner: string,
  query: LibraryPageQuery,
  signal: AbortSignal,
): Promise<{ items: LibraryItem[]; cursor: Record<string, unknown> | null }> {
  const value = await libraryItemsRequest(owner, "", signal, {
    operation: "list",
    ...query,
    cursor: query.cursor ? JSON.stringify(query.cursor) : null,
  });
  if (!Array.isArray(value.items) || value.items.length > 50)
    throw new Error("The Library page was invalid.");
  return {
    items: value.items.map((row: Record<string, unknown>) => libraryItemFromRow(row)),
    cursor: value.cursor,
  };
}
export async function readLibraryItem(
  owner: string,
  item: LibraryItem,
  signal: AbortSignal,
): Promise<LibraryItem> {
  const value = await readLibraryItemAtGeneration(owner, item, signal);
  if (value.content_revision !== item.content_revision)
    throw new Error("This item changed. Refresh Library to open its current version.");
  return value;
}

/** Item links open the current revision of the exact original item generation. */
export async function readLibraryItemAtGeneration(
  owner: string,
  item: Pick<LibraryItem, "id" | "content_generation">,
  signal: AbortSignal,
): Promise<LibraryItem> {
  if (!item.content_generation) throw new Error("Refresh Library before opening this item.");
  if (!libraryItemDetailSearch(item)) throw new Error("This Library link is invalid.");
  const value = await libraryItemsRequest(
    owner,
    `?id=${encodeURIComponent(item.id)}&generation=${encodeURIComponent(item.content_generation)}`,
    signal,
  );
  if (
    value.id !== item.id ||
    value.content_generation !== item.content_generation ||
    !Number.isSafeInteger(value.content_revision) ||
    value.content_revision < 1 ||
    value.content_revision > 1000000
  )
    throw new Error("This item changed. Refresh Library to open its current version.");
  return libraryItemFromRow(value, true);
}
