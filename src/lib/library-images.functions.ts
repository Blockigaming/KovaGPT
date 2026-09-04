import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertLockdownAllows } from "@/lib/lockdown-policy.mjs";
import { removePrivateLibraryImage } from "@/lib/library-storage-policy";
import { MAX_SAFE_IMAGE_DATA_URL_CHARS } from "@/lib/safe-image-url";
import { z } from "zod";

const BUCKET = "library-images";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const SAFE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

function hasImageSignature(bytes: Uint8Array, contentType: string): boolean {
  if (contentType === "image/png")
    return (
      bytes.length > 8 &&
      bytes.slice(0, 8).every((byte, index) => byte === [137, 80, 78, 71, 13, 10, 26, 10][index])
    );
  if (contentType === "image/jpeg" || contentType === "image/jpg")
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/gif")
    return (
      bytes.length > 6 && new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/) !== null
    );
  if (contentType === "image/webp")
    return (
      bytes.length > 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}

function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; contentType: string } | null {
  const m = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const contentType = m[1];
  if (!/^image\/(png|jpeg|jpg|webp|gif)$/i.test(contentType)) return null;
  try {
    const b64 = m[2];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return hasImageSignature(bytes, contentType.toLowerCase())
      ? { bytes, contentType: contentType.toLowerCase() }
      : null;
  } catch {
    return null;
  }
}

// Allowlisted hosts the library can save images from. These are the only
// domains we expect (Supabase storage and direct provider image CDNs).
// User-supplied URLs to anything else are rejected to prevent SSRF against
// internal/cloud-metadata endpoints.
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  ".supabase.co",
  ".supabase.in",
  ".oaiusercontent.com",
  ".openai.com",
  ".googleusercontent.com",
];

function isHostAllowed(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h)) return false; // raw IPv4 - reject
  if (h.includes(":")) return false; // raw IPv6 - reject
  return ALLOWED_IMAGE_HOST_SUFFIXES.some((s) => h === s.slice(1) || h.endsWith(s));
}

async function fetchRemoteImage(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    let current = new URL(url);
    if (current.protocol !== "https:") return null;
    if (!isHostAllowed(current.hostname)) return null;

    // Follow redirects manually so every hop's host is re-validated against
    // the allowlist. An open redirect on an allowed host must not be able to
    // send the fetch to an unvalidated destination (e.g. an internal IP).
    const MAX_HOPS = 3;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      res = await fetch(current.toString(), {
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      // 3xx with a Location header: validate the next hop before following.
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return null;
        let next: URL;
        try {
          next = new URL(loc, current);
        } catch {
          return null;
        }
        if (next.protocol !== "https:") return null;
        if (!isHostAllowed(next.hostname)) return null;
        current = next;
        continue;
      }
      break;
    }
    if (!res || !res.ok) return null;
    const contentType = (res.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(contentType)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return hasImageSignature(buf, contentType) ? { bytes: buf, contentType } : null;
  } catch {
    return null;
  }
}

const SaveImageSchema = z.object({
  imageUrl: z.string().min(1).max(MAX_SAFE_IMAGE_DATA_URL_CHARS),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().max(2000).optional(),
});

export const saveImageToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveImageSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    let payload: ReturnType<typeof decodeDataUrl>;
    if (data.imageUrl.startsWith("data:")) {
      payload = decodeDataUrl(data.imageUrl);
    } else {
      await assertLockdownAllows(context.supabase, context.userId, "remote_download");
      payload = await fetchRemoteImage(data.imageUrl);
    }
    if (!payload) throw new Error("Unsupported or invalid image");
    if (payload.bytes.byteLength > MAX_BYTES) throw new Error("Image too large");

    const ext =
      payload.contentType === "image/png"
        ? "png"
        : payload.contentType === "image/webp"
          ? "webp"
          : payload.contentType === "image/gif"
            ? "gif"
            : "jpg";
    const fileName = `${crypto.randomUUID()}.${ext}`;
    const path = `${context.userId}/${fileName}`;

    const { error: upErr } = await context.supabase.storage
      .from(BUCKET)
      .upload(path, payload.bytes, { contentType: payload.contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: row, error } = await context.supabase
      .from("user_library_items")
      .insert({
        user_id: context.userId,
        title: data.title.slice(0, 200),
        item_type: "image",
        source: "images",
        content_text: data.prompt ?? null,
        file_url: path,
        file_name: fileName,
        file_type: payload.contentType,
        file_size: payload.bytes.byteLength,
      })
      .select("id")
      .single();

    if (error || !row) {
      // best-effort cleanup of orphan upload
      await context.supabase.storage.from(BUCKET).remove([path]);
      {
        console.error("[serverfn]", error?.message);
        throw new Error("Failed to save");
      }
    }
    return { id: row.id };
  });

export const getLibraryImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ url: string }> => {
    const { data: row, error } = await context.supabase
      .from("user_library_items")
      .select("file_url, user_id, item_type")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (error || !row || row.item_type !== "image" || !row.file_url) {
      throw new Error("Image not found");
    }
    const { data: signed, error: sErr } = await context.supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.file_url, 60);
    if (sErr || !signed?.signedUrl) throw new Error("Could not sign URL");
    return { url: signed.signedUrl };
  });

export const deleteLibraryImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: row, error: lookupError } = await context.supabase
      .from("user_library_items")
      .select("file_url, item_type")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (lookupError) {
      console.error("[serverfn]", lookupError.message);
      throw new Error("Request failed. Please try again.");
    }
    if (row?.item_type === "image" && row.file_url) {
      await removePrivateLibraryImage(row.file_url, (paths) =>
        context.supabase.storage.from(BUCKET).remove(paths),
      );
    }
    const { error } = await context.supabase
      .from("user_library_items")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) {
      console.error("[serverfn]", error.message);
      throw new Error("Request failed. Please try again.");
    }
    return { ok: true };
  });
