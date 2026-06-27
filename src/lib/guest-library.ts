// Guest (signed-out) library storage. Uses localStorage so saved chat
// responses, uploads, and generated images persist across refreshes in the
// same browser. Signed-in users use the server-backed library instead.
import type { LibraryItem } from "@/lib/library.functions";

export const GUEST_LIBRARY_KEY = "kova-guest-library";
const MAX_ITEMS = 200;
// Per-image cap so a few large data URLs can't blow past the ~5MB
// localStorage quota and start throwing on save.
const MAX_DATA_URL_BYTES = 1_500_000;

export type GuestSaveInput = {
  title: string;
  item_type: LibraryItem["item_type"];
  source: LibraryItem["source"];
  content_text?: string | null;
  file_url?: string | null;
  file_name?: string | null;
  file_type?: string | null;
  file_size?: number | null;
};

export function loadGuestLibrary(): LibraryItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(GUEST_LIBRARY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function writeGuestLibrary(items: LibraryItem[]) {
  try {
    localStorage.setItem(GUEST_LIBRARY_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // Quota exceeded: trim aggressively and try once more.
    try {
      localStorage.setItem(GUEST_LIBRARY_KEY, JSON.stringify(items.slice(0, 50)));
    } catch {
      /* ignore */
    }
  }
}

export function saveGuestItem(input: GuestSaveInput): LibraryItem {
  const fileUrl =
    input.file_url && input.file_url.length > MAX_DATA_URL_BYTES ? null : input.file_url ?? null;
  const item: LibraryItem = {
    id: `guest-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: input.title.slice(0, 200),
    item_type: input.item_type,
    source: input.source,
    content_text: input.content_text?.slice(0, 100_000) ?? null,
    file_url: fileUrl,
    file_name: input.file_name ?? null,
    file_type: input.file_type ?? null,
    file_size: input.file_size ?? null,
    created_at: new Date().toISOString(),
  };
  const next = [item, ...loadGuestLibrary()];
  writeGuestLibrary(next);
  return item;
}

export function deleteGuestItem(id: string) {
  writeGuestLibrary(loadGuestLibrary().filter((i) => i.id !== id));
}
