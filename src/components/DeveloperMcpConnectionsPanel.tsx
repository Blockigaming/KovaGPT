import { useCallback, useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
type Data = {
  enabled: boolean;
  accounts: {
    id: string;
    server_id: string;
    account_label: string | null;
    tool_name: string;
    binding: string;
    origin: string;
  }[];
  keys: { id: string; name: string }[];
  grants: {
    id: string;
    api_key_id: string;
    server_id: string;
    tool_name: string;
    expires_at: string;
    revoked_at: string | null;
  }[];
};
export function DeveloperMcpConnectionsPanel({
  userId,
  projectId,
}: {
  userId: string;
  projectId: string;
}) {
  const [data, setData] = useState<Data | null>(null),
    [accountId, setAccount] = useState(""),
    [keyId, setKey] = useState(""),
    [approved, setApproved] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef<AbortController | null>(null);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const headers = { "X-Kova-Expected-User": userId };
      const response = await fetchWithTimeoutAuthenticated(
        `/api/developer/console?mcpProject=${encodeURIComponent(projectId)}`,
        { signal, headers },
      );
      if (!response.ok) throw new Error("Could not load MCP connections.");
      const result = await response.json();
      if (!signal.aborted) setData(result);
    },
    [userId, projectId],
  );
  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setError("MCP connection grants are unavailable.");
    });
    return () => {
      controller.abort();
      active.current?.abort();
    };
  }, [load]);
  async function mutate(operation: string, input: Record<string, unknown>) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    setApproved(false);
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/developer/console", {
        method: "POST",
        signal: controller.signal,
        headers: { "X-Kova-Expected-User": userId, "Content-Type": "application/json" },
        body: JSON.stringify({ operation, projectId, ...input }),
      });
      if (!response.ok) throw new Error("Grant change failed.");
      await load(controller.signal);
    } catch {
      if (!controller.signal.aborted)
        setError("Grant change could not be confirmed. Refresh before retrying.");
    } finally {
      if (active.current === controller) {
        active.current = null;
        setBusy(false);
      }
    }
  }
  const account = data?.accounts.find((row) => row.id === accountId);
  return (
    <section className="space-y-4 rounded-xl border p-5">
      <div>
        <h2 className="text-lg font-semibold">Delegate a reviewed MCP connection</h2>
        <p className="text-sm text-muted-foreground">
          Grant a single project key access to one read tool on a personal linked connection, for at
          most 24 hours. No secret or write access is shared.
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
      {data && !data.enabled && (
        <p role="status">New grants are disabled. Existing grants can still be revoked.</p>
      )}
      {data && (
        <>
          <label className="block space-y-1 text-sm">
            Linked tool
            <select
              className="block w-full rounded-md border bg-background p-2"
              value={accountId}
              onChange={(e) => {
                setAccount(e.target.value);
                setApproved(false);
              }}
              disabled={busy || !data.enabled}
            >
              <option value="">Select a reviewed tool</option>
              {data.accounts.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.account_label ?? row.server_id} — {row.tool_name} ({row.origin})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            Project key
            <select
              className="block w-full rounded-md border bg-background p-2"
              value={keyId}
              onChange={(e) => {
                setKey(e.target.value);
                setApproved(false);
              }}
              disabled={busy || !data.enabled}
            >
              <option value="">Select a key with mcp_read</option>
              {data.keys.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={approved}
              disabled={busy || !data.enabled}
              onChange={(e) => setApproved(e.target.checked)}
            />
            I authorize this key to query the selected linked tool. The linked service may charge
            for reads.
          </label>
          <Button
            disabled={
              busy ||
              !data.enabled ||
              !approved ||
              !account ||
              !data.keys.some((k) => k.id === keyId)
            }
            onClick={() => {
              if (account && approved)
                void mutate("grant_mcp_read", {
                  id: crypto.randomUUID(),
                  keyId,
                  linkedAccountId: account.id,
                  binding: account.binding,
                  approved: true,
                });
            }}
          >
            Grant read access
          </Button>
          <h3 className="font-medium">Grants</h3>
          {data.grants.length === 0 && <p className="text-sm text-muted-foreground">No grants.</p>}
          {data.grants.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t py-3"
            >
              <div className="text-sm break-all">
                {row.server_id} / {row.tool_name}
                <div className="text-muted-foreground">
                  {row.revoked_at
                    ? "Revoked"
                    : Date.parse(row.expires_at) <= Date.now()
                      ? "Expired"
                      : `Expires ${new Date(row.expires_at).toLocaleString()}`}{" "}
                  · Key {row.api_key_id}
                </div>
              </div>
              {!row.revoked_at && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void mutate("revoke_mcp_read", { id: row.id })}
                >
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
