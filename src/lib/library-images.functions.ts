import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "library-images";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

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
    return { bytes, contentType };
  } catch {
    return null;
  }
}

// Allowlisted hosts the library can save images from. These are the only
// domains we expect (AI gateway CDN, Supabase storage, OpenAI image CDN).
// User-supplied URLs to anything else are rejected to prevent SSRF against
// internal/cloud-metadata endpoints.
const ALLOWED_IMAGE_HOST_SUFFIXES = [
  ".lovable.dev",
  ".lovable.app",
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

async function fetchRemoteImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null; // require TLS
    if (!isHostAllowed(u.hostname)) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!/^image\//i.test(contentType)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return null;
    return { bytes: buf, contentType };
  } catch {
    return null;
  }
}

const SaveImageSchema = z.object({
  imageUrl: z.string().min(1).max(2_500_000), // allow inline base64
  title: z.string().trim().min(1).max(200),
  prompt: z.string().max(2000).optional(),
});

export const saveImageToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SaveImageSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    let payload: { bytes: Uint8Array; contentType: string } | null = null;
    if (data.imageUrl.startsWith("data:")) {
      payload = decodeDataUrl(data.imageUrl);
    } else {
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
      throw new Error(error?.message ?? "Failed to save");
    }
    return { id: row.id };
  });

export const getLibraryImageUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
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
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { data: row } = await context.supabase
      .from("user_library_items")
      .select("file_url, item_type")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .single();
    if (row?.item_type === "image" && row.file_url) {
      await context.supabase.storage.from(BUCKET).remove([row.file_url]);
    }
    const { error } = await context.supabase
      .from("user_library_items")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
