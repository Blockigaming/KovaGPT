import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase generated types are updated after migrations are applied. */

type Db = {
  from(table: string): any;
  storage: any;
  rpc(name: string, args: Record<string, unknown>): any;
};
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type WorkRun = {
  id: string;
  kind: "browser" | "team";
  status: string;
  attempts: number;
  maxAttempts: number;
  projectId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  input: { [key: string]: JsonValue };
};
export type WorkEvent = {
  id: number;
  type: string;
  payload: { [key: string]: JsonValue };
  createdAt: string;
  previewUrl?: string | null;
};
export type WorkDeliverable = {
  id: string;
  runId: string;
  projectId: string | null;
  type: string;
  title: string;
  mimeType: string;
  storageReference: string;
  evidence: JsonValue[];
  revision: number;
  status: string;
  integrityHash: string;
  createdAt: string;
  downloadUrl?: string | null;
};
export type WorkApproval = {
  id: string;
  runId: string;
  tool: string;
  reason: string;
  destination: string;
  risk: "low" | "medium" | "high";
  status: string;
  request: { [key: string]: JsonValue };
  createdAt: string;
};
export type WorkTask = {
  id: string;
  key: string;
  role: string;
  objective: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
};
export type WorkEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  condition: JsonValue;
  metadata: { [key: string]: JsonValue };
};
export type WorkDetail = {
  run: WorkRun;
  events: WorkEvent[];
  deliverables: WorkDeliverable[];
  approvals: WorkApproval[];
  tasks: WorkTask[];
  edges: WorkEdge[];
  graphPreference: {
    direction: "LR" | "TB";
    density: "compact" | "comfortable";
    positions: Record<string, { x: number; y: number }>;
    pinned: string[];
  } | null;
};

const db = (value: unknown) => value as Db;
const runFields =
  "id,kind,status,attempts,max_attempts,project_id,created_at,started_at,completed_at,error,input";
function mapRun(row: any): WorkRun {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    projectId: row.project_id,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    error: row.error,
    input: row.input ?? {},
  };
}
function mapDeliverable(row: any): WorkDeliverable {
  return {
    id: row.id,
    runId: row.run_id,
    projectId: row.project_id,
    type: row.type,
    title: row.title,
    mimeType: row.mime_type,
    storageReference: row.storage_reference,
    evidence: row.source_evidence ?? [],
    revision: row.revision,
    status: row.status,
    integrityHash: row.integrity_hash,
    createdAt: row.created_at,
  };
}

export const listWorkRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WorkRun[]> => {
    const { data, error } = await db(context.supabase)
      .from("agent_jobs")
      .select(runFields)
      .eq("owner_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Unable to load Work runs");
    return (data ?? []).map(mapRun);
  });
export const getWorkRun = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => z.object({ id: z.string().uuid() }).parse(v))
  .handler(async ({ data, context }): Promise<WorkDetail> => {
    const client = db(context.supabase);
    const runResult = await client
      .from("agent_jobs")
      .select(runFields)
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .single();
    if (runResult.error || !runResult.data) throw new Error("Work run not found");
    const [events, deliverables, approvals, tasks, edges, preference] = await Promise.all([
      client
        .from("agent_job_events")
        .select("id,event_type,payload,created_at")
        .eq("job_id", data.id)
        .order("created_at", { ascending: true })
        .limit(1000),
      client
        .from("agent_deliverables")
        .select("*")
        .eq("run_id", data.id)
        .eq("owner_id", context.userId)
        .neq("status", "deleted")
        .order("created_at", { ascending: false }),
      client
        .from("agent_approvals")
        .select("*")
        .eq("run_id", data.id)
        .eq("owner_id", context.userId)
        .order("created_at", { ascending: false }),
      client
        .from("agent_specialist_tasks")
        .select("*")
        .eq("run_id", data.id)
        .eq("owner_id", context.userId)
        .order("created_at"),
      client
        .from("agent_dependency_edges")
        .select("*")
        .eq("run_id", data.id)
        .eq("owner_id", context.userId)
        .is("deleted_at", null),
      client
        .from("agent_graph_preferences")
        .select("*")
        .eq("run_id", data.id)
        .eq("owner_id", context.userId)
        .maybeSingle(),
    ]);
    const mappedEvents: WorkEvent[] = await Promise.all(
      (events.data ?? []).map(async (event: any) => {
        let previewUrl: string | null = null;
        const storagePath = event.payload?.storage_path;
        if (typeof storagePath === "string" && storagePath) {
          const signed = await client.storage
            .from("agent-evidence")
            .createSignedUrl(storagePath, 300);
          if (!signed.error) previewUrl = signed.data.signedUrl;
        }
        return {
          id: event.id,
          type: event.event_type,
          payload: event.payload ?? {},
          createdAt: event.created_at,
          previewUrl,
        };
      }),
    );
    return {
      run: mapRun(runResult.data),
      events: mappedEvents,
      deliverables: (deliverables.data ?? []).map(mapDeliverable),
      approvals: approvals.error
        ? []
        : (approvals.data ?? []).map((a: any) => ({
            id: a.id,
            runId: a.run_id,
            tool: a.tool,
            reason: a.reason,
            destination: a.destination,
            risk: a.risk,
            status: a.status,
            request: a.request_metadata ?? {},
            createdAt: a.created_at,
          })),
      tasks: tasks.error
        ? []
        : (tasks.data ?? []).map((task: any) => ({
            id: task.id,
            key: task.specialist_key,
            role: task.role,
            objective: task.objective,
            status: task.status,
            attempt: task.attempt,
            maxAttempts: task.max_attempts,
            startedAt: task.started_at,
            completedAt: task.completed_at,
          })),
      edges: edges.error
        ? []
        : (edges.data ?? []).map((edge: any) => ({
            id: edge.id,
            source: edge.source_task_id,
            target: edge.destination_task_id,
            type: edge.dependency_type,
            condition: edge.condition,
            metadata: edge.display_metadata ?? {},
          })),
      graphPreference: preference.data
        ? {
            direction: preference.data.layout_direction,
            density: preference.data.density,
            positions: preference.data.node_positions ?? {},
            pinned: preference.data.pinned_node_ids ?? [],
          }
        : null,
    };
  });

