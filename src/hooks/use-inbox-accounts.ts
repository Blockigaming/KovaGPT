import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listInboxAccounts } from "@/lib/inbox.functions";
import type { InboxAccount } from "@/lib/inbox-model";

export function useInboxAccounts(owner: string | null | undefined, refreshKey = "") {
  const list = useServerFn(listInboxAccounts);
  const current = useRef(owner);
  current.current = owner;
  const [state, setState] = useState<{
    owner: string | null;
    accounts: InboxAccount[];
    loading: boolean;
    error: boolean;
  }>({ owner: null, accounts: [], loading: true, error: false });
  useEffect(() => {
    if (!owner) return;
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      try {
        const accounts = await list({ data: { owner } });
        if (active && request === revision && current.current === owner)
          setState({ owner, accounts: Array.isArray(accounts) ? accounts : [], loading: false, error: false });
      } catch {
        if (active && request === revision && current.current === owner)
          setState({ owner, accounts: [], loading: false, error: true });
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [owner, list, refreshKey]);
  return owner && state.owner === owner
    ? state
    : { accounts: [], loading: Boolean(owner), error: false };
}
