import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeoutAuthenticated } from "@/lib/auth-fetch";
import type { ConnectedAccount } from "@/integrations/connection-flows.mjs";
export type AccountStatus = { configuredProviders: { id: string }[]; accounts: ConnectedAccount[] };

async function fetchAccountStatus(renew = false): Promise<AccountStatus> {
  const response = await fetchWithTimeoutAuthenticated(
    renew ? "/api/integrations/accounts?renew=1" : "/api/integrations/accounts",
    { cache: "no-store" },
    renew ? 40_000 : undefined,
  );
  const data = (await response.json()) as AccountStatus;
  if (!response.ok || !Array.isArray(data.accounts) || !Array.isArray(data.configuredProviders))
    throw new Error("invalid_connection_status");
  return data;
}

export function useConnectedAccounts(principal: string | null, enabled: boolean) {
  const [state, setState] = useState<{
    principal: string | null;
    data: AccountStatus | null;
    loading: boolean;
    error: boolean;
  }>({ principal: null, data: null, loading: false, error: false });
  const epoch = useRef(0);
  const current = useRef(principal);
  current.current = principal;
  const reload = useCallback(async () => {
    const ticket = ++epoch.current;
    if (!enabled || !principal) return false;
    setState((previous) => ({
      principal,
      data: previous.principal === principal ? previous.data : null,
      loading: true,
      error: false,
    }));
    try {
      const data = await fetchAccountStatus();
      if (ticket !== epoch.current || principal !== current.current) return false;
      setState({ principal, data, loading: false, error: false });
      const configured = new Set(data.configuredProviders.map((provider) => provider.id));
      const expiry = Date.now() + 60_000;
      if (
        data.accounts.some(
          (account) =>
            account.status === "connected" &&
            configured.has(account.provider_id) &&
            account.token_expires_at &&
            Date.parse(account.token_expires_at) <= expiry,
        )
      )
        void fetchAccountStatus(true)
          .then((renewed) => {
            if (ticket === epoch.current && principal === current.current)
              setState({ principal, data: renewed, loading: false, error: false });
          })
          .catch(() => {
            // The usable directory snapshot stays visible if renewal is slow or unavailable.
          });
      return true;
    } catch {
      if (ticket === epoch.current && principal === current.current)
        setState((previous) => ({
          principal,
          data: previous.principal === principal ? previous.data : null,
          loading: false,
          error: true,
        }));
      return false;
    }
  }, [principal, enabled]);
  useEffect(() => {
    void reload();
    return () => {
      epoch.current += 1;
    };
  }, [reload]);
  const visible = enabled && state.principal === principal;
  return {
    data: visible ? state.data : null,
    loading: enabled && (!visible || state.loading),
    error: visible && state.error,
    reload,
  };
}
