import { useRef } from "react";
export type ChatRuleDraft = { instructions: string; enabled: boolean };

/** Workspace-lifetime drafts only. No server state or browser storage is changed. */
export function useChatRuleDrafts(principal: string | null) {
  const scope = useRef({ principal, drafts: new Map<string, ChatRuleDraft>() });
  if (scope.current.principal !== principal) scope.current = { principal, drafts: new Map() };
  const current = scope.current;
  return {
    read(chatId: string | null) {
      return chatId && current === scope.current ? (current.drafts.get(chatId) ?? null) : null;
    },
    write(chatId: string, draft: ChatRuleDraft | null) {
      if (!principal || !chatId || current !== scope.current) return;
      if (draft) current.drafts.set(chatId, { ...draft });
      else current.drafts.delete(chatId);
    },
  };
}
