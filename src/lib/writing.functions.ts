import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Id = z.string().uuid();
const Title = z.string().trim().min(1).max(200);
const Content = z.string().max(500_000);
const Source = z.enum(["autosave", "manual", "restore", "clear", "import"]);
export type WritingDocument = {
  id: string;
  title: string;
  content: string;
  version: number;
  archived_at: string | null;
  project_id: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string;
};
export type WritingVersion = {
  id: string;
  document_id: string;
  title: string;
  content: string;
  version: number;
  word_count: number;
  source: string;
  created_at: string;
};

export const listWritingDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WritingDocument[]> => {
    const { data, error } = await context.supabase
      .from("writing_documents")
      .select(
        "id,title,content,version,archived_at,project_id,created_at,updated_at,last_opened_at",
      )
      .eq("owner_id", context.userId)
      .order("updated_at", { ascending: false })
      .limit(100);
    if (error) throw new Error("Documents could not be loaded.");
    return data ?? [];
  });

export const createWritingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        title: Title.default("Untitled document"),
        content: Content.default(""),
        projectId: Id.nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WritingDocument> => {
    const { data: row, error } = await context.supabase
      .from("writing_documents")
      .insert({
        owner_id: context.userId,
        title: data.title,
        content: data.content,
        project_id: data.projectId ?? null,
      })
      .select(
        "id,title,content,version,archived_at,project_id,created_at,updated_at,last_opened_at",
      )
      .single();
    if (error || !row) throw new Error("Document could not be created.");
    const words = data.content.trim() ? data.content.trim().split(/\s+/).length : 0;
    const { error: versionError } = await context.supabase
      .from("writing_document_versions")
      .insert({
        document_id: row.id,
        owner_id: context.userId,
        version: row.version,
        title: row.title,
        content: row.content,
        word_count: words,
        source: "create",
      });
    if (versionError) {
      await context.supabase
        .from("writing_documents")
        .delete()
        .eq("id", row.id)
        .eq("owner_id", context.userId);
      throw new Error("Document could not be created.");
    }
    return row;
  });

export const saveWritingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        id: Id,
        title: Title,
        content: Content,
        expectedVersion: z.number().int().positive(),
        source: Source,
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<WritingDocument> => {
    const { data: row, error } = await context.supabase.rpc("save_writing_document", {
      p_id: data.id,
      p_title: data.title,
      p_content: data.content,
      p_expected_version: data.expectedVersion,
      p_source: data.source,
    });
    if (error || !row) {
      if (error?.code === "40001" || error?.message?.includes("version_conflict"))
        throw new Error("This document changed elsewhere. Reload it before saving again.");
      throw new Error("Document could not be saved.");
    }
    return row;
  });

export const listWritingVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ documentId: Id }).parse(input))
  .handler(async ({ data, context }): Promise<WritingVersion[]> => {
    const { data: rows, error } = await context.supabase
      .from("writing_document_versions")
      .select("id,document_id,title,content,version,word_count,source,created_at")
      .eq("document_id", data.documentId)
      .eq("owner_id", context.userId)
      .order("version", { ascending: false })
      .limit(50);
    if (error) throw new Error("Version history could not be loaded.");
    return rows ?? [];
  });

export const archiveWritingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id, archived: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("writing_documents")
      .update({ archived_at: data.archived ? new Date().toISOString() : null })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Document archive state could not be changed.");
    return { ok: true as const };
  });

export const deleteWritingDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ id: Id }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("writing_documents")
      .delete()
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Document could not be deleted.");
    return { ok: true as const };
  });