export const saveGraphPreference = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z
      .object({
        runId: z.string().uuid(),
        direction: z.enum(["LR", "TB"]),
        density: z.enum(["compact", "comfortable"]),
        positions: z.record(
          z.string().uuid(),
          z.object({
            x: z.number().finite().min(-100000).max(100000),
            y: z.number().finite().min(-100000).max(100000),
          }),
        ),
        pinned: z.array(z.string().uuid()).max(500),
      })
      .parse(value),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).from("agent_graph_preferences").upsert(
      {
        owner_id: context.userId,
        run_id: data.runId,
        layout_direction: data.direction,
        density: data.density,
        node_positions: data.positions,
        pinned_node_ids: data.pinned,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,run_id" },
    );
    if (error) throw new Error("Unable to save graph layout");
    return { ok: true };
  });

export const controlWorkRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.literal("cancel"),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await db(context.supabase).rpc("control_agent_job", {
      p_job_id: data.id,
      p_action: data.action,
    });
    if (error || !row) throw new Error("Run state changed; reload and try again");
    return row;
  });

const deliverableMutation = z.object({ id: z.string().uuid() });
export const renameDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    deliverableMutation.extend({ title: z.string().trim().min(1).max(160) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("agent_deliverables")
      .update({ title: data.title })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Unable to rename deliverable");
    return { ok: true };
  });
export const moveDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    deliverableMutation.extend({ projectId: z.string().uuid().nullable() }).parse(v),
  )
  .handler(async ({ data, context }) => {
    if (data.projectId) {
      const access = await db(context.supabase)
        .from("project_members")
        .select("role")
        .eq("project_id", data.projectId)
        .eq("user_id", context.userId)
        .in("role", ["owner", "editor"])
        .maybeSingle();
      if (!access.data) throw new Error("Project write access required");
    }
    const { error } = await db(context.supabase)
      .from("agent_deliverables")
      .update({ project_id: data.projectId })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Unable to move deliverable");
    return { ok: true };
  });
export const deleteDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => deliverableMutation.parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("agent_deliverables")
      .update({ status: "deleted" })
      .eq("id", data.id)
      .eq("owner_id", context.userId);
    if (error) throw new Error("Unable to delete deliverable");
    return { ok: true };
  });
export const restoreDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => deliverableMutation.parse(v))
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase)
      .from("agent_deliverables")
      .update({ status: "ready" })
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .eq("status", "deleted");
    if (error) throw new Error("Unable to restore deliverable");
    return { ok: true };
  });
export const duplicateDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => deliverableMutation.parse(v))
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const source = await client
      .from("agent_deliverables")
      .select("*")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .single();
    if (source.error) throw new Error("Deliverable not found");
    const {
      id,
      created_at,
      deliverable_key,
      restored_from_id,
      deleted_at,
      purge_after,
      cleanup_status,
      ...copy
    } = source.data;
    const result = await client
      .from("agent_deliverables")
      .insert({
        ...copy,
        title: `${copy.title} copy`,
        revision: 1,
        status: "ready",
      })
      .select("id")
      .single();
    if (result.error) throw new Error("Unable to duplicate deliverable");
    return result.data;
  });
