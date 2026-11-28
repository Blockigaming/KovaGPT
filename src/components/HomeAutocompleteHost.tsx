import { lazy, Suspense, useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { Conversation } from "@/lib/chat-store";

const HomePromptAutocomplete = lazy(() => import("./HomePromptAutocomplete"));

/** Renders prompt suggestions at the end of the empty-chat home column once the user types. */
export default function HomeAutocompleteHost({
  anchor,
  owner,
  draft,
  conversations,
  personalize,
  onPick,
}: {
  anchor: RefObject<HTMLElement | null>;
  owner: string | null;
  draft: string;
  conversations: readonly Conversation[];
  personalize: boolean;
  onPick: (draft: string) => void;
}) {
  const [host, setHost] = useState<Element | null>(null);
  const active = Boolean(draft.trim());
  useEffect(() => {
    setHost(active ? (anchor.current?.closest(".kova-empty-chat-content") ?? null) : null);
  }, [active, anchor]);
  if (!host) return null;
  return createPortal(
    <Suspense fallback={null}>
      <HomePromptAutocomplete
        key={owner ?? "guest"}
        owner={personalize ? owner : null}
        draft={draft}
        conversations={personalize ? conversations.filter((chat) => !chat.temporary) : []}
        onPick={onPick}
      />
    </Suspense>,
    host,
  );
}
