import { safeImageUrl } from "./safe-image-url";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const RASTER_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type ChatImageAttachmentHandler = (file: File, isCurrent: () => boolean) => Promise<void>;
export type ChatImageAttachmentRequest = { accept: (handler: ChatImageAttachmentHandler) => void };

/** Capture the current composer's own guarded file handler before any image read. */
export function prepareChatImageAttachment(
  principal: string,
  chatId: string,
): ChatImageAttachmentHandler {
  const boxes = document.querySelectorAll<HTMLElement>("[data-chat-image-context]");
  const target = Array.from(boxes).find((box) => {
    if (!box.getClientRects().length) return false;
    try {
      const context = JSON.parse(box.getAttribute("data-chat-image-context") ?? "null");
      return Array.isArray(context) && context[0] === principal && context[1] === chatId;
    } catch {
      return false;
    }
  });
  if (!target) throw new Error("Open this chat's message box before adding the image.");
  let attach: ChatImageAttachmentHandler | undefined;
  target.dispatchEvent(
    new CustomEvent<ChatImageAttachmentRequest>("kova:prepare-chat-image-attachment", {
      bubbles: true,
      detail: {
        accept: (handler) => {
          attach ??= handler;
        },
      },
    }),
  );
  if (!attach) throw new Error("The message box is not ready. Try again.");
  return attach;
}

export function chatImageUrl(src: string): string {
  const safe = safeImageUrl(src);
  if (!safe) throw new Error("This image is unavailable.");
  const parsed = new URL(safe, window.location.origin);
  if (parsed.username || parsed.password) throw new Error("This image is unavailable.");
  return safe;
}

/** A bounded marker, never an image payload or a signed URL in browser preferences. */
export function chatImageFingerprint(src: string): string {
  let first = 2166136261;
  let second = 5381;
  for (let i = 0; i < src.length; i++) {
    first = Math.imul(first ^ src.charCodeAt(i), 16777619);
    second = Math.imul(second, 33) ^ src.charCodeAt(i);
  }
  return `${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}-${src.length}`;
}

function current(allowed: () => boolean) {
  if (!allowed()) throw new DOMException("The image action was cancelled.", "AbortError");
}

function inlineImageBlob(src: string): Blob {
  const [header, encoded] = src.split(",", 2);
  const declared = header.slice(5).split(";", 1)[0].toLowerCase();
  const type = declared === "image/jpg" ? "image/jpeg" : declared;
  if (!RASTER_TYPES.has(type)) throw new Error("This image format is not supported.");
  const bytes = Uint8Array.from(atob(encoded), (value) => value.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    throw new Error("This image is empty or larger than 8 MB.");
  return new Blob([bytes], { type });
}

export async function readChatImage(src: string, allowed: () => boolean): Promise<Blob> {
  current(allowed);
  const safe = chatImageUrl(src);
  // Inline images are already local. Decoding them does not require connect-src data:.
  if (safe.startsWith("data:")) return inlineImageBlob(safe);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(safe, {
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Could not read this image. Try opening it in a new tab.");
    const declared = (response.headers.get("content-type") ?? "").split(";", 1)[0].toLowerCase();
    const type = declared === "image/jpg" ? "image/jpeg" : declared;
    if (!RASTER_TYPES.has(type)) throw new Error("This image format is not supported.");
    if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES)
      throw new Error("This image is larger than 8 MB.");
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Could not read this image.");
    try {
      for (;;) {
        const next = await reader.read();
        current(allowed);
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_IMAGE_BYTES) throw new Error("This image is larger than 8 MB.");
        parts.push(new Uint8Array(next.value));
      }
    } catch (error) {
      void reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    if (!size) throw new Error("This image is empty.");
    current(allowed);
    return new Blob(parts, { type });
  } finally {
    clearTimeout(timer);
  }
}

async function imageCanvas(blob: Blob, maximumEdge: number): Promise<HTMLCanvasElement> {
  const image = new Image();
  const url = URL.createObjectURL(blob);
  try {
    image.src = url;
    await image.decode();
    if (
      !image.naturalWidth ||
      !image.naturalHeight ||
      image.naturalWidth * image.naturalHeight > 16_777_216
    )
      throw new Error("This image is too large to copy or attach.");
    const scale = Math.min(1, maximumEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const pngBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not prepare the image."))),
      "image/png",
    ),
  );

export function copyChatImage(src: string, allowed: () => boolean): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write)
    return Promise.reject(
      new Error("Image copying is unavailable in this browser. Download a copy instead."),
    );
  // Start the clipboard write in the user's gesture, including on Safari.
  const image = readChatImage(src, allowed).then(async (blob) => {
    const png = blob.type === "image/png" ? blob : await pngBlob(await imageCanvas(blob, 4096));
    current(allowed);
    return png;
  });
  // A denied clipboard write can reject before the image promise settles.
  void image.catch(() => {});
  return navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
}

export async function chatImageFile(src: string, allowed: () => boolean): Promise<File> {
  let blob = await readChatImage(src, allowed);
  if (blob.size > MAX_ATTACHMENT_BYTES) {
    const canvas = await imageCanvas(blob, 2048);
    blob = await pngBlob(canvas);
    while (blob.size > MAX_ATTACHMENT_BYTES && Math.max(canvas.width, canvas.height) > 768) {
      const smaller = document.createElement("canvas");
      smaller.width = Math.max(1, Math.floor(canvas.width * 0.7));
      smaller.height = Math.max(1, Math.floor(canvas.height * 0.7));
      const context = smaller.getContext("2d");
      if (!context) throw new Error("Could not prepare the image.");
      context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas.width = smaller.width;
      canvas.height = smaller.height;
      canvas.getContext("2d")!.drawImage(smaller, 0, 0);
      blob = await pngBlob(canvas);
    }
  }
  current(allowed);
  if (blob.size > MAX_ATTACHMENT_BYTES)
    throw new Error("Could not fit this image into a chat attachment.");
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.slice(6);
  return new File([blob], `kova-image-${chatImageFingerprint(src)}.${extension}`, {
    type: blob.type,
  });
}

function clickImageLink(href: string, download?: string) {
  const link = document.createElement("a");
  link.href = href;
  link.rel = "noopener noreferrer";
  if (download) link.download = download;
  else link.target = "_blank";
  document.body.append(link);
  link.click();
  link.remove();
}

export async function downloadChatImage(src: string, allowed: () => boolean) {
  const blob = await readChatImage(src, allowed);
  current(allowed);
  const url = URL.createObjectURL(blob);
  const extension = blob.type === "image/jpeg" ? "jpg" : blob.type.slice(6);
  clickImageLink(url, `kova-image.${extension}`);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function openChatImage(src: string) {
  const safe = chatImageUrl(src);
  if (!safe.startsWith("data:")) {
    clickImageLink(safe);
    return;
  }
  // Browsers reject top-level data: navigation. A local raster blob opens normally.
  const url = URL.createObjectURL(inlineImageBlob(safe));
  clickImageLink(url);
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
}
