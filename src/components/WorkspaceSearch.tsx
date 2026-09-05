import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceSearchResult } from "@/lib/workspace-search-policy.server.mjs";

/** Search results are transient and always bound to the submitting principal. */
export function WorkspaceSearch({ userId }: { userId: string }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{
    userId: string;
    result?: WorkspaceSearchResult;
    error?: string;
    busy?: boolean;
  }>({ userId });
  const generation = useRef(0);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const request = useRef<AbortController | null>(null);
  const visible = state.userId === userId ? state : null;
  useEffect(() => {
    const invalidate = () => {
      generation.current++;
      request.current?.abort();
    };
    const clear = () => {
      invalidate();
      setState({ userId });
    };
    clear();
    setQuery("");
    window.addEventListener("blur", clear);
    return () => {
      invalidate();
      window.removeEventListener("blur", clear);
    };
  }, [userId]);
  async function search(event: FormEvent) {
    event.preventDefault();
    const ticket = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ userId, busy: true });
    try {
      // Pin the token before sending a private query. An account switch during
      // getSession must never submit the old account's text as the new user.
      const { data } = await supabase.auth.getSession();
      if (
        generation.current !== ticket ||
        currentUser.current !== userId ||
        controller.signal.aborted
      )
        return;
      if (data.session?.user.id !== userId || !data.session.access_token)
        throw new Error("Sign in again to search your workspace.");
      const response = await fetch("/api/workspace/search", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ query: query.trim() }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Workspace search could not be loaded.");
      if (generation.current === ticket && currentUser.current === userId)
        setState({ userId, result: body });
    } catch (error) {
      if (generation.current === ticket && currentUser.current === userId)
        setState({
          userId,
          error: error instanceof Error ? error.message : "Workspace search could not be loaded.",
        });
    }
  }
  return (
    <section
      className="mt-6 rounded-2xl border bg-card/35 p-4"
      aria-labelledby="workspace-search-title"
    >
      <h2 id="workspace-search-title" className="font-semibold">
        Search your workspace
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Find saved titles and text in Projects, Library, memory, research, prompts, goals, and
        tasks. Local chats and file contents are outside this search.
      </p>
      <form onSubmit={search} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="workspace-search-query">
          Search your saved workspace
        </label>
        <input
          id="workspace-search-query"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          minLength={2}
          maxLength={500}
          required
          placeholder="Find the launch plan or related work…"
          className="min-w-0 flex-1 rounded-xl border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={Boolean(visible?.busy) || query.trim().length < 2}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-sm disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          Search
        </button>
      </form>
      {visible?.busy && (
        <p role="status" className="mt-3 text-sm">
          Searching your current workspace…
        </p>
      )}
      {visible?.error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {visible.error}
        </p>
      )}
      {visible?.result && (
        <>
          <p role="status" className="mt-3 text-xs text-muted-foreground">
            {visible.result.mode === "semantic_and_keyword"
              ? "Meaning and keyword matches"
              : "Keyword matches"}{" "}
            · Up to 2,000 recent accessible records
          </p>
          {visible.result.items.length ? (
            <ul className="mt-2 space-y-1">
              {visible.result.items.map((item) => (
                <li key={`${item.source_table}:${item.source_id}`}>
                  <Link to={item.href} className="block rounded-xl p-3 hover:bg-accent">
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="ml-2 text-xs capitalize text-muted-foreground">
                      {item.kind.replaceAll("_", " ")}
                    </span>
                    {item.snippet && (
                      <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                        {item.snippet}
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No matching saved work. Try a different phrase.
            </p>
          )}
        </>
      )}
    </section>
  );
}
