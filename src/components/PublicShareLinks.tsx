import { useEffect, useRef, useState } from "react";
import { useUser } from "@/components/auth/ClerkSafe";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import { Button } from "@/components/ui/button";
type ShareLink = { id: string; title: string; created_at: string; expires_at: string };
export function PublicShareLinks() {
  const { user, isLoaded, isSignedIn } = useUser();
  const owner = isLoaded && isSignedIn ? user?.id : null;
  const current = useRef(owner);
  current.current = owner;
  const [revision, setRevision] = useState(0),
    [state, setState] = useState<{
      owner: string | null | undefined;
      rows: ShareLink[];
      error: string;
      loading: boolean;
    }>({ owner: null, rows: [], error: "", loading: true });
  const [busy, setBusy] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    operation.current?.abort();
    setBusy(null);
    setState({ owner, rows: [], error: "", loading: !!owner });
    if (owner)
      void fetchWithTimeoutAuthenticated("/api/chat-share", {
        signal: controller.signal,
        headers: { "X-Kova-Owner": owner },
      })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok || !Array.isArray(body.links))
            throw new Error(body.error || "Share links could not be loaded.");
          if (!controller.signal.aborted && current.current === owner)
            setState({ owner, rows: body.links, error: "", loading: false });
        })
        .catch((error) => {
          if (!controller.signal.aborted && current.current === owner)
            setState({
              owner,
              rows: [],
              error: error instanceof Error ? error.message : "Try again.",
              loading: false,
            });
        });
    return () => {
      controller.abort();
      operation.current?.abort();
    };
  }, [owner, revision]);
  async function remove(id: string) {
    if (!owner || busy) return;
    const expected = owner,
      controller = new AbortController();
    operation.current = controller;
    setBusy(id);
    try {
      const response = await fetchWithTimeoutAuthenticated("/api/chat-share", {
        method: "DELETE",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Kova-Owner": owner },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error("This link could not be removed. Try again.");
      if (current.current === expected && !controller.signal.aborted) setRevision((n) => n + 1);
    } catch (error) {
      if (current.current === expected && !controller.signal.aborted)
        setState((s) => ({ ...s, error: error instanceof Error ? error.message : "Try again." }));
    } finally {
      if (
        current.current === expected &&
        operation.current === controller &&
        !controller.signal.aborted
      )
        setBusy(null);
    }
  }
  const visible = state.owner === owner ? state : null;
  return (
    <section className="kova-public-links">
      <h3>Shared conversation links</h3>
      <p>Remove a link to stop access to its public snapshot. Links expire after 30 days.</p>
      {!visible || visible.loading ? (
        <p role="status">Loading share links…</p>
      ) : visible.error ? (
        <div role="alert">
          <p>{visible.error}</p>
          <Button variant="outline" onClick={() => setRevision((n) => n + 1)}>
            Try again
          </Button>
        </div>
      ) : visible.rows.length ? (
        <ul>
          {visible.rows.map((link) => (
            <li key={link.id}>
              <div>
                <strong>{link.title}</strong>
                <small>Expires {new Date(link.expires_at).toLocaleDateString()}</small>
              </div>
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() => void remove(link.id)}
                aria-label={`Remove share link for ${link.title}`}
              >
                {busy === link.id ? "Removing…" : "Remove link"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p>No active shared links.</p>
      )}
    </section>
  );
}
