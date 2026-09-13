import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase, getSupabaseClientConfigStatus } from "@/integrations/supabase/client";
import { SUPABASE_BROWSER_CONFIG } from "@/integrations/supabase/config";
import {
  createCollaborationClient,
  createCollaborationLifecycle,
  CollaborationError,
} from "./collaboration-client.mjs";

export const collaborationRequest = createCollaborationClient({
  config: SUPABASE_BROWSER_CONFIG,
  getSession: () => supabase.auth.getSession(),
});
const Anchor = z.object({
  revision: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  quote: z.string().max(1000),
  prefix: z.string().max(64),
  suffix: z.string().max(64),
});
const CanvasSnapshot = z.object({
  document: z.object({
    id: z.string().uuid(),
    private_owner_id: z.string().uuid().nullable(),
    project_id: z.string().uuid().nullable(),
    chat_id: z.string(),
    message_id: z.string(),
    content: z.string().max(400000),
    revision: z.number().int().positive(),
    comment_epoch: z.number().int().nonnegative().default(0),
    updated_at: z.string(),
  }),
  canEdit: z.boolean(),
  canManageComments: z.boolean(),
  deletedCommentIds: z.array(z.string().uuid()).max(500),
  versions: z
    .array(z.object({ revision: z.number().int().positive(), created_at: z.string() }))
    .max(50),
  comments: z
    .array(
      z.object({
        id: z.string().uuid(),
        author_id: z.string().uuid(),
        body: z.string().max(8000),
        anchor: Anchor.nullable(),
        created_at: z.string(),
      }),
    )
    .max(100),
});
export type CanvasSnapshot = z.infer<typeof CanvasSnapshot>;
export type CanvasComment = CanvasSnapshot["comments"][number];
export function parseCanvasSnapshot(
  value: unknown,
  actorId: string,
  projectId?: string | null,
): CanvasSnapshot {
  const parsed = CanvasSnapshot.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.document.project_id !== (projectId ?? null) ||
    (!projectId && parsed.data.document.private_owner_id !== actorId)
  )
    throw new CollaborationError("42501");
  return parsed.data;
}
export function useCollaborationPresence({
  kind,
  id,
  userId,
  onRefresh,
  onDenied,
}: {
  kind: "canvas" | "project";
  id: string | null;
  userId: string | null;
  onRefresh?: (signal: AbortSignal) => Promise<void>;
  onDenied?: () => void;
}) {
  const [status, setStatus] = useState<"connected" | "reconnecting" | "unavailable">("unavailable");
  const [peers, setPeers] = useState(0);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const deniedRef = useRef(onDenied);
  deniedRef.current = onDenied;
  useEffect(() => {
    setPeers(0);
    setStatus("unavailable");
    if (!id || !userId || !getSupabaseClientConfigStatus().configured) return;
    setStatus("reconnecting");
    const sessionId = crypto.randomUUID();
    return createCollaborationLifecycle({
      refresh: async (signal) => {
        await refreshRef.current?.(signal);
      },
      heartbeat: async (sequence, signal) => {
        const result = await collaborationRequest(
          userId,
          "presence",
          { kind, resourceId: id, sessionId, sequence },
          signal,
        );
        const parsed = z.object({ peers: z.number().int().min(0).max(100) }).safeParse(result);
        if (!parsed.success) throw new CollaborationError("unavailable");
        return parsed.data;
      },
      leave: (sequence) =>
        collaborationRequest(userId, "leave", { kind, resourceId: id, sessionId, sequence }),
      subscribe: (invalidate, onStatus) => {
        // Only table changes with per-record RLS. No public Broadcast/Presence
        // payloads, channel claims, names or email addresses are trusted.
        const channel = supabase.channel(`kova-collaboration:${kind}:${id}:${sessionId}`);
        const targets =
          kind === "canvas"
            ? [
                ["canvas_documents", `id=eq.${id}`],
                ["canvas_comments", `document_id=eq.${id}`],
              ]
            : [
                ["project_notes", `project_id=eq.${id}`],
                ["project_comments", `project_id=eq.${id}`],
              ];
        targets.push(["collaboration_presence", `resource_id=eq.${id}`]);
        for (const [table, filter] of targets)
          for (const event of ["INSERT", "UPDATE"] as const)
            channel.on("postgres_changes", { event, schema: "public", table, filter }, invalidate);
        channel.subscribe(onStatus);
        return () => {
          void supabase.removeChannel(channel);
        };
      },
      onStatus: setStatus,
      onPeers: setPeers,
      onDenied: () => {
        setStatus("unavailable");
        deniedRef.current?.();
      },
    });
  }, [kind, id, userId]);
  return { status, peers };
}
