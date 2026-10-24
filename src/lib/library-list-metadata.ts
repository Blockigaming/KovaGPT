import type { LibraryItem } from "./library.functions";
import { libraryModifiedAt } from "./library-detail";

/** List metadata never substitutes the saved time for a missing modified time. */
export function libraryListMetadata(item: LibraryItem) {
  return {
    filename: item.file_name?.trim() || item.title,
    savedAt: item.created_at,
    modifiedAt: libraryModifiedAt(item.updated_at),
  };
}
