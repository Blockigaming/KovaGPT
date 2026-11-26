import { useEffect, useMemo, useState } from "react";
import type { Conversation } from "@/lib/chat-store";
import { homePromptSuggestions } from "@/lib/home-prompt-autocomplete.mjs";
import { useComposerPluginConnections } from "./ComposerPluginList";
import { composerPluginConnection } from "@/lib/composer-plugin-usage.mjs";
import { CONNECTION_FLOWS, canReadConnection } from "@/integrations/connection-flows.mjs";
import { MEMORY_SOURCES_CHANGED_EVENT } from "@/lib/memory-sources.mjs";
import "./home-prompt-autocomplete.css";

export default function HomePromptAutocomplete({
  owner,
  draft,
  conversations,
  onPick,
}: {
  owner: string | null;
  draft: string;
  conversations: Conversation[];
  onPick: (draft: string) => void;
}) {
  const [desktop, setDesktop] = useState(false);
  const [memory, setMemory] = useState<{ owner: string; titles: { title: string }[] } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const sync = () => setDesktop(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const { accounts, snapshot } = useComposerPluginConnections(desktop ? owner : null, desktop);
  useEffect(() => {
    if (!desktop || !owner) return;
    const abort = new AbortController();
    let request = 0;
    const refresh = async () => {
      const ticket = ++request;
      setMemory(null);
      try {
        const { fetchForPrincipal } = await import("@/lib/chat-summary-snapshot.mjs");
        const response = await fetchForPrincipal(owner, "/api/memory", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) return;
        const body = await response.json();
        if (abort.signal.aborted || ticket !== request || !Array.isArray(body.memories)) return;
        const titles = body.memories
          .slice(0, 40)
          .filter((item: { title?: unknown }) => typeof item?.title === "string")
          .map((item: { title: string }) => ({ title: item.title }));
        setMemory({ owner, titles });
      } catch {
        // Optional context must never prevent local suggestions or typing.
      }
    };
    void refresh();
    window.addEventListener(MEMORY_SOURCES_CHANGED_EVENT, refresh);
    return () => {
      abort.abort();
      window.removeEventListener(MEMORY_SOURCES_CHANGED_EVENT, refresh);
    };
  }, [desktop, owner]);
  const connectedIds = useMemo(() => {
    if (!owner || !desktop) return [];
    const ids = ["github", "gmail", "google-calendar", "google-drive"].filter(
      (id) => composerPluginConnection(id, { userId: owner, authLoaded: true, snapshot }).connected,
    );
    if (!accounts.loading && !accounts.error && accounts.data) {
      const { configuredProviders, accounts: rows } = accounts.data;
      for (const [id, flow] of Object.entries(CONNECTION_FLOWS)) {
        if (
          configuredProviders.some((provider) => provider.id === flow.provider) &&
          rows.some((account) => canReadConnection(account, id))
        )
          ids.push(id);
      }
    }
    return ids;
  }, [owner, desktop, accounts.data, accounts.loading, accounts.error, snapshot]);
  const suggestions = homePromptSuggestions(
    draft,
    owner ? conversations : [],
    memory?.owner === owner ? memory.titles : [],
    connectedIds,
  );
  if (!desktop || !suggestions.length) return null;
  return (
    <ul className="kova-home-autocomplete" aria-label="Prompt suggestions">
      {suggestions.map((suggestion) => (
        <li key={suggestion}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onPick(suggestion);
              requestAnimationFrame(() =>
                document.querySelector<HTMLTextAreaElement>(
                  '.kova-empty-chat textarea[aria-label="Message KovaGPT"]',
                )?.focus(),
              );
            }}
          >
            <span>{suggestion.slice(0, draft.trimEnd().length)}</span>
            {suggestion.slice(draft.trimEnd().length)}
          </button>
        </li>
      ))}
    </ul>
  );
}
