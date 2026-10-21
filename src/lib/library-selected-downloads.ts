import type { LibraryItem } from "@/lib/library.functions";
import { isPrivateLibraryImagePath, resolveLibraryImageUrl } from "@/lib/library-image-url";
import { safeImageUrl } from "@/lib/safe-image-url";
import { safeNavigationUrl } from "@/lib/safe-url";
import { readResponseBytesBounded } from "@/lib/endpoint-reliability.mjs";

export const SELECTED_LIBRARY_DOWNLOAD_LIMIT = 20;
const FILE_MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IMAGE_MIME = /^image\/(?:png|jpe?g|webp|gif)$/iu;

type DownloadReference = Pick<
  LibraryItem,
  | "id"
  | "title"
  | "file_name"
  | "file_url"
  | "file_type"
  | "item_type"
  | "file_size"
  | "content_generation"
  | "original_generation"
  | "work_output"
>;
export type SelectedLibraryDownload = {
  item: DownloadReference;
  kind: "original" | "work" | "image" | null;
  reason: string | null;
};
export type SelectedLibraryDownloads = {
  count: number;
  overLimit: boolean;
  entries: SelectedLibraryDownload[];
  eligibleCount: number;
  unsupportedCount: number;
};

/** Capture metadata, not mutable selection or full extracted text, and never truncate a selection. */
export function selectedLibraryDownloadSnapshot(
  selected: readonly string[],
  items: readonly LibraryItem[],
  owner: string | null,
): SelectedLibraryDownloads {
  const ids = [...new Set(selected)];
  if (ids.length > SELECTED_LIBRARY_DOWNLOAD_LIMIT)
    return {
      count: ids.length,
      overLimit: true,
      entries: [],
      eligibleCount: 0,
      unsupportedCount: 0,
    };
  const entries = ids.map((id): SelectedLibraryDownload => {
    const source = items.find((item) => item.id === id);
    if (!source)
      return {
        item: {
          id,
          title: "Unavailable item",
          file_name: null,
          file_url: null,
          file_type: null,
          item_type: "other",
          file_size: null,
        },
        kind: null,
        reason: "This item is no longer loaded. Close and refresh Library before trying again.",
      };
    const {
      title,
      file_name,
      file_url,
      file_type,
      item_type,
      file_size,
      content_generation,
      original_generation,
      work_output,
    } = source;
    const item = {
      id,
      title,
      file_name,
      file_url,
      file_type,
      item_type,
      file_size,
      content_generation,
      original_generation,
      work_output,
    };
    const image = Boolean(file_url && (item_type === "image" || file_type?.startsWith("image/")));
    const durable = UUID.test(id);
    let kind: SelectedLibraryDownload["kind"] = original_generation
      ? "original"
      : work_output
        ? "work"
        : image && (isPrivateLibraryImagePath(file_url) || safeImageUrl(file_url))
          ? "image"
          : null;
    let reason: string | null = null;
    if (kind && durable && (!owner || !UUID.test(content_generation ?? ""))) {
      kind = null;
      reason = "Refresh Library while signed in before downloading this saved file.";
    } else if (
      (kind === "original" || kind === "work" || isPrivateLibraryImagePath(file_url)) &&
      (!durable || !owner)
    ) {
      kind = null;
      reason = "Sign in and refresh Library before downloading this saved file.";
    } else if (kind === "original" && !UUID.test(original_generation ?? "")) {
      kind = null;
      reason = "Refresh Library before downloading this original file.";
    }
    if (
      kind &&
      typeof file_size === "number" &&
      file_size > (kind === "image" ? IMAGE_MAX_BYTES : FILE_MAX_BYTES)
    ) {
      kind = null;
      reason =
        "This file exceeds the selected-download size limit. Use its individual Actions menu.";
    }
    if (!kind && !reason)
      reason = safeNavigationUrl(file_url)
        ? "Use Actions → Open or download for this linked file. It has no verified stored-file download here."
        : "Preview or Reuse in chat is available. This item has no stored file to download.";
    return { item, kind, reason };
  });
  const eligibleCount = entries.filter((entry) => entry.kind !== null).length;
  return {
    count: ids.length,
    overLimit: false,
    entries,
    eligibleCount,
    unsupportedCount: entries.length - eligibleCount,
  };
}

