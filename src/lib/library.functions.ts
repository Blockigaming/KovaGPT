import { reserveUploads } from "@/lib/upload-quota.server.mjs";
import { resolveEffectiveBillingTier } from "@/lib/billing-entitlement.server";
import { DAILY_UPLOAD_LIMIT_BY_TIER } from "@/lib/modes";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  assertLibrarySaveReplay,
  librarySaveFingerprint,
} from "@/lib/library-save-idempotency.mjs";

export type LibraryItem = {
  id: string;
  title: string;
  response_message_id?: string;
  item_type: "upload" | "image" | "chat_artifact" | "document" | "code" | "website_draft" | "other";
  source: "chat" | "images" | "upload" | "manual" | "other";
  content_text: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  folder_id?: string | null;
  work_output?: boolean;
  original_generation?: string;
  content_revision?: number;
  content_generation?: string;
  content_excerpt?: string | null;
  text_available?: boolean;
  content_loaded?: boolean;
  created_at: string;
  updated_at?: string;
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
    const { data, error } = await (context.supabase as SupabaseClient)
      .from("user_library_items")
      .select(
        "id, title, item_type, source, content_text, file_url, file_name, file_type, file_size, folder_id, metadata, content_generation, content_revision, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      console.error("[listMyLibrary]", error.message);
      throw new Error("Library could not be loaded. Check your connection and try again.");
    }
    return (data ?? []).map(({ metadata, ...item }) => ({
      ...item,
      original_generation:
        metadata &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        metadata.file_bucket === "library-files" &&
        typeof metadata.storage_generation === "string"
          ? metadata.storage_generation
          : undefined,
      work_output:
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        metadata.work_output === true,
    })) as LibraryItem[];
  });

/** Metadata-only title change, scoped to the current owner and exact saved generation/title. */
export const renameLibrarySavedItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        expectedOwnerId: z.string().uuid(),
        id: z.string().uuid(),
        generation: z.string().uuid(),
        previousTitle: z.string().max(200),
        title: z.string().trim().min(1).max(200),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    if (context.userId !== data.expectedOwnerId)
      throw new Error("Your account changed. Refresh Library before renaming.");
    const { data: row, error } = await (context.supabase as SupabaseClient)
      .from("user_library_items")
      .update({ title: data.title, updated_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .eq("id", data.id)
      .eq("content_generation", data.generation)
      .eq("title", data.previousTitle)
      .select("id,title,updated_at,content_generation")
      .maybeSingle();
    if (
      error ||
      !row ||
      row.id !== data.id ||
      row.content_generation !== data.generation ||
      row.title !== data.title
    )
      throw new Error(
        "The title change could not be confirmed. Refresh Library before retrying; the item may have changed.",
      );
    return {
      id: row.id as string,
      title: row.title as string,
      updated_at: row.updated_at as string,
      content_generation: row.content_generation as string,
    };
  });

