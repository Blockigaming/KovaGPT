import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type DiscoveredWorkspace = {
  id: string;
  name: string;
  status: "joinable" | "pending" | "declined";
};
export type WorkspaceJoinRequest = {
  id: string;
  organizationId: string;
  organizationName: string;
  requesterEmail: string;
  createdAt: string;
};
async function workspaceRequest<T>(
  userId: string,
  method: "GET" | "POST",
  data?: Record<string, string>,
  query = "",
  signal?: AbortSignal,
): Promise<T> {
  const session = await supabase.auth.getSession();
  if (session.data.session?.user.id && session.data.session.user.id !== userId)
    throw new Error("The account changed. Refresh before trying again.");
  const response = await fetch("/api/workspace/discovery" + query, {
    method, credentials: "same-origin", cache: "no-store",
    redirect: "error", signal,
    headers: {
      "X-Kova-Owner": userId,
      ...(session.data.session?.access_token
        ? { Authorization: "Bearer " + session.data.session.access_token }
        : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Too many requests. Try again later.");
    if (response.status === 401) throw new Error("Sign in again to continue.");
    throw new Error("Workspace access could not be confirmed. Please try again.");
  }
  return (await response.json()) as T;
}

export function useWorkspaceDiscovery(userId: string | null) {
  const [workspaces, setWorkspaces] = useState<DiscoveredWorkspace[]>([]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!userId) { setWorkspaces([]); return; }
    const data = await workspaceRequest<{workspaces: DiscoveredWorkspace[]}>(
      userId, "GET", undefined, "", signal,
    );
    if (!signal?.aborted) setWorkspaces(data.workspaces || []);
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    setWorkspaces([]);
    setError("");
    if (!userId) return () => controller.abort();
    setLoading(true);
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted) setWorkspaces([]);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [refresh, userId]);

  const requestJoin = async (organizationId: string) => {
    if (!userId || pendingId) return;
    setPendingId(organizationId);
    setError("");
    try {
      await workspaceRequest(userId, "POST", {action: "request", organizationId});
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed.");
    } finally { setPendingId(null); }
  };
  return { workspaces, pendingId, loading, error, requestJoin, refresh };
}

export async function listWorkspaceJoinRequests(userId: string, organizationId: string) {
  const data = await workspaceRequest<{requests: WorkspaceJoinRequest[]}>(
    userId, "GET", undefined, "?view=requests&organizationId=" + encodeURIComponent(organizationId)
  );
  return data.requests;
}
export async function declineWorkspaceJoinRequest(userId: string, requestId: string) {
  return workspaceRequest(userId, "POST", {action: "decline", requestId});
}
