import type { LibraryItem } from "./library.functions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type LibraryDetailSearch = {
  item?: string;
  generation?: string;
  invalidDetail?: true;
};

export function validateLibraryDetailSearch(raw: Record<string, unknown>): LibraryDetailSearch {
  if (raw.item === undefined && raw.generation === undefined) return {};
  if (
    typeof raw.item !== "string" ||
    typeof raw.generation !== "string" ||
    !UUID.test(raw.item) ||
    !UUID.test(raw.generation)
  )
    return { invalidDetail: true };
  return { item: raw.item.toLowerCase(), generation: raw.generation.toLowerCase() };
}

export function libraryItemDetailSearch(
  item: Pick<LibraryItem, "id" | "content_generation">,
): LibraryDetailSearch | null {
  const search = validateLibraryDetailSearch({
    item: item.id,
    generation: item.content_generation,
  });
  return search.invalidDetail || !search.item ? null : search;
}

export function libraryDetailKey(search: LibraryDetailSearch): string | null {
  if (search.invalidDetail) return "invalid";
  return search.item && search.generation ? `${search.item}:${search.generation}` : null;
}

// An authenticated, generation-stable item address, not a bearer share or revision snapshot.
// Only identity goes into the URL; list queries, titles, content and tokens never do.
export function libraryItemDetailPath(item: Pick<LibraryItem, "id" | "content_generation">) {
  const search = libraryItemDetailSearch(item);
  return search
    ? `/library?item=${encodeURIComponent(search.item!)}&generation=${encodeURIComponent(search.generation!)}`
    : null;
}

export function libraryModifiedAt(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/iu.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}
