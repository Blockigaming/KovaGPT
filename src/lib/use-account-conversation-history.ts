import { useEffect, useRef, useState } from "react";
import {
  chatStoragePrincipal,
  loadConversations,
  subscribeToConversationChanges,
  type Conversation,
} from "./chat-store";
import {
  isPrincipalBrowserStorageClearedEvent,
  PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT,
} from "./principal-browser-storage.mjs";

const EMPTY_HISTORY: Conversation[] = [];

/** Read-only view of the same owner-filtered history events used by AppShell. */
export function useAccountConversationHistory(userKey: string | null, enabled: boolean) {
  const principal = enabled && userKey ? chatStoragePrincipal(userKey) : null;
  const principalRef = useRef(principal);
  principalRef.current = principal;
  const [state, setState] = useState<{ principal: string | null; items: Conversation[] }>({
    principal: null,
    items: EMPTY_HISTORY,
  });
  useEffect(() => {
    if (!principal || !userKey) {
      setState({ principal: null, items: EMPTY_HISTORY });
      return;
    }
    let active = true;
    const update = (items: Conversation[]) => {
      if (active && principalRef.current === principal) setState({ principal, items: [...items] });
    };
    // Subscribe before the first read so late hydration cannot fall between them.
    const unsubscribe = subscribeToConversationChanges(userKey, update);
    const reset = (event: Event) => {
      if (!active || !isPrincipalBrowserStorageClearedEvent(event, userKey)) return;
      active = false;
      unsubscribe();
      if (principalRef.current === principal) setState({ principal, items: EMPTY_HISTORY });
    };
    window.addEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    update(loadConversations(userKey));
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener(PRINCIPAL_BROWSER_STORAGE_CLEARED_EVENT, reset);
    };
  }, [principal, userKey]);
  return principal !== null && state.principal === principal ? state.items : EMPTY_HISTORY;
}