const SaveSchema = z.object({
  expectedOwnerId: z.string().uuid().optional(),
  idempotencyKey: z.string().uuid().optional(),
  responseMessageId: z.string().min(1).max(200).optional(),
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
    if (data.expectedOwnerId && data.expectedOwnerId !== context.userId)
      throw new Error("Your account changed. Please try again.");
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
    // A stable item ID makes concurrent saves of the same reply idempotent.
    let idempotencyKey = data.idempotencyKey;
    if (data.responseMessageId && data.source === "chat") {
      const bytes = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(JSON.stringify([context.userId, data.responseMessageId])),
        ),
      ).slice(0, 16);
      bytes[6] = (bytes[6] & 0x0f) | 0x80;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      idempotencyKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    const findExisting = async () => {
      if (!idempotencyKey) return null;
      const result = await context.supabase
        .from("user_library_items")
        .select("id, metadata")
        .eq("id", idempotencyKey)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (result.error) throw new Error("Library save could not be checked. Please retry.");
      return result.data;
    };
    const existing = await findExisting();
    if (existing) return assertLibrarySaveReplay(existing, fingerprint);
    if (data.source === "upload" && data.file_name && data.content_text) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const tier = await resolveEffectiveBillingTier(supabaseAdmin, context.userId);
      if (
        !(await reserveUploads(
          { userId: context.userId, supabaseAdmin },
          [{ kind: "text_file", name: data.file_name, content: data.content_text }],
          DAILY_UPLOAD_LIMIT_BY_TIER[tier],
          AbortSignal.timeout(10000),
        ))
      )
        throw new Error("Daily file upload limit reached. Resets at midnight UTC.");
    }
    const { data: row, error } = await context.supabase
      .from("user_library_items")
      .insert({
        ...values,
        ...(idempotencyKey ? { id: idempotencyKey } : {}),
        metadata: {
          library_save_fingerprint: fingerprint,
          ...(data.responseMessageId && { response_message_id: data.responseMessageId }),
        },
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

export const findResponseBookmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        ownerId: z.string().uuid(),
        messageId: z.string().min(1).max(200),
        legacyContent: z.string().max(300_000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<string | null> => {
    if (data.ownerId !== context.userId) throw new Error("Your account changed.");
    const items = () =>
      context.supabase
        .from("user_library_items")
        .select("id")
        .eq("user_id", context.userId)
        .eq("source", "chat")
        .in("item_type", ["chat_artifact", "code"])
        .is("file_url", null)
        .limit(2);
    const current = await items().contains("metadata", { response_message_id: data.messageId });
    if (current.error) throw new Error("Your bookmark could not be checked.");
    if (current.data[0]) return current.data[0].id;
    if (data.legacyContent === undefined) return null;
    // Match older saves locally so long responses never enter the query URL.
    const { data: legacy, error } = await context.supabase
      .from("user_library_items")
      .select("id,content_text,metadata")
      .eq("user_id", context.userId)
      .eq("source", "chat")
      .in("item_type", ["chat_artifact", "code"])
      .is("file_url", null)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("Your bookmark could not be checked.");
    const matches = legacy.filter(
      (item) =>
        item.content_text === data.legacyContent &&
        item.metadata &&
        typeof item.metadata === "object" &&
        !Array.isArray(item.metadata) &&
        typeof item.metadata.library_save_fingerprint === "string" &&
        !item.metadata.response_message_id,
    );
    if (matches.length > 1)
      throw new Error(
        "Multiple older saves match this reply. Remove the intended one from Library.",
      );
    return matches[0]?.id ?? null;
  });

export const deleteLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        expectedOwnerId: z.string().uuid().optional(),
        generation: z.string().uuid().optional(),
        contentGeneration: z.string().uuid().optional(),
        revision: z.number().int().positive().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    if (data.expectedOwnerId && data.expectedOwnerId !== context.userId)
      throw new Error("Your account changed. Please try again.");
    // If the item is an image with a stored object, remove it from the private bucket first.
    const { data: row, error: lookupError } = await (context.supabase as SupabaseClient)
      .from("user_library_items")
      .select("item_type, file_url, metadata, content_generation")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (lookupError) {
      console.error("[serverfn]", lookupError.message);
      throw new Error("Request failed. Please try again.");
    }
    if (
      row?.metadata &&
      typeof row.metadata === "object" &&
      !Array.isArray(row.metadata) &&
      row.metadata.file_bucket === "library-files"
    ) {
      if (
        !data.generation ||
        data.expectedOwnerId !== context.userId ||
        row.metadata.storage_generation !== data.generation
      )
        throw new Error("Refresh Library before deleting this original file.");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { deleteOriginalLibraryDocument } =
        await import("@/lib/library-original-files.server.mjs");
      return deleteOriginalLibraryDocument(
        supabaseAdmin,
        context.userId,
        data.id,
        data.generation,
        AbortSignal.timeout(40000),
      );
    }
    if (
      row &&
      row.file_url === null &&
      row.item_type !== "image" &&
      !(
        row.metadata &&
        typeof row.metadata === "object" &&
        !Array.isArray(row.metadata) &&
        row.metadata.work_output === true
      )
    ) {
      if (data.expectedOwnerId !== context.userId || !data.contentGeneration || !data.revision)
        throw new Error("Refresh Library before deleting this item.");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const result = await (supabaseAdmin as SupabaseClient)
        .rpc("delete_library_text", {
          p_owner: context.userId,
          p_item: data.id,
          p_generation: data.contentGeneration,
          p_revision: data.revision,
        })
        .abortSignal(AbortSignal.timeout(15000));
      if (result.error || result.data !== true)
        throw new Error("This item changed. Refresh before deleting.");
      return { ok: true };
    }
    if (row?.item_type === "image" && row.file_url && !/^https?:/u.test(row.file_url)) {
      if (
        data.expectedOwnerId !== context.userId ||
        !data.contentGeneration ||
        data.contentGeneration !== row.content_generation
      )
        throw new Error("Refresh Library before deleting this image.");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { deletePrivateLibraryImage } = await import("@/lib/library-image-storage.server.mjs");
      if (
        !(await deletePrivateLibraryImage(
          supabaseAdmin,
          context.userId,
          data.id,
          data.contentGeneration,
          AbortSignal.timeout(40000),
        ))
      )
        throw new Error("Image cleanup is pending. Please retry.");
      return { ok: true };
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