/** Match Work's private-link/HTTPS rules; never send cookies to another origin. */
export function selectedDownloadUrl(value: unknown, origin: string, kind: "work" | "image") {
  if (typeof value !== "string") throw new Error("The file URL is unavailable.");
  if (kind === "image" && value.startsWith("data:") && safeImageUrl(value)) return value;
  const url = new URL(value, origin);
  const owned = value.startsWith("/");
  if (!owned && !/^https:\/\//iu.test(value))
    throw new Error("The file URL is invalid. Refresh Library before trying again.");
  const localOwned =
    owned &&
    url.origin === origin &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!localOwned && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.hash ||
    (owned &&
      (value.startsWith("//") ||
        url.origin !== origin ||
        url.pathname !== (kind === "work" ? "/api/private-files" : "/api/library/files")))
  )
    throw new Error("The file URL is invalid. Refresh Library before trying again.");
  return url.toString();
}

/** Resolve one captured file only. No batch fetch, automatic retry, or retained Blob cache. */
export async function readSelectedLibraryDownload(
  owner: string | null,
  entry: SelectedLibraryDownload,
  signal: AbortSignal,
  isCurrent: () => boolean,
): Promise<Blob> {
  const current = AbortSignal.any([signal, AbortSignal.timeout(50_000)]);
  const check = () => {
    current.throwIfAborted();
    if (!isCurrent()) throw new DOMException("The download was canceled.", "AbortError");
  };
  check();
  const { item, kind } = entry;
  if (!kind) throw new Error(entry.reason ?? "This item has no downloadable file.");
  if (UUID.test(item.id)) {
    if (!owner) throw new Error("Sign in before downloading this file.");
    const { readLibraryItemAtGeneration } = await import("@/lib/library-items-client");
    check();
    const fresh = await readLibraryItemAtGeneration(owner, item, current);
    check();
    if (
      fresh.original_generation !== item.original_generation ||
      fresh.work_output !== item.work_output ||
      fresh.file_url !== item.file_url
    )
      throw new Error("This file changed. Close and refresh Library before downloading it.");
  }
  if (kind === "original") {
    const { readOriginalLibraryFile } = await import("@/lib/library-original-client");
    check();
    const blob = await readOriginalLibraryFile(owner!, item.id, item.original_generation!, current);
    check();
    return blob;
  }
  let target: unknown;
  if (kind === "work") {
    const { requestWorkSync } = await import("@/lib/work-sync-client");
    check();
    const result = await requestWorkSync(
      owner!,
      `/api/work/output?id=${encodeURIComponent(item.id)}`,
      current,
    );
    check();
    target = (result as { url?: unknown })?.url;
  } else {
    target = await resolveLibraryImageUrl(item, async (id) => {
      const { getLibraryImageUrl } = await import("@/lib/library-images.functions");
      check();
      const result = await getLibraryImageUrl({ data: { id } });
      check();
      return result;
    });
  }
  check();
  const url = selectedDownloadUrl(target, window.location.origin, kind);
  const response = await fetch(url, {
    signal: current,
    credentials: new URL(url).origin === window.location.origin ? "same-origin" : "omit",
    redirect: "error",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("This file is unavailable or access has changed. Close and refresh Library.");
  }
  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (kind === "image" && !IMAGE_MIME.test(mime)) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error("The image response was invalid. Refresh Library before trying again.");
  }
  const bytes = await readResponseBytesBounded(
    response,
    kind === "image" ? IMAGE_MAX_BYTES : FILE_MAX_BYTES,
    { signal: current, timeoutMs: 15000 },
  );
  check();
  return new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" });
}

/** A browser handoff is a start receipt, never proof that the user saved the file. */
export async function startSelectedLibraryDownload(
  owner: string | null,
  entry: SelectedLibraryDownload,
  signal: AbortSignal,
  isCurrent: () => boolean,
) {
  const blob = await readSelectedLibraryDownload(owner, entry, signal, isCurrent);
  signal.throwIfAborted();
  if (!isCurrent()) throw new DOMException("The download was canceled.", "AbortError");
  const anchor = document.createElement("a");
  const url = URL.createObjectURL(blob);
  try {
    anchor.href = url;
    anchor.download = (entry.item.file_name || entry.item.title || "Library file")
      .replace(/[\\/\p{Cc}]/gu, "_")
      .slice(0, 240);
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    // Keep just this one Blob alive for browser consumption; Close aborts the delay immediately.
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, 1000);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) finish();
    });
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
