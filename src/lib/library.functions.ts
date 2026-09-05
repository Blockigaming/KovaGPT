import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { removePrivateLibraryImage } from "@/lib/library-storage-policy";
import { z } from "zod";
import {
  assertLibrarySaveReplay,
  librarySaveFingerprint,
} from "@/lib/library-save-idempotency.mjs";

export type LibraryItem = {
  id: string;
  title: string;
  item_type: "upload" | "image" | "chat_artifact" | "document" | "code" | "website_draft" | "other";
  source: "chat" | "images" | "upload" | "manual" | "other";
  content_text: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  folder_id?: string | null;
  created_at: string;
};

const ItemTypeEnum = z.enum([
  "upload",
  "image",
  "chat_artifact",
  "document",
  "code",
  "website_draft",
  "other",
]);
const SourceEnum = z.enum(["chat", "images", "upload", "manual", "other"]);

export const listMyLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LibraryItem[]> => {
    const { data, error } = await context.supabase
      .from("user_library_items")
      .select(
        "id, title, item_type, source, content_text, file_url, file_name, file_type, file_size, folder_id, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listMyLibrary]", error.message);
      throw new Error("Library could not be loaded. Check your connection and try again.");
    }
    return (data ?? []) as LibraryItem[];
  });

const SaveSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200),
  item_type: ItemTypeEnum,
  source: SourceEnum.default("manual"),
  content_text: z.string().max(300_000).optional().nullable(),
  file_url: z.string().url().max(2000).optional().nullable(),
  file_name: z.string().max(300).optional().nullable(),
  file_type: z.string().max(100).optional().nullable(),
  file_size: z.number().int().nonnegative().optional().nullable(),
});

export const saveToLibrary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => SaveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const values = {
      user_id: context.userId,
      title: data.title,
      item_type: data.item_type,
      source: data.source,
      content_text: data.content_text ?? null,
      file_url: data.file_url ?? null,
      file_name: data.file_name ?? null,
      file_type: data.file_type ?? null,
      file_size: data.file_size ?? null,
    };
    const fingerprint = await librarySaveFingerprint(values);
    const findExisting = async () => {
      if (!data.idempotencyKey) return null;
      const result = await context.supabase
        .from("user_library_items")
        .select("id, metadata")
        .eq("id", data.idempotencyKey)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (result.error) throw new Error("Library save could not be checked. Please retry.");
      return result.data;
    };
    const existing = await findExisting();
    if (existing) return assertLibrarySaveReplay(existing, fingerprint);
    const { data: row, error } = await context.supabase
      .from("user_library_items")
      .insert({
        ...values,
        ...(data.idempotencyKey ? { id: data.idempotencyKey } : {}),
        metadata: { library_save_fingerprint: fingerprint },
      })
      .select("id")
      .single();
    if (error || !row) {
      const concurrent = await findExisting();
      if (concurrent) return assertLibrarySaveReplay(concurrent, fingerprint);
      console.error("[serverfn]", error?.message);
      throw new Error("Failed to save");
    }
    return { id: row.id };
  });

export const deleteLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    // If the item is an image with a stored object, remove it from the private bucket first.
    const { data: row, error: lookupError } = await context.supabase
      .from("user_library_items")
      .select("item_type, file_url")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (lookupError) {
      console.error("[serverfn]", lookupError.message);
      throw new Error("Request failed. Please try again.");
    }
    if (row?.item_type === "image" && row.file_url) {
      await removePrivateLibraryImage(row.file_url, (paths) =>
        context.supabase.storage.from("library-images").remove(paths),
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