export const downloadDeliverable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) => deliverableMutation.parse(v))
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const row = await client
      .from("agent_deliverables")
      .select("storage_reference")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .neq("status", "deleted")
      .single();
    if (row.error) throw new Error("Deliverable not found");
    const [bucket, ...parts] = String(row.data.storage_reference).split(":");
    if (!bucket || !parts.length) throw new Error("Invalid storage reference");
    const signed = await client.storage.from(bucket).createSignedUrl(parts.join(":"), 60);
    if (signed.error) throw new Error("Unable to create download");
    return { url: signed.data.signedUrl };
  });

const previewMime = new Set([
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
    "text/html",
  ]),
  previewBytes = 5_000_000;
export const getDeliverableContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => deliverableMutation.parse(value))
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const row = await client
      .from("agent_deliverables")
      .select("*")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .neq("status", "deleted")
      .single();
    if (row.error) throw new Error("Deliverable not found");
    if (!previewMime.has(row.data.mime_type))
      return {
        metadata: mapDeliverable(row.data),
        content: null,
        trusted: true,
        reason: "Content preview is unavailable for this MIME type",
      };
    const [bucket, ...path] = String(row.data.storage_reference).split(":");
    if (!bucket || !path.length || !["agent-evidence", "project-files"].includes(bucket))
      throw new Error("Storage reference is not previewable");
    const download = await client.storage.from(bucket).download(path.join(":"));
    if (download.error) throw new Error("Content unavailable");
    if (download.data.size > previewBytes)
      throw new Error("Content exceeds the 5 MB preview limit");
    const bytes = await download.data.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const trusted = digest === row.data.integrity_hash;
    return {
      metadata: mapDeliverable(row.data),
      content: new TextDecoder().decode(bytes),
      trusted,
      reason: trusted ? null : "Stored content does not match its recorded SHA-256 integrity hash",
    };
  });

export const compareDeliverableContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) =>
    z.object({ leftId: z.string().uuid(), rightId: z.string().uuid() }).parse(value),
  )
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const rows = await client
      .from("agent_deliverables")
      .select("id,mime_type,storage_reference,integrity_hash,status")
      .in("id", [data.leftId, data.rightId])
      .eq("owner_id", context.userId)
      .neq("status", "deleted");
    if (rows.error || rows.data?.length !== 2) throw new Error("Both revisions are required");
    const result = [];
    for (const row of rows.data) {
      if (!previewMime.has(row.mime_type)) {
        result.push({
          id: row.id,
          mimeType: row.mime_type,
          content: null,
          hash: row.integrity_hash,
        });
        continue;
      }
      const [bucket, ...path] = String(row.storage_reference).split(":");
      if (!["agent-evidence", "project-files"].includes(bucket))
        throw new Error("Storage reference is not comparable");
      const file = await client.storage.from(bucket).download(path.join(":"));
      if (file.error || file.data.size > previewBytes)
        throw new Error("Revision content unavailable");
      result.push({
        id: row.id,
        mimeType: row.mime_type,
        content: await file.data.text(),
        hash: row.integrity_hash,
      });
    }
    return result;
  });

export const listDeliverableVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => deliverableMutation.parse(value))
  .handler(async ({ data, context }): Promise<WorkDeliverable[]> => {
    const client = db(context.supabase);
    const source = await client
      .from("agent_deliverables")
      .select("deliverable_key")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .single();
    if (source.error) throw new Error("Deliverable not found");
    const versions = await client
      .from("agent_deliverables")
      .select("*")
      .eq("owner_id", context.userId)
      .eq("deliverable_key", source.data.deliverable_key)
      .order("revision", { ascending: false });
    if (versions.error) throw new Error("Unable to load version history");
    return (versions.data ?? []).map(mapDeliverable);
  });

export const restoreDeliverableRevision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((value: unknown) => deliverableMutation.parse(value))
  .handler(async ({ data, context }) => {
    const client = db(context.supabase);
    const source = await client
      .from("agent_deliverables")
      .select("*")
      .eq("id", data.id)
      .eq("owner_id", context.userId)
      .single();
    if (source.error) throw new Error("Revision not found");
    const latest = await client
      .from("agent_deliverables")
      .select("revision")
      .eq("owner_id", context.userId)
      .eq("deliverable_key", source.data.deliverable_key)
      .order("revision", { ascending: false })
      .limit(1)
      .single();
    const { id, created_at, ...revision } = source.data;
    const inserted = await client
      .from("agent_deliverables")
      .insert({
        ...revision,
        revision: Number(latest.data?.revision ?? 0) + 1,
        status: "ready",
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error("Unable to restore revision");
    return inserted.data;
  });
export const decideApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((v: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        decision: z.literal("denied"),
        editedRequest: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    const { error } = await db(context.supabase).rpc("decide_agent_approval", {
      p_approval_id: data.id,
      p_decision: data.decision,
      p_edited_request: data.editedRequest,
    });
    if (error) throw new Error("Approval is no longer pending");
    return { ok: true };
  });
